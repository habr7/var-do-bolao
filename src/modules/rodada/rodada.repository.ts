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
  // Mata-mata: quem avançou + se foi nos pênaltis (placar segue 90'+prorrog).
  extrasMataMata?: { classificadoLado?: 'CASA' | 'VISITANTE' | null; decididoNosPenaltis?: boolean | null },
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
    data: {
      golsCasa,
      golsVisitante,
      status,
      // Só grava os campos de mata-mata quando informados (não sobrescreve com
      // null um classificado já definido por uma atualização anterior).
      ...(extrasMataMata?.classificadoLado != null ? { classificadoLado: extrasMataMata.classificadoLado } : {}),
      ...(extrasMataMata?.decididoNosPenaltis != null ? { decididoNosPenaltis: extrasMataMata.decididoNosPenaltis } : {}),
    },
  });

  let palpitesResetados = 0;
  // v3.14.0 (pré-Copa): resetar SEMPRE que o jogo entra em FINALIZADO
  // (não só em correções). Antes só resetava se placarMudou + tinha
  // placar antes — fluxo de "correção pós-VAR". Mas precisava também
  // resetar na PRIMEIRA vez que placar entra, pra forçar recálculo
  // incremental por jogo. Sem isso, pontos do dia 1 da Copa só sairiam
  // depois que TODOS os 72 jogos da fase de grupos terminassem
  // (~26 jun) porque `calculate-scores` filtrava `status=FINALIZADA`.
  const ehFinalizacao = status === 'FINALIZADO';
  const ehCorrecaoPosCalc = placarMudou && placarAntes.golsCasa !== null;
  if (ehFinalizacao || ehCorrecaoPosCalc) {
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
  // v3.14.0 (pré-Copa): aceita rodadas ABERTAS e FECHADAS — fluxo
  // antigo dependia de admin fechar a rodada manualmente, mas isso
  // nunca acontecia (função `fecharRodada` existe mas nunca era
  // chamada). Resultado: placares nunca eram buscados, pontuação
  // nunca calculada.
  //
  // v3.23.0 — JANELA DE POLLING. Antes retornava qualquer rodada com
  // jogo AGENDADO/AO_VIVO. Pra Copa (1 rodada, 72 jogos em 15 dias) isso
  // fazia o `fetch-results` bater na FIFA a cada 5 min por ~15 dias
  // seguidos — inclusive de madrugada entre dias de jogo, com o próximo
  // jogo a dias de distância. Agora só retorna rodada que tem jogo
  // realmente "em andamento":
  //   - AO_VIVO (sempre, até finalizar), OU
  //   - AGENDADO cujo kickoff JÁ passou (rolando ou recém-encerrado,
  //     aguardando a API confirmar o placar final).
  // Jogo FUTURO (kickoff > agora) e jogo FINALIZADO NÃO disparam fetch —
  // o banco é a fonte de verdade pra finalizados, então não precisa
  // ficar batendo na API por eles. Resultado: a API só é consultada
  // durante/após o kickoff de cada jogo, até ele finalizar.
  const agora = new Date();
  return prisma.rodada.findMany({
    where: {
      status: { in: ['ABERTA', 'FECHADA'] },
      jogos: {
        some: {
          OR: [
            { status: 'AO_VIVO' },
            { status: 'AGENDADO', dataHora: { lte: agora } },
            // Rede de segurança: FINALIZADO sem placar (anomalia que os
            // adapters já previnem com null-guard) continua sendo buscado
            // até preencher. Garante "todo FINALIZADO tem placar no banco".
            { status: 'FINALIZADO', golsCasa: null },
          ],
        },
      },
    },
    include: {
      jogos: true,
      bolao: true,
    },
  });
}
