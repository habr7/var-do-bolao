import { describe, it, expect } from 'vitest';

/**
 * v3.56.0 — BUG CRÍTICO (incidente 01/07): os ENABLE_* usavam
 * z.coerce.boolean(), que faz Boolean("false") === true. Resultado:
 * ENABLE_LEMBRETE_30MIN=false no .env virava TRUE e o lembrete disparava
 * (mesmo problema pra bom-dia/ranking/reveal → risco de ban).
 *
 * Este teste trava a regra: "false"/"0"/"" → false; "true"/"1" → true.
 * Reimporta o env com process.env controlado.
 */
async function loadEnv(overrides: Record<string, string>) {
  const OLD = { ...process.env };
  // mínimos p/ o schema validar
  process.env.DATABASE_URL = 'postgresql://x:y@localhost:5432/z';
  process.env.NODE_ENV = 'test';
  Object.assign(process.env, overrides);
  vi.resetModules?.();
  const mod = await import('../../src/config/env.js?bool=' + Math.random().toString(36).slice(2));
  process.env = OLD;
  return mod.env as Record<string, unknown>;
}
import { vi } from 'vitest';

describe('coerção de boolean nos ENABLE_* (regressão do incidente 01/07)', () => {
  it('"false" → false (o bug: antes virava true)', async () => {
    const env = await loadEnv({ ENABLE_LEMBRETE_30MIN: 'false', ENABLE_BOM_DIA: 'false' });
    expect(env.ENABLE_LEMBRETE_30MIN).toBe(false);
    expect(env.ENABLE_BOM_DIA).toBe(false);
  });
  it('"true"/"1" → true', async () => {
    const env = await loadEnv({ ENABLE_BOM_DIA: 'true', ENABLE_RANKING: '1' });
    expect(env.ENABLE_BOM_DIA).toBe(true);
    expect(env.ENABLE_RANKING).toBe(true);
  });
  it('"0"/"" → false; ausente usa default', async () => {
    const env = await loadEnv({ ENABLE_RANKING: '0', ENABLE_PALPITE_REVEAL: '' });
    expect(env.ENABLE_RANKING).toBe(false);
    expect(env.ENABLE_PALPITE_REVEAL).toBe(false);
    expect(env.ENABLE_LEMBRETE_30MIN).toBe(false); // default
  });
});
