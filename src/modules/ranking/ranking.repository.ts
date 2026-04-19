import { prisma } from '../../config/database.js';

export async function buscarRankingBolao(bolaoId: string) {
  return prisma.participacao.findMany({
    where: { bolaoId },
    include: { usuario: true },
    orderBy: { pontuacaoTotal: 'desc' },
  });
}

export async function atualizarPontuacaoParticipacao(
  participacaoId: string,
  pontuacaoTotal: number,
  posicaoAtual: number,
) {
  return prisma.participacao.update({
    where: { id: participacaoId },
    data: { pontuacaoTotal, posicaoAtual },
  });
}

export async function buscarPontuacaoDetalhada(usuarioId: string, bolaoId: string) {
  return prisma.palpite.findMany({
    where: {
      usuarioId,
      rodada: { bolaoId },
    },
    include: {
      rodada: true,
      jogos: {
        include: { jogo: true },
      },
    },
    orderBy: { rodada: { numero: 'desc' } },
  });
}
