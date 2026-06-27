export interface ResultadoJogo {
  apiJogoId: string;
  golsCasa: number;
  golsVisitante: number;
  status: 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO';
  // Mata-mata — placar é 90'+prorrogação (pênalti fora). Quando o provider
  // souber, informa quem avançou e se foi nos pênaltis. Opcionais: em jogo
  // DECISIVO (placar diferente) o service infere o classificado do vencedor.
  classificadoLado?: 'CASA' | 'VISITANTE' | null;
  decididoNosPenaltis?: boolean | null;
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
