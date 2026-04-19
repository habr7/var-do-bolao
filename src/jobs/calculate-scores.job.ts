import { prisma } from '../config/database.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';

export async function calculateScoresJob() {
  console.log('[JOB] Verificando rodadas para calcular pontuação...');

  // Busca rodadas fechadas com palpites nao calculados
  const rodadas = await prisma.rodada.findMany({
    where: {
      status: 'FINALIZADA',
      palpites: {
        some: { calculado: false },
      },
    },
    include: {
      bolao: true,
    },
  });

  for (const rodada of rodadas) {
    try {
      await calcularPontuacaoRodada(rodada.id);
      await recalcularRanking(rodada.bolaoId);
      console.log(`[JOB] Pontuação calculada para rodada ${rodada.numero}`);
    } catch (error) {
      console.error(`[JOB] Erro ao calcular rodada ${rodada.numero}:`, error);
    }
  }
}
