import { prisma } from '../config/database.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';
import { comLockJob } from '../utils/lock.js';

export async function calculateScoresJob() {
  // v3.28.0 — compartilha o MESMO lock do fetch-results: os dois mexem na
  // pontuação/ranking das mesmas rodadas; rodar em paralelo causaria
  // recálculo concorrente e ranking inconsistente.
  await comLockJob('fetch-results', calculateScoresJobInterno);
}

async function calculateScoresJobInterno() {
  console.log('[JOB] Verificando rodadas para calcular pontuação...');

  // v3.14.0 (pré-Copa): aceita rodadas em qualquer status. Antes filtrava
  // status='FINALIZADA' — só ativava DEPOIS que TODOS os jogos da rodada
  // terminassem. Pra Copa 2026 fase de grupos (72 jogos em ~15 dias),
  // isso bloqueava pontuação por 2 semanas. Agora calcula incremental:
  // qualquer rodada que tenha palpites com calculado=false (setado pelo
  // fetch-results quando um jogo finaliza). Função `calcularPontuacaoRodada`
  // já é tolerante a jogos sem placar (retorna 0 pra eles).
  const rodadas = await prisma.rodada.findMany({
    where: {
      status: { in: ['ABERTA', 'FECHADA', 'FINALIZADA'] },
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
