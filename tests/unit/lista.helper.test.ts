import { describe, it, expect } from 'vitest';
import { formatarBoloesNumerados, parseEscolhaBolao } from '../../src/whatsapp/lista.helper.js';

const BOLOES = [
  { id: 'a', nome: 'Bolão da Jeni', codigo: 'AAAA11' },
  { id: 'b', nome: 'Bolão do João', codigo: 'BBBB22' },
  { id: 'c', nome: 'Bolão da Firma 2026' },
];

describe('formatarBoloesNumerados', () => {
  it('renderiza com indice 1-based + codigo', () => {
    const out = formatarBoloesNumerados(BOLOES);
    expect(out).toContain('1. *Bolão da Jeni*');
    expect(out).toContain('(`#AAAA11`)');
    expect(out).toContain('3. *Bolão da Firma 2026*');
  });

  it('sem boloes', () => {
    expect(formatarBoloesNumerados([])).toContain('nenhum bolao');
  });
});

describe('parseEscolhaBolao', () => {
  it('por indice numerico simples', () => {
    expect(parseEscolhaBolao('1', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('2', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('3', BOLOES)?.id).toBe('c');
  });

  it('indice com espaco/pontuacao', () => {
    expect(parseEscolhaBolao('  2  ', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('1.', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('1 quero esse', BOLOES)?.id).toBe('a');
  });

  it('indice fora do range cai pra outra estrategia', () => {
    // "10" não bate indice e nem nome nem codigo
    expect(parseEscolhaBolao('10', BOLOES)).toBeNull();
  });

  it('por codigo curto', () => {
    expect(parseEscolhaBolao('#AAAA11', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('AAAA11', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('#bbbb22', BOLOES)?.id).toBe('b');
  });

  it('por nome (match exato case+acento-insensitivo)', () => {
    expect(parseEscolhaBolao('Bolao da Jeni', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('BOLÃO DO JOÃO', BOLOES)?.id).toBe('b');
  });

  it('por nome (fuzzy substring)', () => {
    expect(parseEscolhaBolao('jeni', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('joao', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('firma', BOLOES)?.id).toBe('c');
  });

  it('texto que nao bate nada → null', () => {
    expect(parseEscolhaBolao('coisa diferente', BOLOES)).toBeNull();
  });

  it('lista vazia → null', () => {
    expect(parseEscolhaBolao('1', [])).toBeNull();
  });

  it('texto vazio → null', () => {
    expect(parseEscolhaBolao('   ', BOLOES)).toBeNull();
  });
});
