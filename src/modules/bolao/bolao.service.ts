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
