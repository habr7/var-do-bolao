import { describe, it, expect } from 'vitest';
import { paginarBlocos } from '../../src/utils/paginar.js';

describe('paginarBlocos (v3.28.0)', () => {
  it('cabe tudo numa página quando abaixo do limite', () => {
    const partes = ['linha 1', 'linha 2', 'linha 3'];
    expect(paginarBlocos(partes, 100)).toEqual(['linha 1\nlinha 2\nlinha 3']);
  });

  it('quebra em páginas sem nunca passar do limite', () => {
    const partes = ['aaaa', 'bbbb', 'cccc', 'dddd']; // 4 chars cada
    const paginas = paginarBlocos(partes, 9); // cabe "aaaa\nbbbb" = 9
    for (const p of paginas) expect(p.length).toBeLessThanOrEqual(9);
    // reconstrói o conteúdo na ordem
    expect(paginas.join('\n')).toBe(partes.join('\n'));
  });

  it('nunca quebra um bloco no meio (bloco maior que o limite vai sozinho)', () => {
    const grande = 'x'.repeat(50);
    const paginas = paginarBlocos(['ok', grande, 'fim'], 20);
    expect(paginas).toContain(grande);
    expect(paginas[0]).toBe('ok');
  });

  it('lista vazia → nenhuma página', () => {
    expect(paginarBlocos([], 100)).toEqual([]);
  });

  it('simula "meus palpites" de rodada cheia: várias páginas, todas <=3500', () => {
    const partes = Array.from({ length: 72 }, (_, i) => `• Time${i} 2×1 Outro${i}\n   ↳ oficial: 2×1 🎯 (10 pts)`);
    const paginas = paginarBlocos(partes, 3500);
    expect(paginas.length).toBeGreaterThan(1);
    for (const p of paginas) expect(p.length).toBeLessThanOrEqual(3500);
  });
});
