import type { LadoJogo } from '@prisma/client';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendText } from './evolution.client.js';
import { ehDono } from './broadcast.js';
import { timeCorresponde } from '../utils/validators.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';
import { advanceBracketInterno } from '../jobs/advance-bracket.job.js';

/**
 * Comando admin pra DEFINIR o classificado de um jogo de mata-mata — fallback
 * pra quando o provider não expõe o vencedor da disputa de pênaltis (placar
 * empata e o jogo não avança sozinho). Espelha o `broadcast.ts`: gated por
 * `ehDono`, interceptado no topo do pipeline.
 *
 * Formato:
 *   #CLASSIFICADO <apiJogoId> <CASA|VISITANTE|1|2|nome do time> [PENALTIS|NORMAL]
 * Ex:
 *   #CLASSIFICADO WC2026_R32_73 CASA
 *   #CLASSIFICADO WC2026_R32_73 Brasil PENALTIS
 *
 * Efeito: grava classificadoLado (+ decididoNosPenaltis) em TODOS os bolões,
 * reseta os palpites afetados pra recálculo, recalcula a pontuação/ranking e
 * dispara o advance-bracket (preenche o próximo jogo / 3º lugar).
 */
const MARKER = '#CLASSIFICADO';

export interface ClassificadoCmd {
  apiJogoId: string;
  ladoToken: string;
  penaltis: boolean | null; // null = inferir do placar
}

export function parseClassificadoCmd(text: string): ClassificadoCmd | null {
  const t = (text ?? '').trim();
  if (!t.toLowerCase().startsWith(MARKER.toLowerCase())) return null;
  const resto = t.slice(MARKER.length).trim();
  const tokens = resto.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return { apiJogoId: '', ladoToken: '', penaltis: null };

  const apiJogoId = tokens[0];
  let ladoTokens = tokens.slice(1);
  let penaltis: boolean | null = null;
  const ultimo = ladoTokens[ladoTokens.length - 1]?.toUpperCase();
  if (ultimo && /^(PENALTIS|PÊNALTIS|PEN|PENALTI)$/.test(ultimo)) {
    penaltis = true;
    ladoTokens = ladoTokens.slice(0, -1);
  } else if (ultimo && /^(NORMAL|PROR|PRORROGACAO|PRORROGAÇÃO)$/.test(ultimo)) {
    penaltis = false;
    ladoTokens = ladoTokens.slice(0, -1);
  }
  return { apiJogoId, ladoToken: ladoTokens.join(' '), penaltis };
}

/** Resolve o lado (CASA/VISITANTE) a partir do token contra um jogo de amostra. */
export function resolverLadoClassificado(
  ladoToken: string,
  jogo: { timeCasa: string; timeVisitante: string },
): LadoJogo | null {
  const t = ladoToken.trim().toLowerCase();
  if (/^(1|casa|mandante|o primeiro|primeiro)$/.test(t)) return 'CASA';
  if (/^(2|visitante|fora|o segundo|segundo)$/.test(t)) return 'VISITANTE';
  const casa = timeCorresponde(ladoToken, jogo.timeCasa);
  const visitante = timeCorresponde(ladoToken, jogo.timeVisitante);
  if (casa && !visitante) return 'CASA';
  if (visitante && !casa) return 'VISITANTE';
  return null;
}

const USO =
  '⚠️ Uso: `#CLASSIFICADO <apiJogoId> <CASA|VISITANTE|nome do time> [PENALTIS]`\n' +
  'Ex: `#CLASSIFICADO WC2026_R32_73 Brasil PENALTIS`';

/**
 * Interceptador. Retorna `true` se tratou a mensagem (curto-circuita o pipeline).
 */
export async function tentarClassificadoAdmin(msg: { waId: string; text: string }): Promise<boolean> {
  if (!ehDono(msg.waId, env.OWNER_WHATSAPP_IDS)) return false;
  const parsed = parseClassificadoCmd(msg.text);
  if (!parsed) return false; // não é o comando → segue fluxo

  if (!parsed.apiJogoId || !parsed.ladoToken) {
    await sendText({ to: msg.waId, text: USO });
    return true;
  }

  const jogos = await prisma.jogo.findMany({
    where: { apiJogoId: parsed.apiJogoId },
    include: { rodada: { select: { id: true, bolaoId: true, fase: true } } },
  });
  if (jogos.length === 0) {
    await sendText({ to: msg.waId, text: `❌ Não achei nenhum jogo com apiJogoId *${parsed.apiJogoId}*.` });
    return true;
  }
  const amostra = jogos[0];
  if (amostra.rodada.fase === 'GRUPOS') {
    await sendText({ to: msg.waId, text: `❌ *${parsed.apiJogoId}* é da fase de grupos — não tem classificado.` });
    return true;
  }
  const lado = resolverLadoClassificado(parsed.ladoToken, amostra);
  if (!lado) {
    await sendText({
      to: msg.waId,
      text: `❌ Não entendi o lado "${parsed.ladoToken}". Use CASA/VISITANTE (ou o nome: *${amostra.timeCasa}* / *${amostra.timeVisitante}*).`,
    });
    return true;
  }
  // Pênaltis: usa o flag se veio; senão infere (empate no placar → pênaltis).
  const penaltis = parsed.penaltis ?? amostra.golsCasa === amostra.golsVisitante;

  // 1) Grava em TODOS os bolões (mesmo apiJogoId em N rodadas).
  await prisma.jogo.updateMany({
    where: { apiJogoId: parsed.apiJogoId },
    data: { classificadoLado: lado, decididoNosPenaltis: penaltis },
  });
  // 2) Reseta palpites afetados pra forçar recálculo do bônus.
  await prisma.palpite.updateMany({
    where: { calculado: true, jogos: { some: { jogo: { apiJogoId: parsed.apiJogoId } } } },
    data: { calculado: false },
  });
  // 3) Recalcula pontuação/ranking dos bolões afetados.
  const rodadaIds = [...new Set(jogos.map((j) => j.rodada.id))];
  const bolaoIds = [...new Set(jogos.map((j) => j.rodada.bolaoId))];
  for (const rid of rodadaIds) await calcularPontuacaoRodada(rid);
  for (const bid of bolaoIds) await recalcularRanking(bid);
  // 4) Avança a chave (preenche o próximo jogo / 3º lugar).
  const adv = await advanceBracketInterno();

  const vencedor = lado === 'CASA' ? amostra.timeCasa : amostra.timeVisitante;
  await sendText({
    to: msg.waId,
    text:
      `✅ *${parsed.apiJogoId}*: ${vencedor} classificado${penaltis ? ' (nos pênaltis)' : ''}.\n` +
      `Recalculei ${bolaoIds.length} bolão(ões). Avanço: ${adv.slotsPreenchidos} slot(s), ` +
      `${adv.rodadasAbertas} rodada(s) aberta(s).`,
  });
  return true;
}
