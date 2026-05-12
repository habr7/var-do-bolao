export interface CriarBolaoInput {
  // Codigo curto unico (6 chars). Gerado no service — caller nao precisa
  // passar; mantido como opcional aqui pro service que controla a unicidade.
  codigo?: string;
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
