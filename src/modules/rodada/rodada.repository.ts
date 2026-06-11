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

/**
 * v3.13.0 — atualiza placar e, se mudou em relação ao salvo, RESETA
 * `Palpite.calculado` pra `false` em TODAS as rodadas que tenham esse
 * jogo. Necessário pra que `calculate-scores.job` recalcule no próximo
 * tick (10min). Sem isso, a flag `calculado=true` bloqueava recálculo
 * eternamente — bug latente quando API corrige resultado pós-cálculo.
 *
 * Retorna info pra log estruturado: se placar mudou e quantos palpites
 * foram marcados pra recálculo.
 */
export async function atualizarResultadoJogoComResetCalc(
  jogoId: string,
  golsCasa: number,
  golsVisitante: number,
  status: 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO',
): Promise<{
  placarMudou: boolean;
  placarAntes: { golsCasa: number | null; golsVisitante: number | null };
  palpitesResetados: number;
}> {
  const jogoAntes = await prisma.jogo.findUnique({
    where: { id: jogoId },
    select: { golsCasa: true, golsVisitante: true },
  });
  const placarAntes = {
    golsCasa: jogoAntes?.golsCasa ?? null,
    golsVisitante: jogoAntes?.golsVisitante ?? null,
  };
  const placarMudou =
    placarAntes.golsCasa !== golsCasa || placarAntes.golsVisitante !== golsVisitante;

  await prisma.jogo.update({
    where: { id: jogoId },
    data: { golsCasa, golsVisitante, status },
  });

  let palpitesResetados = 0;
  if (placarMudou && placarAntes.golsCasa !== null) {
    // Só reseta se já tinha placar antes (correção, não primeira inserção).
    const reset = await prisma.palpite.updateMany({
      where: {
        calculado: true,
        jogos: { some: { jogoId } },
      },
      data: { calculado: false },
    });
    palpitesResetados = reset.count;
  }

  return { placarMudou, placarAntes, palpitesResetados };
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
