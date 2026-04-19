export interface ResultadoJogo {
  apiJogoId: string;
  golsCasa: number;
  golsVisitante: number;
  status: 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO';
}

export interface FootballApiAdapter {
  buscarResultados(campeonatoId: string, rodada: number): Promise<ResultadoJogo[]>;
  buscarJogosRodada(campeonatoId: string, rodada: number): Promise<JogoApi[]>;
}

export interface JogoApi {
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
  dataHora: Date;
}
