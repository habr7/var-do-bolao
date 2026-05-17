import { describe, it, expect } from 'vitest';
import {
  isValidScore,
  isGroupJid,
  isUserJid,
  extractPhoneFromJid,
  normalizeTeamName,
  parseScore,
  validarPlacar,
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

  // Bug real: usuario manda "na África" e bot precisa bater
  // "África do Sul" — preposicao prefixada quebrava o includes().
  describe('strip de preposicoes prefixadas', () => {
    it('"na África" → "africa"', () => {
      expect(normalizeTeamName('na África')).toBe('africa');
    });
    it('"do Brasil" → "brasil"', () => {
      expect(normalizeTeamName('do Brasil')).toBe('brasil');
    });
    it('"pra Espanha" → "espanha"', () => {
      expect(normalizeTeamName('pra Espanha')).toBe('espanha');
    });
    it('"contra Argentina" → "argentina"', () => {
      expect(normalizeTeamName('contra Argentina')).toBe('argentina');
    });
    it('strip iterativo "pra na Africa" → "africa"', () => {
      expect(normalizeTeamName('pra na Africa')).toBe('africa');
    });
    it('NAO strip palavra que sobreviveria como time isolado', () => {
      // "Estados" não está nas stopwords (é palavra valida)
      expect(normalizeTeamName('Estados Unidos')).toBe('estados unidos');
    });
    it('verifica matching pos-strip', () => {
      const naAfrica = normalizeTeamName('na África');
      const africaDoSul = normalizeTeamName('África do Sul');
      // "africa" deve estar contido em "africa do sul" — caso de uso real
      expect(africaDoSul.includes(naAfrica)).toBe(true);
    });
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

describe('validarPlacar (ISSUE-013)', () => {
  it('aceita placar comum', () => {
    expect(validarPlacar(2, 1).ok).toBe(true);
    expect(validarPlacar(0, 0).ok).toBe(true);
    expect(validarPlacar(5, 4).ok).toBe(true);
  });

  it('rejeita gols negativos como invalido', () => {
    const r = validarPlacar(-1, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('invalido');
      expect(r.sugerirConfirmacao).toBe(false);
    }
  });

  it('marca placar com >15 gols como absurdo', () => {
    const r = validarPlacar(18, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('absurdo');
      expect(r.sugerirConfirmacao).toBe(true);
    }
  });

  it('marca placar com 16x0 como absurdo (limite)', () => {
    const r = validarPlacar(16, 0);
    expect(r.ok).toBe(false);
  });

  it('aceita 15x0 (limite OK)', () => {
    expect(validarPlacar(15, 0).ok).toBe(true);
  });

  it('marca total >20 como absurdo (mesmo se cada lado <=15)', () => {
    const r = validarPlacar(12, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('absurdo');
  });

  it('aceita total exato 20', () => {
    expect(validarPlacar(10, 10).ok).toBe(true);
  });
});
