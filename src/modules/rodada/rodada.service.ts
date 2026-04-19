import * as rodadaRepo from './rodada.repository.js';
import { prisma } from '../../config/database.js';
import type { JogoInput } from './rodada.types.js';

/**
 * Abre uma rodada. Agora identificado por bolaoId diretamente (chamado pelo
 * job de setup / admin via comandos internos — o fluxo DM pode expor isso no
 * futuro). O admin precisa ser dono do bolao.
 */
export async function abrirRodada(
  bolaoId: string,
  adminId: string,
  numero: number,
  jogos: JogoInput[],
) {
  const bolao = await prisma.bolao.findUnique({ where: { id: bolaoId } });
  if (!bolao) throw new Error('Bolao nao encontrado.');
  if (bolao.adminId !== adminId) throw new Error('Apenas o admin pode abrir rodadas.');
  if (bolao.status !== 'ATIVO') throw new Error('Bolao nao esta ativo.');

  const aberta = await rodadaRepo.buscarRodadaAberta(bolaoId);
  if (aberta) throw new Error(`Rodada ${aberta.numero} ainda esta aberta.`);

  if (jogos.length === 0) throw new Error('Nenhum jogo informado.');

  const primeiroJogo = jogos.reduce((min, j) => (j.dataHora < min ? j.dataHora : min), jogos[0].dataHora);

  const rodada = await rodadaRepo.criarRodada({
    bolaoId,
    numero,
    dataAbertura: new Date(),
    dataFechamento: primeiroJogo,
  });

  await rodadaRepo.adicionarJogos(rodada.id, jogos);

  return rodadaRepo.buscarRodadaPorNumero(bolaoId, numero);
}

export async function fecharRodada(bolaoId: string, adminId: string) {
  const bolao = await prisma.bolao.findUnique({ where: { id: bolaoId } });
  if (!bolao) throw new Error('Bolao nao encontrado.');
  if (bolao.adminId !== adminId) throw new Error('Apenas o admin pode fechar.');

  const aberta = await rodadaRepo.buscarRodadaAberta(bolaoId);
  if (!aberta) throw new Error('Nao ha rodada aberta.');

  await rodadaRepo.fecharRodada(aberta.id);
  return aberta;
}

export async function getRodadaAtualDoBolao(bolaoId: string) {
  return rodadaRepo.buscarRodadaAberta(bolaoId);
}

export async function getJogosDaRodada(rodadaId: string) {
  return rodadaRepo.buscarJogosDaRodada(rodadaId);
}
