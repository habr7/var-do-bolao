import bcrypt from 'bcryptjs';
import { prisma } from '../../config/database.js';
import * as bolaoRepo from './bolao.repository.js';
import type { CriarBolaoInput } from './bolao.types.js';

export async function criarBolao(input: CriarBolaoInput) {
  // Admin participa automaticamente do proprio bolao
  const bolao = await bolaoRepo.criarBolao(input);

  await prisma.participacao.create({
    data: { bolaoId: bolao.id, usuarioId: input.adminId },
  });

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
