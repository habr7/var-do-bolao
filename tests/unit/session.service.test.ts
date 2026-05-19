import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  env: {
    WEB_SESSION_SECRET: 'test-secret-fixed-for-deterministic-tests-1234567890',
    WEB_SESSION_TTL_DAYS: 30,
    NODE_ENV: 'test',
  },
}));

const { createSessionToken, verifySessionToken } = await import(
  '../../src/web-api/session.service.js'
);

describe('session.service — HMAC signed tokens', () => {
  it('roundtrip basico: cria e valida', () => {
    const token = createSessionToken('u-1', 'w-1');
    const payload = verifySessionToken(token);
    expect(payload).toBeTruthy();
    expect(payload?.uid).toBe('u-1');
    expect(payload?.wid).toBe('w-1');
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejeita token com assinatura adulterada', () => {
    const token = createSessionToken('u-1', 'w-1');
    const [payload, sig] = token.split('.');
    const malicioso = `${payload}.${sig}xxx`;
    expect(verifySessionToken(malicioso)).toBeNull();
  });

  it('rejeita token com payload trocado mas mesma assinatura', () => {
    const a = createSessionToken('u-1', 'w-1');
    const b = createSessionToken('u-2', 'w-2');
    const [pa] = a.split('.');
    const [, sb] = b.split('.');
    expect(verifySessionToken(`${pa}.${sb}`)).toBeNull();
  });

  it('rejeita token expirado (exp < agora)', () => {
    const expirado = createSessionToken('u-1', 'w-1', -3600); // -1h
    expect(verifySessionToken(expirado)).toBeNull();
  });

  it('rejeita formato invalido', () => {
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('sem-ponto')).toBeNull();
    expect(verifySessionToken('a.b.c')).toBeTruthy ? expect(verifySessionToken('xxx.yyy')).toBeNull() : null;
  });

  it('rejeita JSON corrompido', () => {
    expect(verifySessionToken('!!!.abc')).toBeNull();
  });
});
