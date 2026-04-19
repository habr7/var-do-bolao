import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword, isValidPassword } from '../../src/utils/password.js';

describe('isValidPassword', () => {
  it('rejeita senhas muito curtas', () => {
    expect(isValidPassword('abc')).toBe(false);
    expect(isValidPassword('12345')).toBe(false);
  });
  it('aceita senha com 6 chars', () => {
    expect(isValidPassword('123456')).toBe(true);
  });
  it('rejeita senha com mais de 100 chars', () => {
    expect(isValidPassword('a'.repeat(101))).toBe(false);
  });
  it('aceita senhas comuns', () => {
    expect(isValidPassword('cerveja123')).toBe(true);
    expect(isValidPassword('minh@senh@')).toBe(true);
  });
});

describe('hashPassword + comparePassword', () => {
  it('hash e diferente da senha em texto', async () => {
    const hash = await hashPassword('senha123');
    expect(hash).not.toBe('senha123');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('compara com sucesso a senha correta', async () => {
    const hash = await hashPassword('senha123');
    expect(await comparePassword('senha123', hash)).toBe(true);
  });

  it('rejeita senha errada', async () => {
    const hash = await hashPassword('senha123');
    expect(await comparePassword('errada', hash)).toBe(false);
  });

  it('hashes de mesma senha sao diferentes (salt)', async () => {
    const h1 = await hashPassword('igual');
    const h2 = await hashPassword('igual');
    expect(h1).not.toBe(h2);
    // mas ambos devem validar a mesma senha
    expect(await comparePassword('igual', h1)).toBe(true);
    expect(await comparePassword('igual', h2)).toBe(true);
  });
});
