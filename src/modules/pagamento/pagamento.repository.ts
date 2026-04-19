import { prisma } from '../../config/database.js';

export async function criarPagamento(input: {
  usuarioId: string;
  valorCentavos: number;
  pixExternalId: string;
  pixCopiaCola: string;
  pixQrCodeUrl: string;
  nomeBolaoPretendido: string;
  senhaBolaoHashPretendido: string;
  expiraEm: Date;
}) {
  return prisma.pagamento.create({
    data: {
      usuarioId: input.usuarioId,
      valorCentavos: input.valorCentavos,
      pixExternalId: input.pixExternalId,
      pixCopiaCola: input.pixCopiaCola,
      pixQrCodeUrl: input.pixQrCodeUrl,
      nomeBolaoPretendido: input.nomeBolaoPretendido,
      senhaBolaoHashPretendido: input.senhaBolaoHashPretendido,
      expiraEm: input.expiraEm,
    },
  });
}

export async function buscarPagamentoPorId(id: string) {
  return prisma.pagamento.findUnique({ where: { id }, include: { usuario: true } });
}

export async function buscarPendentesNaoExpirados() {
  return prisma.pagamento.findMany({
    where: {
      status: 'PENDENTE',
      expiraEm: { gt: new Date() },
    },
    include: { usuario: true },
  });
}

export async function marcarComoPago(id: string) {
  return prisma.pagamento.update({
    where: { id },
    data: { status: 'PAGO', pagoEm: new Date() },
  });
}

export async function marcarComoExpirado(id: string) {
  return prisma.pagamento.update({
    where: { id },
    data: { status: 'EXPIRADO' },
  });
}
