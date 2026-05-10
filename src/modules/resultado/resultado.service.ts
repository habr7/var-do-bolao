import { env } from '../../config/env.js';
import { MockFootballApi, ApiFutebolAdapter } from './resultado.fetcher.js';
import { FifaWorldCup2026Adapter } from './fifa.fetcher.js';
import type { FootballApiAdapter } from './resultado.types.js';
import * as rodadaRepo from '../rodada/rodada.repository.js';

function getFootballApi(): FootballApiAdapter {
  if (env.FOOTBALL_PROVIDER === 'fifa-2026') {
    return new FifaWorldCup2026Adapter();
  }
  if (env.FOOTBALL_API_KEY === 'mock') {
    return new MockFootballApi();
  }
  return new ApiFutebolAdapter(env.FOOTBALL_API_URL, env.FOOTBALL_API_KEY);
}

const footballApi = getFootballApi();

export async function atualizarResultados(rodadaId: string, campeonatoId: string, numeroRodada: number) {
  const resultados = await footballApi.buscarResultados(campeonatoId, numeroRodada);
  const jogos = await rodadaRepo.buscarJogosDaRodada(rodadaId);

  let atualizados = 0;

  for (const resultado of resultados) {
    const jogo = jogos.find((j) => j.apiJogoId === resultado.apiJogoId);
    if (!jogo) continue;

    if (jogo.status === 'FINALIZADO') continue;

    await rodadaRepo.atualizarResultadoJogo(
      jogo.id,
      resultado.golsCasa,
      resultado.golsVisitante,
      resultado.status,
    );

    atualizados++;
  }

  // Verifica se todos os jogos finalizaram
  const jogosAtualizados = await rodadaRepo.buscarJogosDaRodada(rodadaId);
  const todosFinalizados = jogosAtualizados.every(
    (j) => j.status === 'FINALIZADO' || j.status === 'ADIADO' || j.status === 'CANCELADO',
  );

  return { atualizados, todosFinalizados };
}

export async function buscarJogosParaRodada(campeonatoId: string, numeroRodada: number) {
  return footballApi.buscarJogosRodada(campeonatoId, numeroRodada);
}

export { footballApi };
