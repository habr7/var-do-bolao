import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { lembrete } from '../utils/football.terms.js';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { reservarCotaAviso, devolverCotaAviso } from '../utils/aviso-cap.js';

/**
 * Cutuca via DM quem ainda tem jogosPendentes em rodada cuja data de fechamento
 * esta proxima (ate 3h). Nao manda pros que ja palpitaram tudo.
 *
 * v3.17.0 (caso Camila 11/06):
 *   - Honra a flag cross-job `aviso_jogo:{waId}` (TTL 24h) compartilhada
 *     com bom-dia e palpite-call. Antes, este era o único job que NÃO
 *     honrava — gerava a 3ª mensagem do dia.
 *   - Respeita cap diário MAX_AVISOS_DIA (default 2).
 *   - Define a flag depois do envio pra bloquear outros jobs.
 *   - Filtro de "engajados na rodada": já existia (`palpites.some`).
 *     Confirmado: a query `palpites: { select: { usuarioId } }` retorna
 *     quem tem QUALQUER PalpiteJogo na rodada — quem palpitou em 1 de
 *     72 jogos NÃO é cutucado. Comportamento desejado.
 */
export async function sendRemindersJob() {
  if (!env.ENABLE_REMINDERS) return;
  const limite = new Date();
  limite.setHours(limite.getHours() + 3);

  const rodadas = await prisma.rodada.findMany({
    where: {
      status: 'ABERTA',
      dataFechamento: { lte: limite, gt: new Date() },
    },
    include: {
      bolao: {
        include: { participacoes: { include: { usuario: true } } },
      },
      jogos: true,
      palpites: { select: { usuarioId: true } },
    },
  });

  for (const rodada of rodadas) {
    const jaPalpitou = new Set(rodada.palpites.map((p) => p.usuarioId));
    const faltantes = rodada.bolao.participacoes.filter((p) => !jaPalpitou.has(p.usuarioId));

    for (const p of faltantes) {
      const waId = p.usuario.whatsappId;
      if (!waId) continue;
      // v3.17.0 — cross-job flag (antes este job não honrava)
      const flagCross = `aviso_jogo:${waId}`;
      if (await redis.get(flagCross)) continue;
      // v3.28.0 — cap absoluto/dia, reserva ATÔMICA (corrige TOCTOU)
      if (!(await reservarCotaAviso(waId))) continue;

      try {
        await sendText({
          to: waId,
          text:
            `${lembrete()}\n\n` +
            `⏰ Rodada *${rodada.numero}* do bolão *${rodada.bolao.nome}* fecha logo!\n` +
            `Você ainda não palpitou. Manda aí craque! ⚽`,
        });
        await redis.set(flagCross, '1', 'EX', 24 * 3600);
      } catch (error) {
        await devolverCotaAviso(waId); // envio falhou — devolve a cota
        console.error(`[reminders] erro em ${waId}:`, (error as Error).message);
      }
    }
  }
}
