import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mata-mata — registrarClassificadoPalpite grava o lado que o user cravou como
 * classificado (quem passa nos pênaltis) nos PalpiteJogo das rodadas dadas.
 * Usa updateMany (não falha se o palpite não existir nalgum bolão).
 */
const h = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock('../../src/config/database.js', () => ({
  prisma: { palpiteJogo: { updateMany: (...a: unknown[]) => h.updateMany(...a) } },
}));

const { registrarClassificadoPalpite } = await import('../../src/modules/palpite/palpite.service.js');

describe('registrarClassificadoPalpite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('atualiza o classificadoPalpite filtrando por usuário, rodadas e jogo', async () => {
    h.updateMany.mockResolvedValue({ count: 1 });

    const n = await registrarClassificadoPalpite({
      usuarioId: 'u1',
      rodadaIds: ['r1'],
      timeCasa: 'Brasil',
      timeVisitante: 'Argentina',
      lado: 'CASA',
    });

    expect(n).toBe(1);
    const arg = h.updateMany.mock.calls[0][0] as {
      where: { palpite: { usuarioId: string; rodadaId: { in: string[] } }; jogo: { timeCasa: string; timeVisitante: string } };
      data: { classificadoPalpite: string };
    };
    expect(arg.where.palpite.usuarioId).toBe('u1');
    expect(arg.where.palpite.rodadaId.in).toEqual(['r1']);
    expect(arg.where.jogo).toEqual({ timeCasa: 'Brasil', timeVisitante: 'Argentina' });
    expect(arg.data.classificadoPalpite).toBe('CASA');
  });

  it('aplica em N rodadas (multi-bolão) e retorna a contagem do updateMany', async () => {
    h.updateMany.mockResolvedValue({ count: 3 });
    const n = await registrarClassificadoPalpite({
      usuarioId: 'u1',
      rodadaIds: ['r1', 'r2', 'r3'],
      timeCasa: 'França',
      timeVisitante: 'Espanha',
      lado: 'VISITANTE',
    });
    expect(n).toBe(3);
    const arg = h.updateMany.mock.calls[0][0] as { where: { palpite: { rodadaId: { in: string[] } } } };
    expect(arg.where.palpite.rodadaId.in).toEqual(['r1', 'r2', 'r3']);
  });
});
