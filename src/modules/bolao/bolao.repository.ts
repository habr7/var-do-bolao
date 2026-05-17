import { prisma } from '../../config/database.js';
import type { CriarBolaoInput } from './bolao.types.js';

export async function criarBolao(input: CriarBolaoInput) {
  if (!input.codigo) {
    throw new Error('codigo obrigatorio — service deve gerar antes de criar');
  }
  return prisma.bolao.create({
    data: {
      codigo: input.codigo,
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

/**
 * Busca bolao ATIVO pelo codigo curto. Codigo eh sempre upper.
 */
export async function buscarBolaoAtivoPorCodigo(codigo: string) {
  return prisma.bolao.findFirst({
    where: { codigo: codigo.toUpperCase(), status: 'ATIVO' },
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
 *
 * Nota: o Prisma `mode: 'insensitive'` cobre case mas NAO cobre acentos —
 * "Bolão da Jeni" nao casa "Bolao da jeni" sem til. Pra match tolerante a
 * acentos, use `buscarBoloesAtivosPorNomeFuzzy` no service.
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

/**
 * Busca TODOS os boloes ativos (cru, sem filtrar). Usado pelo service pra
 * fazer match fuzzy em JS (normalizacao Unicode + substring).
 *
 * Pra escala >5k boloes ativos isso vira gargalo — migrar pra coluna
 * `nomeNormalizado` indexada quando chegar la.
 */
export async function listarBoloesAtivosTodos() {
  return prisma.bolao.findMany({
    where: { status: 'ATIVO' },
    include: { admin: true },
  });
}

/**
 * Lista boloes ATIVOS do usuario (admin ou participante). Default pra
 * fluxos de ACAO: palpitar, ver proximos jogos, convidar, sair, abrir
 * rodada — onde bolao FINALIZADO nao faz sentido.
 *
 * Se voce quer mostrar tambem boloes encerrados (pra consulta historica
 * tipo "ranking" e "meus palpites"), use `listarBoloesDoUsuarioComHistorico`.
 */
export async function listarBoloesAtivosDoUsuario(usuarioId: string) {
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

/**
 * Lista TODOS os boloes do usuario, ATIVOS + PAUSADOS + FINALIZADOS.
 * Pra fluxos de CONSULTA HISTORICA (ranking final, meus palpites, meus
 * boloes) — onde o usuario merece ver tambem o que ja terminou.
 *
 * Bug 17/05: depois que admin encerrava o bolao, a mensagem dizia
 * "palpites e ranking ficam guardados", mas `listarBoloesDoUsuario`
 * filtrava por ATIVO e o bot contradizia a propria notificacao 17min
 * depois. Esta funcao corrige a contradicao.
 */
export async function listarBoloesDoUsuarioComHistorico(usuarioId: string) {
  return prisma.bolao.findMany({
    where: {
      OR: [
        { adminId: usuarioId },
        { participacoes: { some: { usuarioId } } },
      ],
      // sem filtro de status — pega tudo
    },
    include: {
      participacoes: {
        where: { usuarioId },
      },
    },
    orderBy: [
      { status: 'asc' }, // ATIVO antes de FINALIZADO alfabeticamente
      { criadoEm: 'desc' },
    ],
  });
}

/**
 * @deprecated — use `listarBoloesAtivosDoUsuario` (fluxos de acao) ou
 * `listarBoloesDoUsuarioComHistorico` (consultas historicas). Mantida
 * temporariamente como alias pra ativos pra compatibilidade.
 */
export async function listarBoloesDoUsuario(usuarioId: string) {
  return listarBoloesAtivosDoUsuario(usuarioId);
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
