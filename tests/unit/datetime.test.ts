import { describe, it, expect } from 'vitest';
import {
  formatarDataHoraCurtaBR,
  formatarDataHoraComDiaBR,
  formatarDataBR,
  formatarHoraBR,
  horaLocalSedeParaUtc,
} from '../../src/utils/datetime.js';

/**
 * v3.11.0 — bug Jeni 11/06: bot listou "13/06, 22:00 — Brasil x Marrocos"
 * em VPS UTC, mas o jogo é às 19h Brasília (offset -03:00). Esses testes
 * travam regressão: SEMPRE formatar em America/Sao_Paulo, mesmo se o
 * servidor estiver em UTC ou outro fuso.
 *
 * Estratégia: passar um Date que internamente é 22:00 UTC (= 19:00 BRT)
 * e exigir que o output mostre 19:00. Isso prova que estamos forçando
 * o timezone — não dependendo do TZ do processo.
 */

describe('datetime helpers (sempre Brasília)', () => {
  describe('Bug Jeni 11/06 — 22:00 UTC = 19:00 Brasília', () => {
    // Brasil x Marrocos: 2026-06-13T19:00:00-03:00 = 2026-06-13T22:00:00Z
    const brasilXMarrocos = new Date('2026-06-13T22:00:00.000Z');

    it('formatarDataHoraCurtaBR mostra 19:00 (não 22:00)', () => {
      const out = formatarDataHoraCurtaBR(brasilXMarrocos);
      expect(out).toContain('19:00');
      expect(out).not.toContain('22:00');
      expect(out).toContain('13/06');
    });

    it('formatarDataHoraComDiaBR mostra 19:00 (não 22:00)', () => {
      const out = formatarDataHoraComDiaBR(brasilXMarrocos);
      expect(out).toContain('19:00');
      expect(out).not.toContain('22:00');
      expect(out).toContain('13/06');
    });

    it('formatarHoraBR isolado mostra 19:00', () => {
      expect(formatarHoraBR(brasilXMarrocos)).toBe('19:00');
    });

    it('formatarDataBR mostra 13/06', () => {
      expect(formatarDataBR(brasilXMarrocos)).toBe('13/06');
    });
  });

  describe('jogos que cruzam meia-noite UTC', () => {
    // 02:00 UTC = 23:00 BRT do dia anterior
    const tardeDeBrasilia = new Date('2026-06-12T02:00:00.000Z');

    it('mantém o dia certo de Brasília', () => {
      const out = formatarDataHoraCurtaBR(tardeDeBrasilia);
      expect(out).toContain('11/06');
      expect(out).toContain('23:00');
    });
  });

  describe('horário comercial (sanity)', () => {
    // 15:00 BRT = 18:00 UTC
    const meioDiaBR = new Date('2026-06-11T18:00:00.000Z');

    it('15:00 BRT = 15:00 no display', () => {
      expect(formatarHoraBR(meioDiaBR)).toBe('15:00');
    });
  });

  describe('horaLocalSedeParaUtc (sede local → UTC, tz-aware/DST)', () => {
    it('16:00 em Los Angeles (PDT, verão) → 23:00 UTC', () => {
      const d = horaLocalSedeParaUtc('2026-06-28', '16:00', 'America/Los_Angeles');
      expect(d.toISOString()).toBe('2026-06-28T23:00:00.000Z');
      // e exibido em Brasília (UTC-3) = 20:00
      expect(formatarHoraBR(d)).toBe('20:00');
    });

    it('16:00 em New York (EDT, verão) → 20:00 UTC', () => {
      const d = horaLocalSedeParaUtc('2026-06-28', '16:00', 'America/New_York');
      expect(d.toISOString()).toBe('2026-06-28T20:00:00.000Z');
    });

    it('21:00 em Mexico City (CST, sem DST em 2026) → 03:00 UTC do dia seguinte', () => {
      const d = horaLocalSedeParaUtc('2026-06-28', '21:00', 'America/Mexico_City');
      // Cidade do México = UTC-6 (não observa mais DST desde 2022)
      expect(d.toISOString()).toBe('2026-06-29T03:00:00.000Z');
    });

    it('rejeita data/hora malformada', () => {
      expect(() => horaLocalSedeParaUtc('28/06/2026', '16:00', 'America/New_York')).toThrow();
      expect(() => horaLocalSedeParaUtc('2026-06-28', '16h', 'America/New_York')).toThrow();
    });
  });
});
