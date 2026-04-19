export interface CriarRodadaInput {
  bolaoId: string;
  numero: number;
  dataAbertura: Date;
  dataFechamento: Date;
}

export interface JogoInput {
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
  dataHora: Date;
}
