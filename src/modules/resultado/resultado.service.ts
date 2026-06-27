import { env } from '../../config/env.js';
import { MockFootballApi, ApiFutebolAdapter } from './resultado.fetcher.js';
import { FifaWorldCup2026Adapter } from './fifa.fetcher.js';
import { OpenFootballAdapter } from './openfootball.fetcher.js';
import { HybridFootballAdapter } from './hybrid.fetcher.js';
import type { FootballApiAdapter } from './resultado.types.js';
import * as rodadaRepo from '../rodada/rodada.repository.js';

function getFootballApi(): FootballApiAdapter {
  // v3.22.0 — default mudou de 'openfootball' pra 'hybrid':
  //   FIFA (api.fifa.com, AO VIVO) primário + openfootball como fallback
  //   automático se a FIFA cair. Antes (v3.16.0) era só openfootball, que
  //   tem latência 30-60min e NÃO dá placar ao vivo. O `FIFA_SEASON_ID`
  //   agora tem default (285023), então o fetcher FIFA funciona sem env.
  if (env.FOOTBALL_PROVIDER === 'hybrid') {
    return new HybridFootballAdapter();
  }
  if (env.FOOTBALL_PROVIDER === 'openfootball') {
    return new OpenFootballAdapter();
  }
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
  let palpitesResetadosTotal = 0;

  for (const resultado of resultados) {
    const jogo = jogos.find((j) => j.apiJogoId === resultado.apiJogoId);
    if (!jogo) continue;

    // v3.13.0 — antes pulava jogos FINALIZADOS. Agora permite atualizar
    // se o placar realmente mudou (correção de resultado pela API após
    // VAR/gol anulado/etc), e reseta `Palpite.calculado` pra forçar
    // recálculo no próximo tick. Pula só se placar é exatamente igual.
    if (
      jogo.status === 'FINALIZADO' &&
      jogo.golsCasa === resultado.golsCasa &&
      jogo.golsVisitante === resultado.golsVisitante
    ) {
      continue;
    }

    // Mata-mata: define quem avançou. Usa o classificado do provider se vier;
    // senão, em jogo DECISIVO (placar diferente) infere o vencedor. Em empate
    // (foi pra pênaltis) deixa null até o provider informar — o placar gravado
    // é sempre 90'+prorrogação (pênalti não entra). Em GRUPOS, sempre null.
    let extrasMataMata: { classificadoLado?: 'CASA' | 'VISITANTE' | null; decididoNosPenaltis?: boolean | null } | undefined;
    if (jogo.fase !== 'GRUPOS' && resultado.status === 'FINALIZADO') {
      let classificado = resultado.classificadoLado ?? null;
      if (classificado == null && resultado.golsCasa !== resultado.golsVisitante) {
        classificado = resultado.golsCasa > resultado.golsVisitante ? 'CASA' : 'VISITANTE';
      }
      extrasMataMata = {
        classificadoLado: classificado,
        decididoNosPenaltis: resultado.decididoNosPenaltis ?? null,
      };
    }

    const r = await rodadaRepo.atualizarResultadoJogoComResetCalc(
      jogo.id,
      resultado.golsCasa,
      resultado.golsVisitante,
      resultado.status,
      extrasMataMata,
    );

    atualizados++;
    palpitesResetadosTotal += r.palpitesResetados;

    if (r.placarMudou && r.palpitesResetados > 0) {
      console.log(
        `[scoring-reset] jogoId=${jogo.id} ${jogo.timeCasa}x${jogo.timeVisitante} ` +
          `placarAntes=${r.placarAntes.golsCasa}x${r.placarAntes.golsVisitante} ` +
          `placarDepois=${resultado.golsCasa}x${resultado.golsVisitante} ` +
          `palpitesResetados=${r.palpitesResetados}`,
      );
    }
  }

  // Verifica se todos os jogos finalizaram
  const jogosAtualizados = await rodadaRepo.buscarJogosDaRodada(rodadaId);
  const todosFinalizados = jogosAtualizados.every(
    (j) => j.status === 'FINALIZADO' || j.status === 'ADIADO' || j.status === 'CANCELADO',
  );

  return { atualizados, todosFinalizados, palpitesResetados: palpitesResetadosTotal };
}

export async function buscarJogosParaRodada(campeonatoId: string, numeroRodada: number) {
  return footballApi.buscarJogosRodada(campeonatoId, numeroRodada);
}

export { footballApi };
