import { prisma } from '../../config/database.js';
import type { CriarBolaoInput } from './bolao.types.js';

export async function criarBolao(input: CriarBolaoInput) {
  return prisma.bolao.create({
    data: {
      nome: input.nome,
      senhaHash: input.senhaHash,
      adminId: input.adminId,
      ...(input.pagamentoId ? { pagamentoId: input.pagamentoId } : {}),
      campeonatoId: input.campeonatoId,
      campeonatoNome: input.campeonatoNome,
    },
    include: { admin: true },
  });
}

export async function buscarBolaoPorId(id: string) {
  return prisma.bolao.findUnique({
    where: { id },
    include: {
      admin: true,
      participacoes: {
        include: { usuario: true },
        orderBy: { pontuacaoTotal: 'desc' },
      },
      rodadas: { orderBy: { numero: 'desc' }, take: 1 },
    },
  });
}

/**
 * Busca bolao ativo pelo nome (nao ha unicidade global, mas por admin ha unique).
 * Aceita nome exato ou case-insensitive.
 */
export async function buscarBolaoAtivoPorNome(nome: string) {
  return prisma.bolao.findFirst({
    where: {
      nome: { equals: nome, mode: 'insensitive' },
      status: 'ATIVO',
    },
    include: { admin: true },
  });
}

export async function listarBoloesDoUsuario(usuarioId: string) {
  return prisma.bolao.findMany({
    where: {
      OR: [
        { adminId: usuarioId },
        { participacoes: { some: { usuarioId } } },
      ],
      status: 'ATIVO',
    },
    include: {
      participacoes: {
        where: { usuarioId },
      },
    },
    orderBy: { criadoEm: 'desc' },
  });
}

export async function buscarParticipacao(bolaoId: string, usuarioId: string) {
  return prisma.participacao.findUnique({
    where: { usuarioId_bolaoId: { usuarioId, bolaoId } },
  });
}

export async function atualizarStatus(id: string, status: 'ATIVO' | 'PAUSADO' | 'FINALIZADO') {
  return prisma.bolao.update({
    where: { id },
    data: { status },
  });
}
