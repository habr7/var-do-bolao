import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridFootballAdapter } from '../../src/modules/resultado/hybrid.fetcher.js';
import { __resetFifaCachesParaTeste } from '../../src/modules/resultado/fifa.fetcher.js';

/**
 * HybridFootballAdapter (v3.22.0): FIFA primário, openfootball como
 * fallback automático. Garante o requisito "funciona se a FIFA estiver
 * fora" — quando a FIFA falha, os placares ainda chegam pelo openfootball.
 *
 * Roteamento do mock de fetch por URL:
 *   - api.fifa.com           → resposta da FIFA (Results)
 *   - raw.githubusercontent  → resposta do openfootball (matches)
 */

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  __resetFifaCachesParaTeste();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  __resetFifaCachesParaTeste();
  vi.restoreAllMocks();
});

const fifaOk = {
  ok: true,
  status: 200,
  json: async () => ({
    Results: [
      {
        MatchStatus: 3, // AO_VIVO
        Home: { Score: 1, IdCountry: 'MEX' },
        Away: { Score: 0, IdCountry: 'RSA' },
        HomeTeamScore: 1,
        AwayTeamScore: 0,
      },
    ],
  }),
} as Response;

const openfootballOk = {
  ok: true,
  status: 200,
  json: async () => ({
    matches: [
      { team1: 'Mexico', team2: 'South Africa', status: 'complete', score: { ft: [2, 0] } },
    ],
  }),
} as Response;

describe('HybridFootballAdapter', () => {
  it('FIFA OK → usa a FIFA (placar AO VIVO), nem chama o openfootball', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('api.fifa.com')) return Promise.resolve(fifaOk);
      return Promise.reject(new Error('openfootball NÃO deveria ser chamado'));
    });

    const r = await new HybridFootballAdapter().buscarResultados('c', 1);
    expect(r).toEqual([{ apiJogoId: 'WC2026_A_1', golsCasa: 1, golsVisitante: 0, status: 'AO_VIVO' }]);
    // só a FIFA foi consultada
    expect(fetchMock.mock.calls.every((c) => String(c[0]).includes('api.fifa.com'))).toBe(true);
  });

  it('FIFA fora (HTTP 500) → cai pro openfootball', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('api.fifa.com')) {
        return Promise.resolve({ ok: false, status: 500 } as Response);
      }
      return Promise.resolve(openfootballOk);
    });

    const r = await new HybridFootballAdapter().buscarResultados('c', 1);
    expect(r).toEqual([{ apiJogoId: 'WC2026_A_1', golsCasa: 2, golsVisitante: 0, status: 'FINALIZADO' }]);
    // confirmou que tentou a FIFA E o openfootball
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('api.fifa.com'))).toBe(true);
    expect(urls.some((u) => u.includes('githubusercontent'))).toBe(true);
  });

  it('FIFA com exceção de rede → cai pro openfootball', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('api.fifa.com')) return Promise.reject(new Error('ENOTFOUND'));
      return Promise.resolve(openfootballOk);
    });

    const r = await new HybridFootballAdapter().buscarResultados('c', 1);
    expect(r[0]).toMatchObject({ apiJogoId: 'WC2026_A_1', status: 'FINALIZADO' });
  });
});
