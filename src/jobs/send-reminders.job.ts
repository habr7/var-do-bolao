import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { lembrete } from '../utils/football.terms.js';
import { env } from '../config/env.js';

/**
 * Cutuca via DM quem ainda tem jogosPendentes em rodada cuja data de fechamento
 * esta proxima (ate 3h). Nao manda pros que ja palpitaram tudo.
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
      try {
        await sendText({
          to: p.usuario.whatsappId,
          text:
            `${lembrete()}\n\n` +
            `⏰ Rodada *${rodada.numero}* do bolão *${rodada.bolao.nome}* fecha logo!\n` +
            `Você ainda não palpitou. Manda aí craque! ⚽`,
        });
      } catch (error) {
        console.error(`[reminders] erro em ${p.usuario.whatsappId}:`, (error as Error).message);
      }
    }
  }
}
