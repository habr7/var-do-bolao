import { prisma } from '../../config/database.js';

export async function criarSolicitacao(usuarioId: string, bolaoId: string) {
  return prisma.solicitacaoEntrada.create({
    data: { usuarioId, bolaoId },
    include: {
      usuario: true,
      bolao: { include: { admin: true } },
    },
  });
}

export async function buscarPendentesPorAdmin(adminId: string) {
  return prisma.solicitacaoEntrada.findMany({
    where: {
      status: 'PENDENTE',
      bolao: { adminId },
    },
    include: {
      usuario: true,
      bolao: true,
    },
    orderBy: { criadoEm: 'asc' },
  });
}

export async function buscarSolicitacaoPorId(id: string) {
  return prisma.solicitacaoEntrada.findUnique({
    where: { id },
    include: {
      usuario: true,
      bolao: { include: { admin: true } },
    },
  });
}

export async function buscarPendentePorUsuarioNoBolao(usuarioId: string, bolaoId: string) {
  return prisma.solicitacaoEntrada.findFirst({
    where: {
      usuarioId,
      bolaoId,
      status: 'PENDENTE',
    },
  });
}

export async function atualizarStatus(id: string, status: 'APROVADA' | 'RECUSADA') {
  return prisma.solicitacaoEntrada.update({
    where: { id },
    data: { status, respondidoEm: new Date() },
  });
}
