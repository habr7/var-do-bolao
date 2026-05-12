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
 *
 * Match eh tolerante a acento, case e ordem das palavras (admin pode
 * digitar "joao silva" pra um usuario chamado "João da Silva").
 */
export async function buscarPendentePorNome(adminId: string, nomeParcial: string) {
  const pendentes = await repo.buscarPendentesPorAdmin(adminId);
  const alvo = normalize(nomeParcial);
  if (!alvo) return null;

  // 1) Match exato normalizado (mais especifico)
  const exato = pendentes.find((p) => normalize(p.usuario.nome) === alvo);
  if (exato) return exato;

  // 2) Substring nos dois sentidos (inclui ou eh incluido)
  const subs = pendentes.find((p) => {
    const n = normalize(p.usuario.nome);
    return n.includes(alvo) || alvo.includes(n);
  });
  if (subs) return subs;

  // 3) Match por sobreposicao de tokens (1+ palavra em comum)
  const tokensAlvo = new Set(alvo.split(/\s+/).filter((t) => t.length >= 3));
  if (tokensAlvo.size > 0) {
    const candidatos = pendentes
      .map((p) => {
        const tokens = new Set(normalize(p.usuario.nome).split(/\s+/).filter((t) => t.length >= 3));
        const overlap = [...tokensAlvo].filter((t) => tokens.has(t)).length;
        return { p, overlap };
      })
      .filter((c) => c.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap);
    if (candidatos.length > 0) return candidatos[0].p;
  }

  return null;
}

/**
 * Aprova TODOS os pedidos pendentes do admin de uma vez (operacao em lote).
 * Cria participacao + marca solicitacao como APROVADA em uma transacao
 * por solicitacao — se uma falhar (ex: solicitacao corrida), as outras
 * seguem. Retorna a lista de solicitacoes efetivamente aprovadas (com
 * usuario + bolao incluidos) pra caller mandar notificacao.
 */
export async function aprovarTodosPendentes(adminId: string) {
  const pendentes = await repo.buscarPendentesPorAdmin(adminId);
  const aprovadas: typeof pendentes = [];

  for (const sol of pendentes) {
    try {
      await prisma.$transaction([
        prisma.participacao.upsert({
          where: { usuarioId_bolaoId: { usuarioId: sol.usuarioId, bolaoId: sol.bolaoId } },
          create: { usuarioId: sol.usuarioId, bolaoId: sol.bolaoId },
          update: {},
        }),
        prisma.solicitacaoEntrada.update({
          where: { id: sol.id },
          data: { status: 'APROVADA', respondidoEm: new Date() },
        }),
      ]);
      aprovadas.push(sol);
    } catch (err) {
      console.error(`[solicitacao] falha ao aprovar em lote ${sol.id}:`, (err as Error).message);
    }
  }

  return aprovadas;
}

/**
 * Recusa TODOS os pedidos pendentes do admin. Best-effort, igual ao
 * aprovarTodos: se uma falhar, as demais continuam.
 */
export async function recusarTodosPendentes(adminId: string) {
  const pendentes = await repo.buscarPendentesPorAdmin(adminId);
  const recusadas: typeof pendentes = [];

  for (const sol of pendentes) {
    try {
      await repo.atualizarStatus(sol.id, 'RECUSADA');
      recusadas.push(sol);
    } catch (err) {
      console.error(`[solicitacao] falha ao recusar em lote ${sol.id}:`, (err as Error).message);
    }
  }

  return recusadas;
}

export async function contarPendentesDoAdmin(adminId: string): Promise<number> {
  return prisma.solicitacaoEntrada.count({
    where: { status: 'PENDENTE', bolao: { adminId } },
  });
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
