import { prisma } from '../../config/database.js';
import * as rankingRepo from './ranking.repository.js';
import * as palpiteRepo from '../palpite/palpite.repository.js';
import * as bolaoRepo from '../bolao/bolao.repository.js';

// Re-export para manter compatibilidade
export { calcularPontos } from './pontuacao.calc.js';
import { calcularPontos } from './pontuacao.calc.js';
import { ordenarParticipacoesRanking } from './ranking.sort.js';
import { PONTUACAO_PADRAO } from './ranking.types.js';

export async function calcularPontuacaoRodada(rodadaId: string) {
  const palpites = await palpiteRepo.buscarPalpitesDaRodada(rodadaId);

  for (const palpite of palpites) {
    let totalPontos = 0;

    for (const pj of palpite.jogos) {
      // v3.22.0 — pontua SÓ jogo FINALIZADO. Com o provider `hybrid`, a
      // FIFA grava placar PARCIAL ao vivo (status=AO_VIVO) pra exibição;
      // sem este gate, o cálculo incremental pontuaria contra o placar
      // parcial e os pontos OSCILARIAM durante o jogo. Jogo não-finalizado
      // (AGENDADO/AO_VIVO) conta 0 até o apito; quando finaliza, o reset
      // de `Palpite.calculado` força o recálculo com o placar oficial.
      const pontos =
        pj.jogo.status === 'FINALIZADO'
          ? calcularPontos(
              { golsCasa: pj.golsCasa, golsVisitante: pj.golsVisitante },
              { golsCasa: pj.jogo.golsCasa, golsVisitante: pj.jogo.golsVisitante },
            )
          : 0;

      await palpiteRepo.atualizarPontuacaoPalpiteJogo(pj.id, pontos);
      totalPontos += pontos;
    }

    await palpiteRepo.atualizarPontuacaoPalpite(palpite.id, totalPontos);
  }
}

export async function recalcularRanking(bolaoId: string) {
  const participacoes = await rankingRepo.buscarRankingBolao(bolaoId);

  // v3.28.0 — antes isto fazia 2 queries POR USUÁRIO (aggregate + count),
  // ou seja 1+2N queries por recálculo (a cada 5-10min). Agora puxa todos
  // os palpites do bolão de uma vez (1 findMany) e agrega em memória:
  //   total       = soma de pontuacao dos palpites JÁ calculados
  //   totalPalpites = nº de PalpiteJogo do user (desempate, conta todos)
  const palpitesDoBolao = await prisma.palpite.findMany({
    where: { rodada: { bolaoId } },
    select: {
      usuarioId: true,
      pontuacao: true,
      calculado: true,
      _count: { select: { jogos: true } },
    },
  });

  const pontosPorUsuario = new Map<string, number>();
  const palpitesPorUsuario = new Map<string, number>();
  for (const p of palpitesDoBolao) {
    if (p.calculado) {
      pontosPorUsuario.set(p.usuarioId, (pontosPorUsuario.get(p.usuarioId) ?? 0) + p.pontuacao);
    }
    palpitesPorUsuario.set(
      p.usuarioId,
      (palpitesPorUsuario.get(p.usuarioId) ?? 0) + p._count.jogos,
    );
  }

  const pontuacoes = participacoes.map((p) => ({
    participacaoId: p.id,
    nome: p.usuario.nome,
    total: pontosPorUsuario.get(p.usuarioId) ?? 0,
    totalPalpites: palpitesPorUsuario.get(p.usuarioId) ?? 0,
    entradaEm: p.entradaEm,
  }));

  // v3.14.0 — ordenação em cascata (regras canônicas):
  //   1. pontuacaoTotal DESC
  //   2. totalPalpites DESC (mais engajado vence)
  //   3. entradaEm ASC (entrou primeiro vence)
  pontuacoes.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.totalPalpites !== a.totalPalpites) return b.totalPalpites - a.totalPalpites;
    return a.entradaEm.getTime() - b.entradaEm.getTime();
  });

  for (let i = 0; i < pontuacoes.length; i++) {
    await rankingRepo.atualizarPontuacaoParticipacao(
      pontuacoes[i].participacaoId,
      pontuacoes[i].total,
      i + 1,
    );
  }

  return pontuacoes.map((p, i) => ({
    nome: p.nome,
    pontuacaoTotal: p.total,
    posicao: i + 1,
  }));
}

export async function getRankingPorBolao(bolaoId: string) {
  const bolao = await bolaoRepo.buscarBolaoPorId(bolaoId);
  if (!bolao) throw new Error('Bolao nao encontrado.');

  const participacoes = await rankingRepo.buscarRankingBolao(bolao.id);
  const rodadaAtual = bolao.rodadas?.[0]?.numero ?? 0;

  // Ordena pela cascata canônica e deriva a posição do índice (i+1), pra o
  // número exibido SEMPRE bater com a ordem da lista — inclusive em empate
  // (bug "1,2,3,5,4" quando a ordem do banco divergia de posicaoAtual).
  const ordenadas = ordenarParticipacoesRanking(participacoes);

  return {
    bolao,
    rodadaAtual,
    ranking: ordenadas.map((p, i) => ({
      // ISSUE-023 (Sprint 2): inclui usuarioId pra caller poder achar
      // a propria posicao em iteracoes (handleResumoBoloes).
      usuarioId: p.usuarioId,
      nome: p.usuario.nome,
      pontuacaoTotal: p.pontuacaoTotal,
      posicao: i + 1,
    })),
  };
}

export interface EstatisticaPontos {
  nome: string;
  nomeBolao: string;
  cravadas: number; // placar exato — 10 pts
  sete: number; // vencedor + gols de um time — 7 pts
  cinco: number; // só o resultado — 5 pts
  tres: number; // só os gols de um time — 3 pts
  zero: number; // errou tudo — 0 pts
  totalJogos: number; // jogos JÁ pontuados (calculados)
  totalPontos: number; // soma das faixas
  posicao: number; // posição atual no ranking (0 = desconhecida)
}

/**
 * v3.38.0 — Estatística dos pontos do usuário num bolão, quebrada por faixa
 * (quantas cravadas/7/5/3/0). Read-only: só lê `pontosObtidos` de palpites
 * JÁ calculados (jogo FINALIZADO + Palpite.calculado=true). As faixas vêm de
 * PONTUACAO_PADRAO — sem números soltos hardcodados.
 */
export async function getEstatisticaPontos(
  usuarioId: string,
  bolaoId: string,
): Promise<EstatisticaPontos> {
  const pontuados = await rankingRepo.buscarPontosCalculadosDoUsuario(usuarioId, bolaoId);
  const participacao = await bolaoRepo.buscarParticipacao(bolaoId, usuarioId);
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });
  const bolao = await bolaoRepo.buscarBolaoPorId(bolaoId);

  let cravadas = 0;
  let sete = 0;
  let cinco = 0;
  let tres = 0;
  let zero = 0;
  let totalPontos = 0;
  for (const { pontosObtidos } of pontuados) {
    totalPontos += pontosObtidos;
    if (pontosObtidos === PONTUACAO_PADRAO.placarExato) cravadas++;
    else if (pontosObtidos === PONTUACAO_PADRAO.resultadoMaisGols) sete++;
    else if (pontosObtidos === PONTUACAO_PADRAO.resultadoCerto) cinco++;
    else if (pontosObtidos === PONTUACAO_PADRAO.golsDeUmTime) tres++;
    else zero++;
  }

  return {
    nome: usuario?.nome ?? '',
    nomeBolao: bolao?.nome ?? '',
    cravadas,
    sete,
    cinco,
    tres,
    zero,
    totalJogos: pontuados.length,
    totalPontos,
    posicao: participacao?.posicaoAtual ?? 0,
  };
}

export interface JogoDaFaixa {
  timeCasa: string;
  timeVisitante: string;
  golsCasaReal: number | null;
  golsVisitanteReal: number | null;
  golsCasaPalpite: number;
  golsVisitantePalpite: number;
  pontos: number;
}

export interface JogosPorFaixa {
  faixa: number;
  nomeBolao: string;
  jogos: JogoDaFaixa[];
  stats: EstatisticaPontos; // régua de faixas pro rodapé
}

/**
 * v3.39.0 — Drill-down da estatística: lista os jogos de UMA faixa de pontos
 * (10/7/5/3/0), com palpite do user + resultado real. Read-only — só palpites
 * já calculados (jogo FINALIZADO). Reusa `getEstatisticaPontos` pra a régua de
 * faixas exibida no rodapé.
 */
export async function getJogosPorFaixa(
  usuarioId: string,
  bolaoId: string,
  faixa: number,
): Promise<JogosPorFaixa> {
  const [pjs, stats] = await Promise.all([
    rankingRepo.buscarPalpitesJogosPorFaixa(usuarioId, bolaoId, faixa),
    getEstatisticaPontos(usuarioId, bolaoId),
  ]);

  const jogos: JogoDaFaixa[] = pjs.map((pj) => ({
    timeCasa: pj.jogo.timeCasa,
    timeVisitante: pj.jogo.timeVisitante,
    golsCasaReal: pj.jogo.golsCasa,
    golsVisitanteReal: pj.jogo.golsVisitante,
    golsCasaPalpite: pj.golsCasa,
    golsVisitantePalpite: pj.golsVisitante,
    pontos: pj.pontosObtidos,
  }));

  return { faixa, nomeBolao: stats.nomeBolao, jogos, stats };
}

export async function getMeusPontosNoBolao(usuarioId: string, bolaoId: string) {
  const detalhes = await rankingRepo.buscarPontuacaoDetalhada(usuarioId, bolaoId);
  const participacao = await bolaoRepo.buscarParticipacao(bolaoId, usuarioId);
  const usuario = await prisma.usuario.findUnique({ where: { id: usuarioId } });

  return {
    nome: usuario?.nome ?? '',
    pontuacaoTotal: participacao?.pontuacaoTotal ?? 0,
    posicaoAtual: participacao?.posicaoAtual ?? 0,
    rodadas: detalhes,
  };
}
