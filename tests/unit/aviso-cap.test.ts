import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.17.0 — testes do helper de cap diário de avisos.
 *
 * Caso motivador (Camila 11/06): bot mandou 3 mensagens em 3.5h
 * (bom-dia + palpite-call + reminder). Cap absoluto de 2/dia é a
 * defesa de profundidade (complementa o cooldown 24h da v3.13.0).
 */

const redisStore = new Map<string, { value: string; expireAt?: number }>();

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      const e = redisStore.get(key);
      if (!e) return null;
      if (e.expireAt && Date.now() > e.expireAt) {
        redisStore.delete(key);
        return null;
      }
      return e.value;
    }),
    incr: vi.fn(async (key: string) => {
      const cur = parseInt(redisStore.get(key)?.value ?? '0', 10);
      const next = cur + 1;
      const expireAt = redisStore.get(key)?.expireAt;
      redisStore.set(key, { value: String(next), expireAt });
      return next;
    }),
    decr: vi.fn(async (key: string) => {
      const cur = parseInt(redisStore.get(key)?.value ?? '0', 10);
      const next = cur - 1;
      const expireAt = redisStore.get(key)?.expireAt;
      redisStore.set(key, { value: String(next), expireAt });
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const e = redisStore.get(key);
      if (!e) return 0;
      redisStore.set(key, { value: e.value, expireAt: Date.now() + seconds * 1000 });
      return 1;
    }),
  },
}));

vi.mock('../../src/config/env.js', () => ({
  env: { MAX_AVISOS_DIA: 2 },
}));

const { podeEnviarAvisoHoje, registrarAvisoEnviado, reservarCotaAviso, devolverCotaAviso } =
  await import('../../src/utils/aviso-cap.js');

describe('aviso-cap (v3.17.0 — caso Camila 11/06)', () => {
  beforeEach(() => {
    redisStore.clear();
  });

  it('permite envio quando contador está zerado', async () => {
    expect(await podeEnviarAvisoHoje('5511999999999')).toBe(true);
  });

  it('permite até 2 envios, bloqueia o 3º', async () => {
    const wa = '5511999999999';
    expect(await podeEnviarAvisoHoje(wa)).toBe(true);
    await registrarAvisoEnviado(wa);
    expect(await podeEnviarAvisoHoje(wa)).toBe(true);
    await registrarAvisoEnviado(wa);
    expect(await podeEnviarAvisoHoje(wa)).toBe(false);
  });

  it('contador é por usuário (não vaza entre users)', async () => {
    const a = '5511111111111';
    const b = '5522222222222';
    await registrarAvisoEnviado(a);
    await registrarAvisoEnviado(a);
    expect(await podeEnviarAvisoHoje(a)).toBe(false);
    expect(await podeEnviarAvisoHoje(b)).toBe(true);
  });

  it('cenário Camila: 3 jobs no mesmo dia → 3º bloqueado', async () => {
    // 10:00 — bom-dia
    expect(await podeEnviarAvisoHoje('5511444444444')).toBe(true);
    await registrarAvisoEnviado('5511444444444');
    // 13:00 — palpite-call
    expect(await podeEnviarAvisoHoje('5511444444444')).toBe(true);
    await registrarAvisoEnviado('5511444444444');
    // 13:30 — reminders BLOQUEADO
    expect(await podeEnviarAvisoHoje('5511444444444')).toBe(false);
  });

  describe('v3.28.0 — reserva atômica (corrige TOCTOU)', () => {
    it('reservarCotaAviso permite até o cap e bloqueia além', async () => {
      const wa = '5511555555555';
      expect(await reservarCotaAviso(wa)).toBe(true); // 1
      expect(await reservarCotaAviso(wa)).toBe(true); // 2 (cap=2)
      expect(await reservarCotaAviso(wa)).toBe(false); // 3 → bloqueia
    });

    it('quando bloqueia, NÃO deixa o contador acima do cap (devolveu)', async () => {
      const wa = '5511666666666';
      await reservarCotaAviso(wa);
      await reservarCotaAviso(wa);
      await reservarCotaAviso(wa); // bloqueado, faz decr
      // ainda no cap: uma devolução libera exatamente 1 slot
      await devolverCotaAviso(wa);
      expect(await reservarCotaAviso(wa)).toBe(true);
      expect(await reservarCotaAviso(wa)).toBe(false);
    });

    it('devolverCotaAviso (rollback de envio falho) libera a cota', async () => {
      const wa = '5511777777777';
      expect(await reservarCotaAviso(wa)).toBe(true);
      expect(await reservarCotaAviso(wa)).toBe(true);
      expect(await reservarCotaAviso(wa)).toBe(false); // cheio
      await devolverCotaAviso(wa); // simula falha de envio → devolve
      expect(await reservarCotaAviso(wa)).toBe(true); // agora cabe de novo
    });
  });
});
