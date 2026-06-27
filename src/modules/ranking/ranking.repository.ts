import { prisma } from '../../config/database.js';

export async function buscarRankingBolao(bolaoId: string) {
  return prisma.participacao.findMany({
    where: { bolaoId },
    include: { usuario: true },
    // Ordem determinística mesmo em empate (sem isso o Postgres devolvia
    // ordem arbitrária e o número da posição saía fora de ordem).
    // O display ainda reordena/renumera via ordenarParticipacoesRanking.
    orderBy: [{ pontuacaoTotal: 'desc' }, { posicaoAtual: 'asc' }, { entradaEm: 'asc' }],
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

/**
 * v3.38.0 — Pontos JÁ calculados do usuário num bolão, pra estatística por
 * faixa (cravadas/7/5/3/0). Só PalpiteJogo de palpite `calculado=true` em
 * jogo `FINALIZADO` → `pontosObtidos` é o valor OFICIAL (exatamente
 * 10/7/5/3/0), nunca um parcial de jogo rolando. Devolve só `pontosObtidos`
 * pra o service agregar em memória.
 */
export async function buscarPontosCalculadosDoUsuario(usuarioId: string, bolaoId: string) {
  return prisma.palpiteJogo.findMany({
    where: {
      palpite: { usuarioId, rodada: { bolaoId }, calculado: true },
      jogo: { status: 'FINALIZADO' },
    },
    // bonusObtido + jogo.fase pra o service bucketizar por FASE (no mata-mata a
    // cravada vale 12/15/18/22, não 10) e somar o bônus de classificado.
    select: { pontosObtidos: true, bonusObtido: true, jogo: { select: { fase: true } } },
  });
}

/**
 * v3.39.0 — Jogos do usuário de UMA faixa de pontos (drill-down da
 * estatística): mesmos filtros de `buscarPontosCalculadosDoUsuario` +
 * `pontosObtidos === faixa`, mas inclui o jogo (placar real) e o nome do
 * bolão pra montar a lista "palpite x resultado real". Ordena do mais
 * recente pro mais antigo.
 */
export async function buscarPalpitesJogosPorFaixa(
  usuarioId: string,
  bolaoId: string,
  pontos: number,
) {
  return prisma.palpiteJogo.findMany({
    where: {
      palpite: { usuarioId, rodada: { bolaoId }, calculado: true },
      jogo: { status: 'FINALIZADO' },
      pontosObtidos: pontos,
    },
    include: {
      jogo: true,
      palpite: { include: { rodada: { include: { bolao: { select: { nome: true } } } } } },
    },
    orderBy: { jogo: { dataHora: 'desc' } },
  });
}
