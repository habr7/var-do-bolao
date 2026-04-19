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

export interface RankingEntry {
  usuarioId: string;
  nome: string;
  pontuacaoTotal: number;
  posicao: number;
}
