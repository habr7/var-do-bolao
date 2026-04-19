import { PONTUACAO_PADRAO, type PontuacaoConfig } from './ranking.types.js';

interface PalpiteJogoCalc {
  golsCasa: number;
  golsVisitante: number;
}

interface JogoCalc {
  golsCasa: number | null;
  golsVisitante: number | null;
}

export function calcularPontos(
  palpite: PalpiteJogoCalc,
  jogo: JogoCalc,
  config: PontuacaoConfig = PONTUACAO_PADRAO,
): number {
  const { golsCasa: pc, golsVisitante: pv } = palpite;
  const gc = jogo.golsCasa;
  const gv = jogo.golsVisitante;

  if (gc === null || gv === null) return 0;

  // Placar exato
  if (pc === gc && pv === gv) return config.placarExato;

  const resultadoPalpite = Math.sign(pc - pv);
  const resultadoReal = Math.sign(gc - gv);
  const acertouResultado = resultadoPalpite === resultadoReal;
  const acertouGolsCasa = pc === gc;
  const acertouGolsVisitante = pv === gv;

  // Resultado + gols de um time
  if (acertouResultado && (acertouGolsCasa || acertouGolsVisitante)) {
    return config.resultadoMaisGols;
  }

  // Apenas resultado
  if (acertouResultado) return config.resultadoCerto;

  // Apenas gols de um time
  if (acertouGolsCasa || acertouGolsVisitante) return config.golsDeUmTime;

  return config.errouTudo;
}
