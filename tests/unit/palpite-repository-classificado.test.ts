import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * registrarPalpiteJogo (UPSERT) deve ZERAR classificadoPalpite quando o placar
 * vira DECISIVO (não é mais empate) — senão fica órfão e o display mostra
 * "você acha que X passa" num jogo que não é mais empate. Em EMPATE, não mexe.
 */
const h = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock('../../src/config/database.js', () => ({
  prisma: { palpiteJogo: { upsert: (...a: unknown[]) => h.upsert(...a) } },
}));

const { registrarPalpiteJogo } = await import('../../src/modules/palpite/palpite.repository.js');

type UpsertArg = { update: { golsCasa: number; golsVisitante: number; classificadoPalpite?: unknown } };

describe('registrarPalpiteJogo — limpeza de classificadoPalpite', () => {
  beforeEach(() => vi.clearAllMocks());

  it('placar DECISIVO zera classificadoPalpite no update', async () => {
    h.upsert.mockResolvedValue({});
    await registrarPalpiteJogo('p1', 'j1', 2, 1);
    const arg = h.upsert.mock.calls[0][0] as UpsertArg;
    expect(arg.update).toMatchObject({ golsCasa: 2, golsVisitante: 1, classificadoPalpite: null });
  });

  it('EMPATE NÃO mexe em classificadoPalpite (deixa o fluxo de empate cuidar)', async () => {
    h.upsert.mockResolvedValue({});
    await registrarPalpiteJogo('p1', 'j1', 1, 1);
    const arg = h.upsert.mock.calls[0][0] as UpsertArg;
    expect(arg.update).toMatchObject({ golsCasa: 1, golsVisitante: 1 });
    expect('classificadoPalpite' in arg.update).toBe(false);
  });
});
