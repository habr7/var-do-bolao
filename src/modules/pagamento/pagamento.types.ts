export interface GerarCobrancaInput {
  usuarioId: string;
  valorCentavos: number;
  nomeBolaoPretendido: string;
  senhaBolaoHashPretendido: string;
  /** Minutos ate o PIX expirar. Padrao 30. */
  expiraEmMinutos?: number;
}

export interface CobrancaGerada {
  pagamentoId: string;
  pixExternalId: string;
  pixCopiaCola: string;
  pixQrCodeUrl: string;
  expiraEm: Date;
}

export interface PixAdapter {
  criarCobranca(input: {
    valorCentavos: number;
    descricao: string;
    expiraEmMinutos: number;
  }): Promise<{
    externalId: string;
    pixCopiaCola: string;
    pixQrCodeUrl: string;
    expiraEm: Date;
  }>;

  consultarStatus(externalId: string): Promise<PixStatus>;
}

export type PixStatus = 'PENDENTE' | 'PAGO' | 'EXPIRADO' | 'CANCELADO';
