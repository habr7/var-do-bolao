import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { env } from '../config/env.js';
import { podeEnviarAvisoHoje, registrarAvisoEnviado } from '../utils/aviso-cap.js';
import { INCLUDE_REVELACAO, blocoDoJogo } from '../modules/palpite/revelacao.service.js';
import { montarMensagemRevelacao, type BlocoRevelacao } from '../utils/palpite-reveal.js';

/**
 * v3.24.0 — Push de revelação de palpites quando o jogo COMEÇA.
 *
 * Quando a bola rola (kickoff passou, palpite travado), manda pra cada
 * integrante do bolão os palpites de TODOS daquele bolão pra AQUELE jogo.
 * Quem não palpitou aparece como "não palpitou".
 *
 * Características:
 *   - TIME-DRIVEN (não depende da FIFA): dispara por horário (kickoff
 *     passou), então funciona mesmo com a API de placares fora.
 *   - Escopo seguro: 1 jogo (jogoId) × 1 bolão por bloco — impossível
 *     vazar palpite de outro jogo ou de bolão alheio (ver revelacao.service).
 *   - Multi-bolão: se o mesmo jogo está em N bolões do user, manda 1
 *     mensagem com N blocos.
 *   - Idempotente: flag Redis `reveal:{whatsappId}:{apiJogoId}` → 1 envio
 *     por pessoa por jogo.
 *   - CONTA no cap diário de avisos (MAX_AVISOS_DIA), junto com
 *     bom-dia/chamada-de-palpite (decisão de produto). A resposta SOB
 *     DEMANDA (handlePalpiteOutros) NÃO conta — é o user que pediu.
 *   - NÃO mexe na sessão FSM (é informativo) — evita o bug histórico de
 *     atropelar fluxo em andamento.
 *
 * Cron: a cada 2min. Janela: jogos com kickoff nos últimos JANELA_MS
 * (cobre eventual tick perdido sem revelar tarde demais).
 */

const JANELA_MS = 20 * 60 * 1000; // 20min após o kickoff

export async function sendPalpiteRevealJob() {
  if (!env.ENABLE_PALPITE_REVEAL) return;

  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_MS);

  const jogos = await prisma.jogo.findMany({
    where: {
      dataHora: { lte: agora, gte: desde },
      status: { notIn: ['ADIADO', 'CANCELADO'] },
    },
    include: INCLUDE_REVELACAO,
  });
  if (jogos.length === 0) return;

  // user(id) → { whatsappId, apiJogoId → blocos[] }
  interface Acc {
    whatsappId: string;
    matches: Map<string, BlocoRevelacao[]>;
  }
  const porUsuario = new Map<string, Acc>();

  for (const jogo of jogos) {
    for (const part of jogo.rodada.bolao.participacoes) {
      const bloco = blocoDoJogo(jogo, part.usuario.id);
      if (!bloco) continue; // bolão solo ou ninguém palpitou
      const acc =
        porUsuario.get(part.usuario.id) ??
        ({ whatsappId: part.usuario.whatsappId, matches: new Map() } as Acc);
      const arr = acc.matches.get(jogo.apiJogoId) ?? [];
      arr.push(bloco);
      acc.matches.set(jogo.apiJogoId, arr);
      porUsuario.set(part.usuario.id, acc);
    }
  }

  let enviados = 0;
  for (const acc of porUsuario.values()) {
    for (const [apiJogoId, blocos] of acc.matches) {
      const flag = `reveal:${acc.whatsappId}:${apiJogoId}`;
      if (await redis.get(flag)) continue; // já revelado pra essa pessoa/jogo
      if (!(await podeEnviarAvisoHoje(acc.whatsappId))) continue; // push CONTA no cap

      try {
        await sendText({ to: acc.whatsappId, text: montarMensagemRevelacao(blocos) });
        await registrarAvisoEnviado(acc.whatsappId);
        await redis.set(flag, '1', 'EX', 6 * 3600); // 6h cobre o jogo + folga
        enviados++;
      } catch (error) {
        console.error(`[palpite-reveal] falha ao enviar pra ${acc.whatsappId}:`, (error as Error).message);
      }
    }
  }

  if (enviados > 0) {
    console.log(`[palpite-reveal] revelações enviadas: ${enviados}`);
  }
}
