import { describe, it, expect } from 'vitest';
import { extrairNomeBolaoInlineSair } from '../../src/whatsapp/sair.helper.js';

describe('extrairNomeBolaoInlineSair (v3.30.0 — caso Mauricio 11/06)', () => {
  it('"sair do bolão da firma" → "firma"', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolão da firma')).toBe('firma');
  });
  it('"sair do bolao Enter" → "Enter"', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolao Enter')).toBe('Enter');
  });
  it('"quero sair do bolão kzados" → "kzados"', () => {
    expect(extrairNomeBolaoInlineSair('quero sair do bolão kzados')).toBe('kzados');
  });

  // sem nome → cai no fluxo de pergunta
  it('"sair do bolao" → null', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolao')).toBeNull();
  });
  it('"sair do bolão" (com acento) → null', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolão')).toBeNull();
  });
  it('"sair do bolao 2" (número puro, ambíguo) → null', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolao 2')).toBeNull();
  });
  it('"quero sair" (sem a palavra bolão) → null', () => {
    expect(extrairNomeBolaoInlineSair('quero sair')).toBeNull();
  });
  it('resto só com artigo ("sair do bolão do") → null', () => {
    expect(extrairNomeBolaoInlineSair('sair do bolão do')).toBeNull();
  });
});
