export interface SolicitacaoComRelacoes {
  id: string;
  status: 'PENDENTE' | 'APROVADA' | 'RECUSADA';
  usuario: { id: string; nome: string; whatsappId: string };
  bolao: { id: string; nome: string; adminId: string };
  criadoEm: Date;
}
