import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import * as bolaoRepo from './bolao.repository.js';
import * as rodadaRepo from '../rodada/rodada.repository.js';
import { buscarJogosParaRodada } from '../resultado/resultado.service.js';
import type { CriarBolaoInput } from './bolao.types.js';
import { gerarCodigoBolao } from '../../utils/bolao-codigo.js';

export async function criarBolao(input: CriarBolaoInput) {
  // Defensive check global (case-insensitive) contra duplicidade — alem
  // do check no router. Cobre o caso TOCTOU de outro usuario ter criado
  // bolao com o mesmo nome enquanto este estava digitando a senha.
  const duplicado = await prisma.bolao.findFirst({
    where: {
      nome: { equals: input.nome, mode: 'insensitive' },
      status: 'ATIVO',
    },
  });
  if (duplicado) {
    throw new Error(`Ja existe um bolao ativo chamado "${input.nome}". Escolhe outro nome.`);
  }

  // Gera codigo curto unico. Tenta ate 8x — colisao em alfabeto de 30^6
  // (~729M) eh extremamente improvavel pra qualquer escala razoavel, mas
  // o retry blinda contra o caso teorico.
  const codigo = await gerarCodigoUnico();

  // Admin participa automaticamente do proprio bolao
  const bolao = await bolaoRepo.criarBolao({ ...input, codigo });

  await prisma.participacao.create({
    data: { bolaoId: bolao.id, usuarioId: input.adminId },
  });

  // Seed automatico de jogos. Hoje so temos uma "Rodada" (Fase de Grupos
  // Copa 2026) com todos os 72 jogos dentro. Se o adapter de futebol falhar
  // ou nao retornar jogos, o bolao fica criado mas sem jogos — admin pode
  // rodar `npm run seed:fifa -- <bolaoId>` depois.
  try {
    const jogos = await buscarJogosParaRodada(input.campeonatoId, 1);
    if (jogos.length > 0) {
      const primeiroJogo = jogos.reduce(
        (min, j) => (j.dataHora < min ? j.dataHora : min),
        jogos[0].dataHora,
      );
      const rodada = await rodadaRepo.criarRodada({
        bolaoId: bolao.id,
        numero: 1,
        dataAbertura: new Date(),
        dataFechamento: primeiroJogo,
      });
      await rodadaRepo.adicionarJogos(rodada.id, jogos);
    }
  } catch (error) {
    console.error('[bolao.service] erro fazendo seed de jogos:', (error as Error).message);
    // nao falha a criacao do bolao por causa do seed
  }

  return bolao;
}

/**
 * Busca ou cria um Usuario pelo wa_id da Meta. Usado toda vez que o bot
 * recebe uma mensagem — garante idempotencia no "primeiro contato".
 */
export async function getOrCreateUsuario(waId: string, nome: string) {
  const existente = await prisma.usuario.findUnique({ where: { whatsappId: waId } });
  if (existente) {
    // atualiza nome se mudou
    if (existente.nome !== nome && nome) {
      return prisma.usuario.update({ where: { id: existente.id }, data: { nome } });
    }
    return existente;
  }

  return prisma.usuario.create({
    data: { whatsappId: waId, nome: nome || 'Craque', telefone: waId },
  });
}

export async function hashSenha(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function compararSenha(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export async function buscarBolaoAtivoPorNome(nome: string) {
  return bolaoRepo.buscarBolaoAtivoPorNome(nome);
}

export async function buscarBolaoAtivoPorCodigo(codigo: string) {
  return bolaoRepo.buscarBolaoAtivoPorCodigo(codigo);
}

/**
 * Normaliza nome pra match fuzzy: remove acentos, lowercase, trim.
 * "Bolão da Jeni" → "bolao da jeni" → casa "bolao da jeni" sem til.
 */
function normalizarNome(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Busca fuzzy de boloes ativos por nome. Tolerante a acentos, case e
 * variacao de espacamento. Retorna lista ordenada por relevancia:
 *   1. Match exato normalizado (primeiro)
 *   2. Substring direta (alvo contido no nome)
 *   3. Substring reversa (nome contido no alvo)
 *
 * Bug feedback 16/05 (Jeni): "Bolao da jeni" nao achava "Bolão da Jeni"
 * porque Prisma `mode: 'insensitive'` so cobre case, nao acento. Aqui
 * fazemos a normalizacao em JS.
 *
 * Retorna [] quando nada bate; 1 item = match unico; >1 = caller deve
 * mostrar lista numerada pro user escolher.
 */
export async function buscarBoloesAtivosPorNomeFuzzy(termo: string) {
  const alvo = normalizarNome(termo);
  if (!alvo || alvo.length < 2) return [];

  const todos = await bolaoRepo.listarBoloesAtivosTodos();
  const matches = todos
    .map((b) => ({ bolao: b, norm: normalizarNome(b.nome) }))
    .filter(({ norm }) => norm === alvo || norm.includes(alvo) || alvo.includes(norm));

  // Ordena: match exato normalizado primeiro, depois por proximidade
  // de tamanho do nome (heuristica simples — nome mais proximo do alvo
  // costuma ser o certo).
  matches.sort((a, b) => {
    if (a.norm === alvo && b.norm !== alvo) return -1;
    if (b.norm === alvo && a.norm !== alvo) return 1;
    return Math.abs(a.norm.length - alvo.length) - Math.abs(b.norm.length - alvo.length);
  });

  return matches.map((m) => m.bolao);
}

/**
 * Tipo unificado pro resultado da busca por nome (ou codigo) — usado pelo
 * handler de "entrar em bolao" pra decidir o que fazer:
 *   - `unico`   → segue fluxo normal (pede senha ou cria solicitacao direto)
 *   - `multiplos` → mostra lista numerada pro user escolher
 *   - `nenhum`  → pede pra repetir (com contador de tentativas no caller)
 */
export type ResultadoBuscaBolao =
  | { tipo: 'unico'; bolao: Awaited<ReturnType<typeof bolaoRepo.buscarBolaoAtivoPorCodigo>> }
  | { tipo: 'multiplos'; boloes: Array<{ id: string; nome: string; codigo: string }> }
  | { tipo: 'nenhum' };

/**
 * Caminho unificado de busca: tenta codigo primeiro (mais especifico),
 * depois fuzzy por nome. Retorna estrutura discriminada pra caller agir.
 */
export async function buscarBolaoPorTextoLivre(
  texto: string,
): Promise<ResultadoBuscaBolao> {
  // Caller geralmente ja extraiu o codigo antes, mas tentar denovo aqui
  // nao machuca e cobre o caso de chamadores que so passam o texto cru.
  const { extrairCodigoBolao } = await import('../../utils/bolao-codigo.js');
  const codigo = extrairCodigoBolao(texto);
  if (codigo) {
    const porCodigo = await bolaoRepo.buscarBolaoAtivoPorCodigo(codigo);
    if (porCodigo) return { tipo: 'unico', bolao: porCodigo };
  }

  const matches = await buscarBoloesAtivosPorNomeFuzzy(texto);
  if (matches.length === 0) return { tipo: 'nenhum' };
  if (matches.length === 1) return { tipo: 'unico', bolao: matches[0] };
  return {
    tipo: 'multiplos',
    boloes: matches.slice(0, 8).map((b) => ({ id: b.id, nome: b.nome, codigo: b.codigo })),
  };
}

/**
 * Gera codigo curto unico (nao colidente com nenhum bolao existente).
 * Tenta ate 8x com codigo de 6 chars; se ainda colidir, sobe pra 7 chars.
 */
async function gerarCodigoUnico(): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const candidato = gerarCodigoBolao(6);
    const existe = await prisma.bolao.findUnique({ where: { codigo: candidato } });
    if (!existe) return candidato;
  }
  // Fallback ultra-improvavel — sobe pra 7 chars
  for (let i = 0; i < 4; i++) {
    const candidato = gerarCodigoBolao(7);
    const existe = await prisma.bolao.findUnique({ where: { codigo: candidato } });
    if (!existe) return candidato;
  }
  throw new Error('nao consegui gerar codigo unico — tente novamente');
}

export async function listarBoloesDoUsuario(usuarioId: string) {
  return bolaoRepo.listarBoloesDoUsuario(usuarioId);
}

export async function ehAdmin(usuarioId: string, bolaoId: string): Promise<boolean> {
  const bolao = await prisma.bolao.findUnique({ where: { id: bolaoId }, select: { adminId: true } });
  return bolao?.adminId === usuarioId;
}

export async function ehParticipante(usuarioId: string, bolaoId: string): Promise<boolean> {
  const p = await bolaoRepo.buscarParticipacao(bolaoId, usuarioId);
  return !!p;
}

/**
 * Soft delete: marca status como FINALIZADO. Mantem palpites, ranking,
 * historico de jogos pra auditoria — mas o bolao some das listagens
 * normais (listarBoloesDoUsuario / buscarBolaoAtivoPorNome filtram por
 * status ATIVO).
 *
 * Apenas o admin do bolao pode excluir. (Verifica caller.)
 *
 * Retorna a lista de participantes (excluindo o admin) pra caller
 * notificar via DM que o bolao foi encerrado.
 */
export async function excluirBolao(bolaoId: string, adminId: string) {
  const bolao = await prisma.bolao.findUnique({
    where: { id: bolaoId },
    include: { participacoes: { include: { usuario: true } } },
  });
  if (!bolao) throw new Error('Bolao nao encontrado.');
  if (bolao.adminId !== adminId) throw new Error('Apenas o admin pode excluir o bolao.');
  if (bolao.status !== 'ATIVO') throw new Error('Bolao ja esta encerrado.');

  await bolaoRepo.atualizarStatus(bolaoId, 'FINALIZADO');

  // Lista pra notificacao: participantes excluindo o proprio admin
  const participantesPraNotificar = bolao.participacoes
    .filter((p) => p.usuarioId !== adminId)
    .map((p) => ({ whatsappId: p.usuario.whatsappId, nome: p.usuario.nome }));

  return { bolao, participantesPraNotificar };
}

/**
 * Lista boloes em que o usuario eh admin (com codigo, pra exibir).
 */
export async function listarBoloesQueAdministra(adminId: string) {
  return prisma.bolao.findMany({
    where: { adminId, status: 'ATIVO' },
    select: { id: true, nome: true, codigo: true },
    orderBy: { criadoEm: 'desc' },
  });
}

// ============================================================
// ISSUE-016: bolao padrao por usuario
// ============================================================

/**
 * Define o bolao padrao do usuario. Valida que o usuario participa do
 * bolao escolhido (admin ou participante).
 */
export async function definirBolaoPadrao(usuarioId: string, bolaoId: string) {
  const participa = await prisma.participacao.findUnique({
    where: { usuarioId_bolaoId: { usuarioId, bolaoId } },
  });
  if (!participa) {
    throw new Error('Voce nao participa desse bolao.');
  }
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { bolaoPadraoId: bolaoId },
  });
}

/**
 * Le o bolao padrao do usuario. Retorna o ID ou null se nao setado.
 * Valida que o bolao continua ATIVO + usuario continua participando —
 * se nao, limpa o padrao (defensive).
 */
export async function getBolaoPadrao(usuarioId: string): Promise<string | null> {
  const u = await prisma.usuario.findUnique({
    where: { id: usuarioId },
    select: { bolaoPadraoId: true },
  });
  if (!u?.bolaoPadraoId) return null;

  // Valida que o bolao ainda existe + esta ATIVO + usuario participa
  const valido = await prisma.participacao.findFirst({
    where: {
      usuarioId,
      bolaoId: u.bolaoPadraoId,
      bolao: { status: 'ATIVO' },
    },
  });
  if (!valido) {
    // Limpa o padrao orfao
    await prisma.usuario.update({
      where: { id: usuarioId },
      data: { bolaoPadraoId: null },
    });
    return null;
  }
  return u.bolaoPadraoId;
}

/**
 * Limpa o bolao padrao do usuario.
 */
export async function limparBolaoPadrao(usuarioId: string) {
  return prisma.usuario.update({
    where: { id: usuarioId },
    data: { bolaoPadraoId: null },
  });
}

// ============================================================
// ISSUE-020: renomear bolao (admin)
// ============================================================

/**
 * Renomeia o bolao. Valida unicidade global do nome novo (case-insensitive).
 * Retorna o bolao atualizado + lista de participantes (excluindo admin)
 * pra caller notificar.
 */
export async function renomearBolao(bolaoId: string, adminId: string, nomeNovo: string) {
  const bolao = await prisma.bolao.findUnique({
    where: { id: bolaoId },
    include: {
      participacoes: { include: { usuario: true } },
    },
  });
  if (!bolao) throw new Error('Bolao nao encontrado.');
  if (bolao.adminId !== adminId) throw new Error('Apenas o admin pode renomear.');
  if (bolao.status !== 'ATIVO') throw new Error('Bolao nao esta ativo.');
  if (nomeNovo.trim().length < 3 || nomeNovo.trim().length > 60) {
    throw new Error('Nome deve ter entre 3 e 60 caracteres.');
  }

  const nomeTrim = nomeNovo.trim();
  if (bolao.nome === nomeTrim) {
    throw new Error('O nome novo eh igual ao atual.');
  }

  const duplicado = await prisma.bolao.findFirst({
    where: {
      nome: { equals: nomeTrim, mode: 'insensitive' },
      status: 'ATIVO',
      id: { not: bolaoId },
    },
  });
  if (duplicado) {
    throw new Error(`Ja existe um bolao ativo chamado "${nomeTrim}".`);
  }

  const atualizado = await prisma.bolao.update({
    where: { id: bolaoId },
    data: { nome: nomeTrim },
  });

  const participantesPraNotificar = bolao.participacoes
    .filter((p) => p.usuarioId !== adminId)
    .map((p) => ({ whatsappId: p.usuario.whatsappId, nome: p.usuario.nome }));

  return { bolao: atualizado, nomeAntigo: bolao.nome, participantesPraNotificar };
}

// ============================================================
// ISSUE-021: remover participante (admin)
// ============================================================

/**
 * Remove um participante do bolao pelo nome (fuzzy). So o admin pode.
 * Soft remove: deleta Participacao mas mantem palpites passados pra historico.
 */
export async function removerParticipantePorNome(
  bolaoId: string,
  adminId: string,
  nomeParcial: string,
) {
  const bolao = await prisma.bolao.findUnique({ where: { id: bolaoId } });
  if (!bolao) throw new Error('Bolao nao encontrado.');
  if (bolao.adminId !== adminId) throw new Error('Apenas o admin pode remover participantes.');

  // Busca participantes do bolao (exceto o admin)
  const participacoes = await prisma.participacao.findMany({
    where: { bolaoId, NOT: { usuarioId: adminId } },
    include: { usuario: true },
  });

  if (participacoes.length === 0) {
    throw new Error('Esse bolao nao tem outros participantes alem do admin.');
  }

  const normalize = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const alvo = normalize(nomeParcial);

  // Match exato primeiro
  let achado = participacoes.find((p) => normalize(p.usuario.nome) === alvo);
  if (!achado) {
    // Substring
    achado = participacoes.find((p) => {
      const n = normalize(p.usuario.nome);
      return n.includes(alvo) || alvo.includes(n);
    });
  }

  if (!achado) {
    return { tipo: 'nao_encontrado' as const, candidatos: participacoes };
  }

  return { tipo: 'encontrado' as const, participacao: achado, bolaoNome: bolao.nome };
}

/**
 * Executa a remocao apos confirmacao do admin. Recebe participacaoId
 * diretamente pra evitar re-busca por nome.
 */
export async function executarRemocaoParticipante(participacaoId: string, adminId: string) {
  const part = await prisma.participacao.findUnique({
    where: { id: participacaoId },
    include: { usuario: true, bolao: true },
  });
  if (!part) throw new Error('Participacao nao encontrada.');
  if (part.bolao.adminId !== adminId) throw new Error('Apenas o admin pode remover.');
  if (part.usuarioId === adminId) throw new Error('Admin nao pode se remover (use excluir bolao).');

  // Limpa bolao padrao do usuario removido (se era esse)
  await prisma.usuario.updateMany({
    where: { id: part.usuarioId, bolaoPadraoId: part.bolaoId },
    data: { bolaoPadraoId: null },
  });
  await prisma.participacao.delete({ where: { id: participacaoId } });

  return {
    usuarioNome: part.usuario.nome,
    usuarioWhatsappId: part.usuario.whatsappId,
    bolaoNome: part.bolao.nome,
  };
}
