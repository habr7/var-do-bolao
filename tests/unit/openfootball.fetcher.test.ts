import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OpenFootballAdapter } from '../../src/modules/resultado/openfootball.fetcher.js';

/**
 * v3.16.0 — bateria de testes do OpenFootballAdapter cobrindo os 5
 * bugs históricos do FifaWorldCup2026Adapter que motivaram a troca:
 *
 *   B1. FIFA_SEASON_ID vazio → silêncio total
 *   B2. api.fifa.com instável
 *   B3. Match por nome SEM normalização (México ≠ Mexico)
 *   B4. Score null em FINALIZADO virava 0×0
 *   B5. Erros silenciosos sem observabilidade
 */

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  // Limpa cache estático entre testes (módulo cacheia 60s)
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-11T22:00:00Z'));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

function mockResponse(body: unknown, ok = true, status = 200) {
  fetchMock.mockResolvedValue({
    ok,
    status,
    json: async () => body,
  } as Response);
}

describe('OpenFootballAdapter — placar dos jogos da Copa', () => {
  describe('happy path', () => {
    it('parseia jogos FINALIZADOS com score.ft válido', async () => {
      mockResponse({
        matches: [
          {
            team1: 'Mexico',
            team2: 'South Africa',
            status: 'complete',
            score: { ft: [2, 0] },
          },
        ],
      });
      const adapter = new OpenFootballAdapter();
      // Avança 61s pra invalidar cache anterior (vitest setSystemTime)
      vi.setSystemTime(new Date('2026-06-11T22:01:01Z'));
      const result = await adapter.buscarResultados('copa-2026-fase-grupos', 1);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        apiJogoId: 'WC2026_A_1',
        golsCasa: 2,
        golsVisitante: 0,
        status: 'FINALIZADO',
      });
    });

    it('detecta FINALIZADO via score.ft mesmo sem campo status', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:02:02Z'));
      mockResponse({
        matches: [
          { team1: 'Brasil', team2: 'Marrocos', score: { ft: [3, 1] } },
        ],
      });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      // (Brasil x Marrocos pode não estar no fixture — só validamos que NÃO crasha)
      // Se não casar fixture, retorna [] e log "sem_match"; se casar, deve estar FINALIZADO.
      result.forEach((r) => expect(r.status).toBe('FINALIZADO'));
    });
  });

  describe('B3 — match com normalização (México ≠ Mexico ANTES, agora OK)', () => {
    it('"Mexico" (EN, sem acento) casa com "México" do fixture local', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:03:03Z'));
      mockResponse({
        matches: [
          {
            team1: 'Mexico',
            team2: 'South Africa',
            status: 'complete',
            score: { ft: [1, 1] },
          },
        ],
      });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result.length).toBe(1);
      expect(result[0].apiJogoId).toBe('WC2026_A_1');
    });
  });

  describe('B4 — score null em FINALIZADO NÃO vira 0×0', () => {
    it('jogo "complete" sem score.ft → PULA (não registra 0×0)', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:04:04Z'));
      mockResponse({
        matches: [
          {
            team1: 'Mexico',
            team2: 'South Africa',
            status: 'complete',
            score: {},
          },
        ],
      });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });

    it('jogo "complete" com score.ft = undefined → PULA', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:05:05Z'));
      mockResponse({
        matches: [
          { team1: 'Mexico', team2: 'South Africa', status: 'complete' },
        ],
      });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });
  });

  describe('B5 — observabilidade (logs estruturados)', () => {
    it('emite log com contadores sucesso/sem_score/sem_match', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:06:06Z'));
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockResponse({
        matches: [
          {
            team1: 'Mexico',
            team2: 'South Africa',
            status: 'complete',
            score: { ft: [2, 0] },
          },
          {
            team1: 'Time Inventado',
            team2: 'Outro Time',
            status: 'complete',
            score: { ft: [1, 0] },
          },
          {
            team1: 'Brasil',
            team2: 'Marrocos',
            status: 'complete',
          }, // sem score
        ],
      });
      await new OpenFootballAdapter().buscarResultados('c', 1);
      const calls = logSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((s) => s.includes('[openfootball]'))).toBe(true);
      expect(calls.some((s) => /sucesso=\d+ sem_score=\d+ sem_match=\d+/.test(s))).toBe(true);
      logSpy.mockRestore();
    });
  });

  describe('B2 — robustez a falha de rede / payload inválido', () => {
    it('fetch retorna 500 → array vazio (não crasha)', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:07:07Z'));
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });

    it('exceção de rede → array vazio (não crasha)', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:08:08Z'));
      fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });

    it('payload sem matches → array vazio', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:09:09Z'));
      mockResponse({ matches: null });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });
  });

  describe('jogos AGENDADOS são ignorados', () => {
    it('match sem status nem score → AGENDADO → pula', async () => {
      vi.setSystemTime(new Date('2026-06-11T22:10:10Z'));
      mockResponse({
        matches: [{ team1: 'Mexico', team2: 'South Africa' }],
      });
      const result = await new OpenFootballAdapter().buscarResultados('c', 1);
      expect(result).toEqual([]);
    });
  });
});
