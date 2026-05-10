export interface CriarBolaoInput {
  nome: string;
  senhaHash: string;
  adminId: string;
  // Opcional: o fluxo atual cria bolao sem pagamento (PIX desativado).
  // Quando o pagamento voltar, este campo passa a ser obrigatorio em runtime.
  pagamentoId?: string;
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
