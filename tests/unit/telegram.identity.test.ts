import { describe, it, expect, vi } from 'vitest';

// telegram.identity importa prisma/redis/channel-router — mocka as bordas
// (aqui só testamos as funções PURAS de normalização de número).
vi.mock('../../src/config/database.js', () => ({ prisma: {} }));
vi.mock('../../src/config/redis.js', () => ({ redis: {} }));
vi.mock('../../src/messaging/channel-router.js', () => ({ invalidarCacheCanal: vi.fn() }));

import {
  normalizarNumeroBR,
  variantesNumeroBR,
} from '../../src/messaging/telegram.identity.js';

describe('normalizarNumeroBR', () => {
  it('formatos comuns viram canônico 55+DDD+numero', () => {
    expect(normalizarNumeroBR('(11) 97613-5412')).toBe('5511976135412');
    expect(normalizarNumeroBR('11 97613 5412')).toBe('5511976135412');
    expect(normalizarNumeroBR('11976135412')).toBe('5511976135412');
    expect(normalizarNumeroBR('+55 11 97613-5412')).toBe('5511976135412');
    expect(normalizarNumeroBR('5511976135412')).toBe('5511976135412');
  });

  it('fixo/celular sem 9º dígito (DDD + 8) também passa', () => {
    expect(normalizarNumeroBR('11 7613-5412')).toBe('551176135412');
    expect(normalizarNumeroBR('551176135412')).toBe('551176135412');
  });

  it('lixo é rejeitado', () => {
    expect(normalizarNumeroBR('oi tudo bem')).toBeNull();
    expect(normalizarNumeroBR('123')).toBeNull();
    expect(normalizarNumeroBR('12345678901234567')).toBeNull();
    expect(normalizarNumeroBR('')).toBeNull();
  });
});

describe('variantesNumeroBR', () => {
  it('celular com 9º dígito gera variante sem o 9 (e sufixos JID)', () => {
    const v = variantesNumeroBR('5511976135412');
    expect(v).toContain('5511976135412');
    expect(v).toContain('5511976135412@s.whatsapp.net');
    expect(v).toContain('551176135412'); // sem o 9º dígito
    expect(v).toContain('551176135412@s.whatsapp.net');
  });

  it('número sem 9º dígito gera variante com o 9', () => {
    const v = variantesNumeroBR('551176135412');
    expect(v).toContain('5511976135412');
    expect(v).toContain('5511976135412@s.whatsapp.net');
  });

  it('não duplica variantes', () => {
    const v = variantesNumeroBR('5511976135412');
    expect(new Set(v).size).toBe(v.length);
  });
});
