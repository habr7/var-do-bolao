export interface RegistrarPalpiteInput {
  usuarioId: string;
  rodadaId: string;
  jogoId: string;
  golsCasa: number;
  golsVisitante: number;
}

export interface PalpiteResumo {
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number;
  golsVisitante: number;
  pontosObtidos: number;
}
