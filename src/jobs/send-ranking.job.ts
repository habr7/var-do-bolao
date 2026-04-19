import { prisma } from '../config/database.js';
import { recalcularRanking } from '../modules/ranking/ranking.service.js';
import { enviarRankingParaParticipantes } from '../modules/notificacao/notificacao.service.js';

/**
 * Envia ranking em DM para participantes de rodadas recem-finalizadas.
 * Evita reenvio usando uma flag simples (ultima rodada finalizada ha menos
 * de 1h30 — pega a do fetch-results mesmo se o envio falhou).
 */
export async function sendRankingJob() {
  const desde = new Date();
  desde.setMinutes(desde.getMinutes() - 90);

  const rodadas = await prisma.rodada.findMany({
    where: {
      status: 'FINALIZADA',
      criadoEm: { gte: desde },
    },
    include: {
      bolao: {
        include: { participacoes: { include: { usuario: true } } },
      },
    },
  });

  for (const rodada of rodadas) {
    try {
      const ranking = await recalcularRanking(rodada.bolaoId);
      await enviarRankingParaParticipantes({
        waIds: rodada.bolao.participacoes.map((p) => p.usuario.whatsappId),
        nomeBolao: rodada.bolao.nome,
        rodada: rodada.numero,
        campeonato: rodada.bolao.campeonatoNome,
        ranking,
      });
    } catch (error) {
      console.error(`[send-ranking] erro:`, error);
    }
  }
}
