import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { setSession } from '../whatsapp/session.manager.js';
import { formatJogosRodada } from '../utils/formatting.js';

/**
 * Job diario (09:00): para cada bolao ativo com rodada aberta e jogos acontecendo
 * hoje, envia DM individual para cada participante com a lista numerada de jogos.
 * Seta sessao PALPITANDO com jogosPendentes = todos os jogos.
 */
export async function sendDailyGamesJob() {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const fimHoje = new Date();
  fimHoje.setHours(23, 59, 59, 999);

  // Rodadas abertas com jogos hoje
  const rodadas = await prisma.rodada.findMany({
    where: {
      status: 'ABERTA',
      jogos: { some: { dataHora: { gte: inicioHoje, lte: fimHoje } } },
    },
    include: {
      bolao: {
        include: {
          participacoes: { include: { usuario: true } },
        },
      },
      jogos: {
        where: { dataHora: { gte: inicioHoje, lte: fimHoje } },
        orderBy: { dataHora: 'asc' },
      },
    },
  });

  for (const rodada of rodadas) {
    if (rodada.jogos.length === 0) continue;

    const jogosTexto = formatJogosRodada(
      rodada.numero,
      rodada.bolao.campeonatoNome,
      rodada.jogos.map((j) => ({
        timeCasa: j.timeCasa,
        timeVisitante: j.timeVisitante,
        golsCasa: j.golsCasa,
        golsVisitante: j.golsVisitante,
        status: j.status,
      })),
    );

    const mensagem =
      `⚽ *Jogos de hoje — ${rodada.bolao.nome}*\n\n` +
      jogosTexto +
      `\n\n📝 Envie seus palpites assim:\n_Flamengo 2x1 Palmeiras_\n_Corinthians 0x0 São Paulo_\n\n` +
      `Pode mandar tudo numa mensagem só! 🏆`;

    for (const participacao of rodada.bolao.participacoes) {
      try {
        await setSession(participacao.usuario.whatsappId, {
          state: 'PALPITANDO',
          ctx: {
            bolaoId: rodada.bolaoId,
            rodadaId: rodada.id,
            jogosPendentes: rodada.jogos.map((j) => j.id),
          },
        });

        await sendText({ to: participacao.usuario.whatsappId, text: mensagem });
      } catch (error) {
        console.error(
          `[send-daily-games] erro enviando pra ${participacao.usuario.whatsappId}:`,
          (error as Error).message,
        );
      }
    }
  }
}
