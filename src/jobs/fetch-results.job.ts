import { buscarRodadasComJogosEmAndamento, finalizarRodada } from '../modules/rodada/rodada.repository.js';
import { atualizarResultados } from '../modules/resultado/resultado.service.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';
import { enviarRankingParaParticipantes } from '../modules/notificacao/notificacao.service.js';
import { prisma } from '../config/database.js';
import { comLockJob } from '../utils/lock.js';
import { advanceBracketInterno } from './advance-bracket.job.js';

export async function fetchResultsJob() {
  // v3.28.0 — lock contra sobreposição (crons defasados / 2 instâncias):
  // sem isso, dois ticks podiam recalcular a mesma rodada em paralelo e
  // deixar pontuacaoTotal/posicaoAtual momentaneamente inconsistentes.
  await comLockJob('fetch-results', fetchResultsJobInterno);
}

async function fetchResultsJobInterno() {
  const rodadas = await buscarRodadasComJogosEmAndamento();
  if (rodadas.length === 0) return;

  for (const rodada of rodadas) {
    try {
      const { todosFinalizados, palpitesResetados } = await atualizarResultados(
        rodada.id,
        rodada.bolao.campeonatoId,
        rodada.numero,
      );

      // v3.14.0 (pré-Copa): recálculo INCREMENTAL — se algum jogo
      // virou FINALIZADO neste tick (palpitesResetados > 0), recalcula
      // pontuação da rodada AGORA. `calcularPontuacaoRodada` é
      // idempotente e tolerante a jogos ainda sem placar.
      if (palpitesResetados > 0) {
        await calcularPontuacaoRodada(rodada.id);
        await recalcularRanking(rodada.bolaoId);
        console.log(
          `[fetch-results] cálculo incremental: rodada=${rodada.numero} palpitesResetados=${palpitesResetados}`,
        );
      }

      if (todosFinalizados) {
        // Garante que rodada vira FINALIZADA + envia ranking final.
        // calcularPontuacaoRodada/recalcularRanking já rodaram acima
        // (idempotente), mas chamamos de novo pra segurança caso
        // palpitesResetados não cubra algum corner case.
        await calcularPontuacaoRodada(rodada.id);
        const ranking = await recalcularRanking(rodada.bolaoId);
        await finalizarRodada(rodada.id);

        // Lista todos wa_ids do bolao para enviar ranking em DM
        const participantes = await prisma.participacao.findMany({
          where: { bolaoId: rodada.bolaoId },
          include: { usuario: true },
        });

        await enviarRankingParaParticipantes({
          waIds: participantes.map((p) => p.usuario.whatsappId),
          nomeBolao: rodada.bolao.nome,
          rodada: rodada.numero,
          campeonato: rodada.bolao.campeonatoNome,
          ranking,
        });
      }
    } catch (error) {
      console.error(`[fetch-results] erro na rodada ${rodada.numero}:`, error);
    }
  }

  // Mata-mata: propaga a chave (vencedor → próximo jogo; perdedor das semis →
  // 3º lugar) e abre as rodadas que ficaram com os dois times reais. Idempotente;
  // roda DENTRO do lock 'fetch-results' que já seguramos (por isso o interno).
  try {
    const { slotsPreenchidos, rodadasAbertas } = await advanceBracketInterno();
    if (slotsPreenchidos > 0 || rodadasAbertas > 0) {
      console.log(`[fetch-results] advance-bracket: ${slotsPreenchidos} slot(s), ${rodadasAbertas} rodada(s) aberta(s)`);
    }
  } catch (error) {
    console.error('[fetch-results] erro no advance-bracket:', error);
  }
}
