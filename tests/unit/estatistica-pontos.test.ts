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

const { getEstatisticaPontos } = await import('../../src/modules/ranking/ranking.service.js');

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
