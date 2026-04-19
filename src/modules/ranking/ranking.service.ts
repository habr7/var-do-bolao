import { prisma } from '../../config/database.js';
import * as rankingRepo from './ranking.repository.js';
import * as palpiteRepo from '../palpite/palpite.repository.js';
import * as bolaoRepo from '../bolao/bolao.repository.js';

// Re-export para manter compatibilidade
export { calcularPontos } from './pontuacao.calc.js';
import { calcularPontos } from './pontuacao.calc.js';

export async function calcularPontuacaoRodada(rodadaId: string) {
  const palpites = await palpiteRepo.buscarPalpitesDaRodada(rodadaId);

  for (const palpite of palpites) {
    let totalPontos = 0;

    for (const pj of palpite.jogos) {
      const pontos = calcularPontos(
        { golsCasa: pj.golsCasa, golsVisitante: pj.golsVisitante },
        { golsCasa: pj.jogo.golsCasa, golsVisitante: pj.jogo.golsVisitante },
      );

      await palpiteRepo.atualizarPontuacaoPalpiteJogo(pj.id, pontos);
      totalPontos += pontos;
    }

    await palpiteRepo.atualizarPontuacaoPalpite(palpite.id, totalPontos);
  }
}

export async function recalcularRanking(bolaoId: string) {
  const participacoes = await rankingRepo.buscarRankingBolao(bolaoId);

  const pontuacoes = await Promise.all(
    participacoes.map(async (p) => {
      const palpites = await prisma.palpite.aggregate({
        where: {
          usuarioId: p.usuarioId,
          rodada: { bolaoId },
          calculado: true,
        },
        _sum: { pontuacao: true },
      });

      return {
        participacaoId: p.id,
        nome: p.usuario.nome,
        total: palpites._sum.pontuacao ?? 0,
      };
    }),
  );

  pontuacoes.sort((a, b) => b.total - a.total);

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

  return {
    bolao,
    rodadaAtual,
    ranking: participacoes.map((p, i) => ({
      nome: p.usuario.nome,
      pontuacaoTotal: p.pontuacaoTotal,
      posicao: p.posicaoAtual || i + 1,
    })),
  };
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
