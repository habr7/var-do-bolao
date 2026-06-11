import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FifaWorldCup2026Adapter,
  __resetFifaCachesParaTeste,
} from '../../src/modules/resultado/fifa.fetcher.js';

/**
 * Bateria do FifaWorldCup2026Adapter (reescrito na v3.22.0). Cobre os 3
 * bugs históricos que impediam o fetcher de funcionar, todos confirmados
 * batendo na api.fifa.com de verdade no dia da abertura:
 *
 *   B2. Campos errados (HomeTeam.Score → Home.Score / HomeTeamScore)
 *   B3. Status invertido (0=FINALIZADO, 1=AGENDADO, 3=AO_VIVO)
 *   B4. Match por nome → match por PAR de código FIFA (Home/Away IdCountry)
 *
 * + null-guard de placar e throw em falha de rede (sinal pro Hybrid).
 */

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

function mockCalendar(results: unknown[], ok = true, status = 200) {
  fetchMock.mockResolvedValue({
    ok,
    status,
    json: async () => ({ Results: results }),
  } as Response);
}

/** Monta um match no formato real da api.fifa.com v3. */
function fifaMatch(opts: {
  homeCode: string;
  awayCode: string;
  homeScore?: number | null;
  awayScore?: number | null;
  matchStatus: number;
}) {
  return {
    IdMatch: '400021443',
    MatchStatus: opts.matchStatus,
    Home: { Score: opts.homeScore ?? null, IdCountry: opts.homeCode },
    Away: { Score: opts.awayScore ?? null, IdCountry: opts.awayCode },
    HomeTeamScore: opts.homeScore ?? null,
    AwayTeamScore: opts.awayScore ?? null,
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  __resetFifaCachesParaTeste();
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = realFetch;
  __resetFifaCachesParaTeste();
  vi.restoreAllMocks();
});

describe('FifaWorldCup2026Adapter', () => {
  describe('B3 — status codes (confirmados empiricamente)', () => {
    it('MatchStatus=0 → FINALIZADO', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: 2, awayScore: 0, matchStatus: 0 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r).toEqual([{ apiJogoId: 'WC2026_A_1', golsCasa: 2, golsVisitante: 0, status: 'FINALIZADO' }]);
    });

    it('MatchStatus=3 → AO_VIVO (placar parcial)', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: 1, awayScore: 0, matchStatus: 3 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r).toEqual([{ apiJogoId: 'WC2026_A_1', golsCasa: 1, golsVisitante: 0, status: 'AO_VIVO' }]);
    });

    it('MatchStatus=1 (AGENDADO) → ignorado', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', matchStatus: 1 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r).toEqual([]);
    });

    it('MatchStatus=4 → ADIADO, =5 → CANCELADO', async () => {
      mockCalendar([
        fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: 0, awayScore: 0, matchStatus: 4 }),
      ]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r[0]?.status).toBe('ADIADO');
    });
  });

  describe('B2 — lê o campo de placar certo', () => {
    it('usa Home.Score / Away.Score', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: 3, awayScore: 1, matchStatus: 0 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r[0]).toMatchObject({ golsCasa: 3, golsVisitante: 1 });
    });

    it('cai pro HomeTeamScore/AwayTeamScore se Home.Score vier ausente', async () => {
      mockCalendar([
        {
          MatchStatus: 0,
          Home: { IdCountry: 'MEX' },
          Away: { IdCountry: 'RSA' },
          HomeTeamScore: 2,
          AwayTeamScore: 2,
        },
      ]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r[0]).toMatchObject({ golsCasa: 2, golsVisitante: 2, status: 'FINALIZADO' });
    });
  });

  describe('B4 — match por par de código FIFA', () => {
    it('MEX × RSA casa com WC2026_A_1 (México × África do Sul)', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: 1, awayScore: 1, matchStatus: 0 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r[0]?.apiJogoId).toBe('WC2026_A_1');
    });

    it('código ausente (mata-mata a definir) → não casa, é pulado', async () => {
      mockCalendar([
        { MatchStatus: 1, Home: { IdCountry: null }, Away: { IdCountry: null } },
      ]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r).toEqual([]);
    });
  });

  describe('null-guard de placar', () => {
    it('status mapeável mas placar null → pula (não vira 0×0)', async () => {
      mockCalendar([fifaMatch({ homeCode: 'MEX', awayCode: 'RSA', homeScore: null, awayScore: null, matchStatus: 3 })]);
      const r = await new FifaWorldCup2026Adapter().buscarResultados('c', 1);
      expect(r).toEqual([]);
    });
  });

  describe('robustez de rede', () => {
    it('HTTP 500 → LANÇA (Hybrid trata o fallback)', async () => {
      mockCalendar([], false, 500);
      await expect(new FifaWorldCup2026Adapter().buscarResultados('c', 1)).rejects.toThrow();
    });

    it('exceção de rede → LANÇA', async () => {
      fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
      await expect(new FifaWorldCup2026Adapter().buscarResultados('c', 1)).rejects.toThrow();
    });
  });
});
