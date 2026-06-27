import type { FaseTorneio, LadoJogo } from '@prisma/client';
import {
  PONTUACAO_PADRAO,
  TABELA_PONTOS,
  BONUS_CLASSIFICADO,
  type PontuacaoConfig,
} from './ranking.types.js';

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

export interface ResultadoPontuacaoMataMata {
  /** Pontos de PLACAR (faixa por fase) — vão pra PalpiteJogo.pontosObtidos. */
  placar: number;
  /** Bônus de CLASSIFICADO (aditivo) — vai pra PalpiteJogo.bonusObtido. */
  bonus: number;
}

/**
 * Pontuação de um jogo de MATA-MATA, nos dois eixos independentes e aditivos:
 *
 *  1. PLACAR — `calcularPontos` com a config da fase (`TABELA_PONTOS[fase]`).
 *     O placar é SEMPRE o resultado ao fim da prorrogação; pênalti NUNCA entra.
 *  2. CLASSIFICADO — bônus por acertar quem avança. No placar DECISIVO o
 *     classificado palpitado é INFERIDO do vencedor; no EMPATE vem explícito de
 *     `palpiteClassificado` (perguntado na UX). Errar o classificado nunca tira
 *     ponto de placar — a crava fica garantida.
 *
 * Retorna `{ placar, bonus }` SEPARADOS de propósito: o placar é gravado em
 * pontosObtidos (preserva a bucketização por faixa) e o bônus em bonusObtido.
 */
export function pontuarJogoMataMata(args: {
  fase: FaseTorneio;
  palpiteCasa: number;
  palpiteVisitante: number;
  palpiteClassificado: LadoJogo | null; // só preenchido quando o palpite é empate
  resultadoCasa: number | null;
  resultadoVisitante: number | null; // 90'+prorrogação (sem pênaltis)
  classificadoReal: LadoJogo | null; // quem avançou de fato
}): ResultadoPontuacaoMataMata {
  const placar = calcularPontos(
    { golsCasa: args.palpiteCasa, golsVisitante: args.palpiteVisitante },
    { golsCasa: args.resultadoCasa, golsVisitante: args.resultadoVisitante },
    TABELA_PONTOS[args.fase],
  );

  // Sem classificado real definido ainda → só placar, bônus 0.
  if (args.classificadoReal === null) {
    return { placar, bonus: 0 };
  }

  // Classificado palpitado: inferido do vencedor se decisivo; explícito se empate.
  const empate = args.palpiteCasa === args.palpiteVisitante;
  const classificadoPalpitado: LadoJogo | null = empate
    ? args.palpiteClassificado
    : args.palpiteCasa > args.palpiteVisitante
      ? 'CASA'
      : 'VISITANTE';

  const bonus =
    classificadoPalpitado === args.classificadoReal ? BONUS_CLASSIFICADO[args.fase] : 0;

  return { placar, bonus };
}
