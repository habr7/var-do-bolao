import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// env deve ser mockado antes de importar signature
vi.mock('../../src/config/env.js', () => ({
  env: {
    WHATSAPP_APP_SECRET: 'supersecret',
  },
}));

import { validateMetaSignature } from '../../src/whatsapp/signature.js';

const APP_SECRET = 'supersecret';

function sign(body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
}

describe('validateMetaSignature', () => {
  it('valida assinatura correta', () => {
    const body = '{"foo":"bar"}';
    expect(validateMetaSignature(body, sign(body))).toBe(true);
  });

  it('rejeita assinatura errada', () => {
    const body = '{"foo":"bar"}';
    expect(validateMetaSignature(body, 'sha256=abc123')).toBe(false);
  });

  it('rejeita header ausente', () => {
    expect(validateMetaSignature('{}', undefined)).toBe(false);
  });

  it('rejeita header sem prefixo sha256=', () => {
    const body = '{"x":1}';
    const sig = crypto.createHmac('sha256', APP_SECRET).update(body).digest('hex');
    expect(validateMetaSignature(body, sig)).toBe(false);
  });

  it('rejeita body alterado', () => {
    const original = '{"x":1}';
    const sig = sign(original);
    const tampered = '{"x":2}';
    expect(validateMetaSignature(tampered, sig)).toBe(false);
  });
});
