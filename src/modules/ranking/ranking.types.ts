import type { FaseTorneio } from '@prisma/client';

export interface PontuacaoConfig {
  placarExato: number;
  resultadoMaisGols: number;
  resultadoCerto: number;
  golsDeUmTime: number;
  errouTudo: number;
}

export const PONTUACAO_PADRAO: PontuacaoConfig = {
  placarExato: 10,
  resultadoMaisGols: 7,
  resultadoCerto: 5,
  golsDeUmTime: 3,
  errouTudo: 0,
};

// ============================================
// PONTUAÇÃO POR FASE — fonte única da verdade do mata-mata
// ============================================
//
// Eixo 1 (PLACAR): mesma estrutura de faixas do `calcularPontos`, mas os
// valores sobem por fase. GRUPOS e R32 (16-avos) REFERENCIAM PONTUACAO_PADRAO
// — garante ZERO regressão na fase de grupos já apurada e mantém o R32 no mesmo
// nível dos grupos (só o bônus de classificado entra a partir do R32).
//
// Mapeamento dos nomes da spec → campos reais do PontuacaoConfig:
//   exato → placarExato | resultadoMaisGols → resultadoMaisGols
//   soResultado → resultadoCerto | soGols → golsDeUmTime | errouTudo = 0
export const TABELA_PONTOS: Record<FaseTorneio, PontuacaoConfig> = {
  GRUPOS: PONTUACAO_PADRAO,
  R32: PONTUACAO_PADRAO,
  OITAVAS: { placarExato: 12, resultadoMaisGols: 8, resultadoCerto: 6, golsDeUmTime: 4, errouTudo: 0 },
  QUARTAS: { placarExato: 15, resultadoMaisGols: 10, resultadoCerto: 7, golsDeUmTime: 5, errouTudo: 0 },
  SEMI: { placarExato: 18, resultadoMaisGols: 12, resultadoCerto: 9, golsDeUmTime: 6, errouTudo: 0 },
  TERCEIRO: { placarExato: 12, resultadoMaisGols: 8, resultadoCerto: 6, golsDeUmTime: 4, errouTudo: 0 },
  FINAL: { placarExato: 22, resultadoMaisGols: 15, resultadoCerto: 11, golsDeUmTime: 7, errouTudo: 0 },
};

// Eixo 2 (CLASSIFICADO): bônus ADITIVO ganho ao acertar quem avança. Inferido
// do vencedor no placar decisivo; perguntado quando o palpite é empate. Errar o
// classificado NUNCA tira ponto de placar. GRUPOS = 0 (não existe lá).
export const BONUS_CLASSIFICADO: Record<FaseTorneio, number> = {
  GRUPOS: 0,
  R32: 3,
  OITAVAS: 3,
  QUARTAS: 4,
  SEMI: 5,
  TERCEIRO: 3,
  FINAL: 6,
};

export interface RankingEntry {
  usuarioId: string;
  nome: string;
  pontuacaoTotal: number;
  posicao: number;
}
