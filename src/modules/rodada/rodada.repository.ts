import { prisma } from '../../config/database.js';
import type { CriarRodadaInput, JogoInput } from './rodada.types.js';

export async function criarRodada(input: CriarRodadaInput) {
  return prisma.rodada.create({
    data: {
      bolaoId: input.bolaoId,
      numero: input.numero,
      dataAbertura: input.dataAbertura,
      dataFechamento: input.dataFechamento,
    },
  });
}

export async function buscarRodadaAberta(bolaoId: string) {
  return prisma.rodada.findFirst({
    where: { bolaoId, status: 'ABERTA' },
    include: {
      jogos: { orderBy: { dataHora: 'asc' } },
    },
  });
}

export async function buscarRodadaPorNumero(bolaoId: string, numero: number) {
  return prisma.rodada.findUnique({
    where: { bolaoId_numero: { bolaoId, numero } },
    include: {
      jogos: { orderBy: { dataHora: 'asc' } },
    },
  });
}

export async function fecharRodada(rodadaId: string) {
  return prisma.rodada.update({
    where: { id: rodadaId },
    data: { status: 'FECHADA' },
  });
}

export async function finalizarRodada(rodadaId: string) {
  return prisma.rodada.update({
    where: { id: rodadaId },
    data: { status: 'FINALIZADA' },
  });
}

export async function adicionarJogos(rodadaId: string, jogos: JogoInput[]) {
  return prisma.jogo.createMany({
    data: jogos.map((j) => ({
      rodadaId,
      apiJogoId: j.apiJogoId,
      timeCasa: j.timeCasa,
      timeVisitante: j.timeVisitante,
      dataHora: j.dataHora,
    })),
  });
}

export async function buscarJogosDaRodada(rodadaId: string) {
  return prisma.jogo.findMany({
    where: { rodadaId },
    orderBy: { dataHora: 'asc' },
  });
}

export async function atualizarResultadoJogo(
  jogoId: string,
  golsCasa: number,
  golsVisitante: number,
  status: 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO',
) {
  return prisma.jogo.update({
    where: { id: jogoId },
    data: { golsCasa, golsVisitante, status },
  });
}

export async function buscarRodadasComJogosEmAndamento() {
  return prisma.rodada.findMany({
    where: {
      status: 'FECHADA',
      jogos: {
        some: {
          status: { in: ['AGENDADO', 'AO_VIVO'] },
        },
      },
    },
    include: {
      jogos: true,
      bolao: true,
    },
  });
}
