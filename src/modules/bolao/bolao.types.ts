export interface CriarBolaoInput {
  nome: string;
  senhaHash: string;
  adminId: string;
  pagamentoId: string;
  campeonatoId: string;
  campeonatoNome: string;
}

export interface BolaoResumo {
  id: string;
  nome: string;
  campeonatoNome: string;
  status: string;
  totalParticipantes: number;
  souAdmin: boolean;
}
