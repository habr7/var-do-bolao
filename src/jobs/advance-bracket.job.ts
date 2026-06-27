/**
 * advance-bracket.job — propaga a chave do mata-mata.
 *
 * Quando um jogo de mata-mata FINALIZA com `classificadoLado` definido, escreve
 * o time que avançou no slot correto do PRÓXIMO jogo da chave (do MESMO bolão).
 * Nas semifinais, também manda o PERDEDOR pra disputa de 3º lugar. Quando os
 * dois lados de um jogo seguinte ficam preenchidos com times reais, abre a
 * rodada daquele jogo (status ABERTA) — aí os participantes podem palpitar.
 *
 * IDEMPOTENTE: só escreve em slot ainda placeholder ("Vencedor 73"); nunca
 * sobrescreve um time real. Re-rodar não corrompe nada.
 *
 * Roda logo após o cálculo de resultados. Chamado de DENTRO do fetch-results
 * (que já segura o lock 'fetch-results') via `advanceBracketInterno`, e também
 * registrado como job próprio (`advanceBracketJob`, com lock) como rede de
 * segurança.
 */
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../config/database.js';
import { comLockJob } from '../utils/lock.js';
import { BRACKET_2026, ehTimePlaceholder } from '../data/bracket-2026.js';

export interface ResultadoAdvance {
  slotsPreenchidos: number;
  rodadasAbertas: number;
}

/**
 * Núcleo testável: recebe o client (real ou mock) e propaga a chave de TODOS os
 * bolões. Sem lock próprio (o caller decide).
 */
export async function advanceBracketComClient(db: PrismaClient): Promise<ResultadoAdvance> {
  // Jogos de mata-mata já FINALIZADOS com classificado definido.
  const jogos = await db.jogo.findMany({
    where: {
      fase: { not: 'GRUPOS' },
      status: 'FINALIZADO',
      classificadoLado: { not: null },
    },
    include: { rodada: { select: { bolaoId: true } } },
  });

  let slotsPreenchidos = 0;
  const rodadasParaChecar = new Set<string>(); // apiJogoId|bolaoId dos destinos tocados

  for (const jogo of jogos) {
    const bolaoId = jogo.rodada.bolaoId;
    const vencedor = jogo.classificadoLado === 'CASA' ? jogo.timeCasa : jogo.timeVisitante;
    const perdedor = jogo.classificadoLado === 'CASA' ? jogo.timeVisitante : jogo.timeCasa;
    const avanco = BRACKET_2026[jogo.apiJogoId] ?? {};

    // Vencedor → próximo jogo (campos gravados no próprio Jogo, vindos do seed).
    if (jogo.proximoJogoApiId && jogo.proximoSlot && !ehTimePlaceholder(vencedor)) {
      const escreveu = await escreverSlot(db, bolaoId, jogo.proximoJogoApiId, jogo.proximoSlot, vencedor);
      if (escreveu) {
        slotsPreenchidos++;
        rodadasParaChecar.add(`${jogo.proximoJogoApiId}|${bolaoId}`);
      }
    }

    // Perdedor → disputa de 3º lugar (só semis; vem do config, não do Jogo).
    if (avanco.perdedor && !ehTimePlaceholder(perdedor)) {
      const escreveu = await escreverSlot(
        db,
        bolaoId,
        avanco.perdedor.proximoJogoApiId,
        avanco.perdedor.proximoSlot,
        perdedor,
      );
      if (escreveu) {
        slotsPreenchidos++;
        rodadasParaChecar.add(`${avanco.perdedor.proximoJogoApiId}|${bolaoId}`);
      }
    }
  }

  // Abre as rodadas cujos jogos ficaram com os DOIS times reais.
  let rodadasAbertas = 0;
  for (const chave of rodadasParaChecar) {
    const [apiJogoId, bolaoId] = chave.split('|');
    if (await talvezAbrirRodada(db, bolaoId, apiJogoId)) rodadasAbertas++;
  }

  return { slotsPreenchidos, rodadasAbertas };
}

/**
 * Escreve `timeNome` no slot (CASA/VISITANTE) do jogo `apiJogoId` no bolão.
 * Idempotente: só escreve se o slot ainda for placeholder. Retorna true se
 * efetivamente escreveu.
 */
async function escreverSlot(
  db: PrismaClient,
  bolaoId: string,
  apiJogoId: string,
  slot: 'CASA' | 'VISITANTE',
  timeNome: string,
): Promise<boolean> {
  const destino = await db.jogo.findFirst({
    where: { apiJogoId, rodada: { bolaoId } },
    select: { id: true, timeCasa: true, timeVisitante: true },
  });
  if (!destino) return false;

  const atual = slot === 'CASA' ? destino.timeCasa : destino.timeVisitante;
  // Nunca sobrescreve um time já real (idempotência + segurança).
  if (!ehTimePlaceholder(atual)) return false;

  // Escrita atômica: updateMany com guarda no WHERE (o slot ainda é o placeholder
  // lido). Se outro processo escreveu nesse meio-tempo, count=0 e não sobrescreve.
  const r = await db.jogo.updateMany({
    where: slot === 'CASA' ? { id: destino.id, timeCasa: atual } : { id: destino.id, timeVisitante: atual },
    data: slot === 'CASA' ? { timeCasa: timeNome } : { timeVisitante: timeNome },
  });
  if (r.count === 0) return false;
  console.log(`[advance-bracket] ${apiJogoId} ${slot} ← ${timeNome} (bolão ${bolaoId})`);
  return true;
}

/**
 * Se os dois times do jogo já são reais e a rodada não está ABERTA, abre.
 * Retorna true se abriu agora.
 */
async function talvezAbrirRodada(db: PrismaClient, bolaoId: string, apiJogoId: string): Promise<boolean> {
  const jogo = await db.jogo.findFirst({
    where: { apiJogoId, rodada: { bolaoId } },
    select: { timeCasa: true, timeVisitante: true, rodada: { select: { id: true, status: true } } },
  });
  if (!jogo) return false;
  if (ehTimePlaceholder(jogo.timeCasa) || ehTimePlaceholder(jogo.timeVisitante)) return false;
  if (jogo.rodada.status === 'ABERTA') return false;

  await db.rodada.update({ where: { id: jogo.rodada.id }, data: { status: 'ABERTA' } });
  console.log(`[advance-bracket] rodada ${jogo.rodada.id} ABERTA — ${jogo.timeCasa} x ${jogo.timeVisitante}`);
  // A notificação aos participantes fica a cargo do send-palpite-call (quando
  // habilitado), que varre rodadas ABERTAS — evita disparo de DM em massa daqui.
  return true;
}

/** Versão interna sem lock — chamada de dentro do fetch-results (já lockado). */
export async function advanceBracketInterno(): Promise<ResultadoAdvance> {
  return advanceBracketComClient(prisma);
}

/** Job com lock — disponível pra invocação manual/cron isolada. */
export async function advanceBracketJob(): Promise<void> {
  await comLockJob('fetch-results', async () => {
    await advanceBracketInterno();
  });
}
