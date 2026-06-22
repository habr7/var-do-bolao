import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.38.0 — getEstatisticaPontos: quebra dos pontos do user por faixa
 * (cravadas/10, 7, 5, 3, 0). Read-only — só agrega `pontosObtidos` de
 * palpites JÁ calculados (jogo FINALIZADO + Palpite.calculado=true).
 *
 * Mocka o prisma direto (os repos reais rodam contra o mock), validando
 * tanto a query (filtro calculado/FINALIZADO) quanto a contagem por faixa.
 */

const h = vi.hoisted(() => ({
  palpiteJogoFindMany: vi.fn(),
  participacaoFindUnique: vi.fn(),
  usuarioFindUnique: vi.fn(),
  bolaoFindUnique: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    palpiteJogo: { findMany: (...a: unknown[]) => h.palpiteJogoFindMany(...a) },
    participacao: { findUnique: (...a: unknown[]) => h.participacaoFindUnique(...a) },
    usuario: { findUnique: (...a: unknown[]) => h.usuarioFindUnique(...a) },
    bolao: { findUnique: (...a: unknown[]) => h.bolaoFindUnique(...a) },
  },
}));

const { getEstatisticaPontos, getJogosPorFaixa } = await import('../../src/modules/ranking/ranking.service.js');

describe('getEstatisticaPontos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.usuarioFindUnique.mockResolvedValue({ id: 'u1', nome: 'Humberto' });
    h.bolaoFindUnique.mockResolvedValue({ id: 'b1', nome: 'Bolão kzados' });
    h.participacaoFindUnique.mockResolvedValue({ posicaoAtual: 3, pontuacaoTotal: 47 });
  });

  it('conta cada faixa e soma o total', async () => {
    h.palpiteJogoFindMany.mockResolvedValue([
      { pontosObtidos: 10 },
      { pontosObtidos: 7 },
      { pontosObtidos: 7 },
      { pontosObtidos: 7 },
      { pontosObtidos: 7 },
      { pontosObtidos: 5 },
      { pontosObtidos: 5 },
      { pontosObtidos: 3 },
      { pontosObtidos: 3 },
      { pontosObtidos: 0 },
    ]);

    const stats = await getEstatisticaPontos('u1', 'b1');

    expect(stats.cravadas).toBe(1);
    expect(stats.sete).toBe(4);
    expect(stats.cinco).toBe(2);
    expect(stats.tres).toBe(2);
    expect(stats.zero).toBe(1);
    expect(stats.totalJogos).toBe(10);
    expect(stats.totalPontos).toBe(54); // 10 + 4×7 + 2×5 + 2×3 + 0
    expect(stats.posicao).toBe(3);
    expect(stats.nome).toBe('Humberto');
    expect(stats.nomeBolao).toBe('Bolão kzados');
  });

  it('query filtra só palpites calculados em jogo FINALIZADO', async () => {
    h.palpiteJogoFindMany.mockResolvedValue([]);
    await getEstatisticaPontos('u1', 'b1');

    const arg = h.palpiteJogoFindMany.mock.calls[0][0] as {
      where: { palpite: { usuarioId: string; calculado: boolean; rodada: { bolaoId: string } }; jogo: { status: string } };
    };
    expect(arg.where.palpite.usuarioId).toBe('u1');
    expect(arg.where.palpite.calculado).toBe(true);
    expect(arg.where.palpite.rodada.bolaoId).toBe('b1');
    expect(arg.where.jogo.status).toBe('FINALIZADO');
  });

  it('zera tudo quando o user não tem jogo pontuado', async () => {
    h.palpiteJogoFindMany.mockResolvedValue([]);
    const stats = await getEstatisticaPontos('u1', 'b1');
    expect(stats.totalJogos).toBe(0);
    expect(stats.totalPontos).toBe(0);
    expect(stats.cravadas + stats.sete + stats.cinco + stats.tres + stats.zero).toBe(0);
  });
});

describe('getJogosPorFaixa (v3.39.0 — drill-down)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.usuarioFindUnique.mockResolvedValue({ id: 'u1', nome: 'Humberto' });
    h.bolaoFindUnique.mockResolvedValue({ id: 'b1', nome: 'Bolão kzados' });
    h.participacaoFindUnique.mockResolvedValue({ posicaoAtual: 1, pontuacaoTotal: 20 });

    // palpiteJogo.findMany é chamado 2x: com `include` (lista da faixa) e com
    // `select` (agregado da estatística do rodapé). Distingue pelos args.
    h.palpiteJogoFindMany.mockImplementation((arg: any) => {
      if (arg?.include) {
        const faixa = arg.where.pontosObtidos;
        if (faixa === 10) {
          return Promise.resolve([
            {
              golsCasa: 2,
              golsVisitante: 1,
              pontosObtidos: 10,
              jogo: { timeCasa: 'Brasil', timeVisitante: 'Marrocos', golsCasa: 2, golsVisitante: 1 },
            },
          ]);
        }
        return Promise.resolve([]); // outras faixas vazias neste fixture
      }
      // agregado: 1×10 + 1×7
      return Promise.resolve([{ pontosObtidos: 10 }, { pontosObtidos: 7 }]);
    });
  });

  it('lista os jogos da faixa 10 com palpite e resultado real', async () => {
    const res = await getJogosPorFaixa('u1', 'b1', 10);
    expect(res.faixa).toBe(10);
    expect(res.nomeBolao).toBe('Bolão kzados');
    expect(res.jogos).toHaveLength(1);
    expect(res.jogos[0]).toMatchObject({
      timeCasa: 'Brasil',
      timeVisitante: 'Marrocos',
      golsCasaReal: 2,
      golsVisitanteReal: 1,
      golsCasaPalpite: 2,
      golsVisitantePalpite: 1,
      pontos: 10,
    });
    // régua de faixas (stats) vem junto pro rodapé
    expect(res.stats.cravadas).toBe(1);
    expect(res.stats.sete).toBe(1);
  });

  it('query filtra pela faixa pedida (pontosObtidos) + calculado + FINALIZADO', async () => {
    await getJogosPorFaixa('u1', 'b1', 7);
    const includeCall = h.palpiteJogoFindMany.mock.calls
      .map((c) => c[0])
      .find((a: any) => a?.include);
    expect(includeCall.where.pontosObtidos).toBe(7);
    expect(includeCall.where.palpite.calculado).toBe(true);
    expect(includeCall.where.jogo.status).toBe('FINALIZADO');
  });

  it('faixa sem jogos devolve lista vazia (mas com a régua de faixas)', async () => {
    const res = await getJogosPorFaixa('u1', 'b1', 3);
    expect(res.jogos).toHaveLength(0);
    expect(res.stats.totalJogos).toBe(2);
  });
});
