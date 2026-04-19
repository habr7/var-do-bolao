import { prisma } from '../../config/database.js';
import * as repo from './solicitacao.repository.js';

export async function criarSolicitacao(usuarioId: string, bolaoId: string) {
  // Nao cria duplicada pendente
  const existente = await repo.buscarPendentePorUsuarioNoBolao(usuarioId, bolaoId);
  if (existente) {
    throw new Error('Ja existe um pedido pendente pra este bolao.');
  }

  // Nao deixa se ja for participante
  const participa = await prisma.participacao.findUnique({
    where: { usuarioId_bolaoId: { usuarioId, bolaoId } },
  });
  if (participa) {
    throw new Error('Voce ja esta neste bolao.');
  }

  return repo.criarSolicitacao(usuarioId, bolaoId);
}

export async function listarPendentesDoAdmin(adminId: string) {
  return repo.buscarPendentesPorAdmin(adminId);
}

export async function aprovarSolicitacao(solicitacaoId: string, adminId: string) {
  const solicitacao = await repo.buscarSolicitacaoPorId(solicitacaoId);
  if (!solicitacao) throw new Error('Solicitacao nao encontrada.');
  if (solicitacao.bolao.adminId !== adminId) throw new Error('Apenas o admin pode aprovar.');
  if (solicitacao.status !== 'PENDENTE') throw new Error('Solicitacao ja foi respondida.');

  // Cria participacao + marca solicitacao em transacao
  await prisma.$transaction([
    prisma.participacao.create({
      data: {
        usuarioId: solicitacao.usuarioId,
        bolaoId: solicitacao.bolaoId,
      },
    }),
    prisma.solicitacaoEntrada.update({
      where: { id: solicitacaoId },
      data: { status: 'APROVADA', respondidoEm: new Date() },
    }),
  ]);

  return solicitacao;
}

export async function recusarSolicitacao(solicitacaoId: string, adminId: string) {
  const solicitacao = await repo.buscarSolicitacaoPorId(solicitacaoId);
  if (!solicitacao) throw new Error('Solicitacao nao encontrada.');
  if (solicitacao.bolao.adminId !== adminId) throw new Error('Apenas o admin pode recusar.');
  if (solicitacao.status !== 'PENDENTE') throw new Error('Solicitacao ja foi respondida.');

  await repo.atualizarStatus(solicitacaoId, 'RECUSADA');
  return solicitacao;
}

/**
 * Aprovar/recusar pelo NOME do solicitante (fluxo do admin via DM):
 * busca a solicitacao pendente mais recente do admin cujo usuario bata.
 */
export async function buscarPendentePorNome(adminId: string, nomeParcial: string) {
  const pendentes = await repo.buscarPendentesPorAdmin(adminId);
  const alvo = nomeParcial.toLowerCase().trim();

  return pendentes.find((p) => p.usuario.nome.toLowerCase().includes(alvo)) ?? null;
}
