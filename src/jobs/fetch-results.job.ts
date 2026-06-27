import { buscarRodadasComJogosEmAndamento, finalizarRodada } from '../modules/rodada/rodada.repository.js';
import { atualizarResultados } from '../modules/resultado/resultado.service.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';
import { enviarRankingParaParticipantes } from '../modules/notificacao/notificacao.service.js';
import { prisma } from '../config/database.js';
import { comLockJob } from '../utils/lock.js';
import { advanceBracketInterno } from './advance-bracket.job.js';
import { buscarFixturesMataMata } from '../modules/resultado/fifa.fetcher.js';
import { sincronizarMataMata } from '../modules/resultado/mata-mata.sync.service.js';

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

  // Mata-mata: SYNC com a FIFA (fonte da verdade dos confrontos). Puxa times,
  // datas, placar (90'+prorrog) e classificado (do Winner, inclusive pênaltis)
  // de TODAS as fases, preenche/abre as rodadas e recalcula o que mudou. O
  // adapter FIFA de resultados (atualizarResultados) só casa jogos de GRUPOS
  // por código de país; o mata-mata vem por aqui (casa por MatchNumber).
  try {
    const fixtures = await buscarFixturesMataMata();
    const sync = await sincronizarMataMata(prisma, fixtures);
    for (const rid of sync.rodadaIds) await calcularPontuacaoRodada(rid);
    for (const bid of sync.bolaoIds) await recalcularRanking(bid);
    if (sync.jogosAtualizados > 0 || sync.rodadasAbertas > 0 || sync.rodadaIds.length > 0) {
      console.log(
        `[fetch-results] mata-mata-sync: ${sync.jogosAtualizados} jogo(s), ` +
          `${sync.rodadasAbertas} rodada(s) aberta(s), ${sync.rodadaIds.length} recalculada(s)`,
      );
    }
  } catch (error) {
    console.error('[fetch-results] erro no mata-mata-sync (provável FIFA fora):', (error as Error).message);
  }

  // Fallback/segurança: propaga a chave pelo NOSSO classificadoLado (caso o sync
  // da FIFA esteja atrasado). Idempotente; só escreve em slot placeholder.
  try {
    const { slotsPreenchidos, rodadasAbertas } = await advanceBracketInterno();
    if (slotsPreenchidos > 0 || rodadasAbertas > 0) {
      console.log(`[fetch-results] advance-bracket: ${slotsPreenchidos} slot(s), ${rodadasAbertas} rodada(s) aberta(s)`);
    }
  } catch (error) {
    console.error('[fetch-results] erro no advance-bracket:', error);
  }
}
