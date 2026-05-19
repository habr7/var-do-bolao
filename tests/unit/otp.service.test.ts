import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  env: {
    OTP_VALIDITY_MINUTES: 10,
    OTP_MAX_ATTEMPTS: 5,
    DRY_RUN_WHATSAPP: true,
  },
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {},
}));

const { normalizarTelefoneBR } = await import(
  '../../src/web-api/otp.service.js'
);

describe('normalizarTelefoneBR', () => {
  it('11 digitos vira 13 digitos com 55', () => {
    expect(normalizarTelefoneBR('11999999999')).toBe('5511999999999');
  });

  it('13 digitos com 55 permanece', () => {
    expect(normalizarTelefoneBR('5511999999999')).toBe('5511999999999');
  });

  it('aceita format mascarado', () => {
    expect(normalizarTelefoneBR('+55 (11) 99999-9999')).toBe('5511999999999');
    expect(normalizarTelefoneBR('11 9 9999 9999')).toBe('5511999999999');
  });

  it('10 digitos (fixo BR) tambem normaliza com 55', () => {
    expect(normalizarTelefoneBR('1144441234')).toBe('551144441234');
  });

  it('numero invalido retorna null', () => {
    expect(normalizarTelefoneBR('123')).toBeNull();
    expect(normalizarTelefoneBR('99 99')).toBeNull();
    expect(normalizarTelefoneBR('99999999999999999')).toBeNull();
  });

  it('numero estrangeiro 12 digitos sem 55 cai em null', () => {
    // 12 digitos sem prefixo 55 nao normaliza
    expect(normalizarTelefoneBR('449999999999')).toBeNull();
  });
});

// gerarEEnviarOtp/verificarOtp dependem do prisma — testes de integracao
// rodariam contra um DB de teste. Aqui so testamos a parte pura.
// Adicionar suite de integracao em tests/integration/ quando rolar.
describe('OTP — placeholder pra suite de integracao', () => {
  beforeEach(() => vi.useRealTimers());
  it('TODO: gerar OTP cria registro e dispara sendText', () => {
    expect(true).toBe(true);
  });
  it('TODO: verificarOtp incrementa tentativas em codigo errado', () => {
    expect(true).toBe(true);
  });
  it('TODO: verificarOtp bloqueia >= OTP_MAX_ATTEMPTS', () => {
    expect(true).toBe(true);
  });
});
