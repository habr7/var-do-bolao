import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.28.0 — comLockJob: lock distribuído via SET NX pra evitar execução
 * sobreposta de jobs.
 */

const store = new Map<string, string>();

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx?: string) => {
      if (nx === 'NX' && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  },
}));

const { comLockJob } = await import('../../src/utils/lock.js');

beforeEach(() => store.clear());

describe('comLockJob', () => {
  it('executa fn e libera o lock no fim', async () => {
    const fn = vi.fn(async () => {});
    const ok = await comLockJob('teste', fn);
    expect(ok).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    // lock liberado → roda de novo
    expect(await comLockJob('teste', fn)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('NÃO executa fn quando o lock já está tomado', async () => {
    // segura o lock manualmente
    store.set('lock:job:ocupado', '123');
    const fn = vi.fn(async () => {});
    const ok = await comLockJob('ocupado', fn);
    expect(ok).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('libera o lock mesmo se fn lançar', async () => {
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    await expect(comLockJob('cai', fn)).rejects.toThrow('boom');
    // lock foi liberado no finally → próxima execução roda
    const fn2 = vi.fn(async () => {});
    expect(await comLockJob('cai', fn2)).toBe(true);
    expect(fn2).toHaveBeenCalledOnce();
  });
});
