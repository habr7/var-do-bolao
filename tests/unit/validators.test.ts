import { describe, it, expect } from 'vitest';
import {
  isValidScore,
  isGroupJid,
  isUserJid,
  extractPhoneFromJid,
  normalizeTeamName,
  parseScore,
} from '../../src/utils/validators.js';

describe('isValidScore', () => {
  it('aceita 0', () => expect(isValidScore(0)).toBe(true));
  it('aceita numeros positivos', () => expect(isValidScore(5)).toBe(true));
  it('rejeita negativos', () => expect(isValidScore(-1)).toBe(false));
  it('rejeita decimais', () => expect(isValidScore(1.5)).toBe(false));
  it('rejeita valores maiores que 99', () => expect(isValidScore(100)).toBe(false));
});

describe('isGroupJid', () => {
  it('identifica JID de grupo', () => {
    expect(isGroupJid('120363123456789@g.us')).toBe(true);
  });
  it('rejeita JID de usuario', () => {
    expect(isGroupJid('5511999999999@s.whatsapp.net')).toBe(false);
  });
});

describe('isUserJid', () => {
  it('identifica JID de usuario', () => {
    expect(isUserJid('5511999999999@s.whatsapp.net')).toBe(true);
  });
  it('rejeita JID de grupo', () => {
    expect(isUserJid('120363123456789@g.us')).toBe(false);
  });
});

describe('extractPhoneFromJid', () => {
  it('extrai telefone de JID', () => {
    expect(extractPhoneFromJid('5511999999999@s.whatsapp.net')).toBe('5511999999999');
  });
});

describe('normalizeTeamName', () => {
  it('normaliza para lowercase sem acentos', () => {
    expect(normalizeTeamName('São Paulo')).toBe('sao paulo');
  });
  it('remove acentos', () => {
    expect(normalizeTeamName('Grêmio')).toBe('gremio');
  });
  it('trim espaços', () => {
    expect(normalizeTeamName('  Flamengo  ')).toBe('flamengo');
  });
});

describe('parseScore', () => {
  it('parseia formato NxN', () => {
    expect(parseScore('2x1')).toEqual({ golsCasa: 2, golsVisitante: 1 });
  });
  it('parseia com espaco', () => {
    expect(parseScore('2 x 1')).toEqual({ golsCasa: 2, golsVisitante: 1 });
  });
  it('parseia com X maiusculo', () => {
    expect(parseScore('0X3')).toEqual({ golsCasa: 0, golsVisitante: 3 });
  });
  it('retorna null para texto invalido', () => {
    expect(parseScore('abc')).toBeNull();
  });
});
