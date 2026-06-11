import { describe, it, expect } from 'vitest';
import { formatRanking } from '../../src/utils/formatting.js';

/**
 * v3.17.0 — formatRanking sem medalhas quando todos têm 0 pts.
 *
 * Bug motivador (print "Bolao kzados"): bot mostrou 🥇 André, 🥈 Lucas,
 * 🥉 João, todos com 0 pts. Causa confusão social ("por que tem
 * campeão se ninguém marcou?"). Critério de desempate (mais palpites
 * / entrada anterior) está sendo exibido como conquista.
 *
 * Fix: se entries[0].pontuacaoTotal === 0, usa numeração simples
 * (1. 2. 3.) + nota "Empate técnico em 0 pts".
 */
describe('formatRanking — caso ranking zerado', () => {
  it('NÃO usa medalhas quando todos têm 0 pts', () => {
    const out = formatRanking('Bolao kzados', 1, 'Copa 2026', [
      { posicao: 1, nome: 'André Zonaro', pontuacaoTotal: 0 },
      { posicao: 2, nome: 'Lucas T.M.', pontuacaoTotal: 0 },
      { posicao: 3, nome: 'João Arruda', pontuacaoTotal: 0 },
    ]);
    expect(out).not.toContain('🥇');
    expect(out).not.toContain('🥈');
    expect(out).not.toContain('🥉');
    expect(out).toContain('1. André Zonaro');
    expect(out).toContain('2. Lucas T.M.');
    expect(out).toContain('3. João Arruda');
    expect(out).toMatch(/empate t[ée]cnico|ranking come[çc]a/i);
  });

  it('USA medalhas quando o líder tem ≥ 1 pt', () => {
    const out = formatRanking('Bolão de teste', 1, 'Copa 2026', [
      { posicao: 1, nome: 'Maria', pontuacaoTotal: 15 },
      { posicao: 2, nome: 'João', pontuacaoTotal: 10 },
      { posicao: 3, nome: 'Pedro', pontuacaoTotal: 0 },
    ]);
    expect(out).toContain('🥇');
    expect(out).toContain('🥈');
    expect(out).toContain('🥉');
    expect(out).not.toMatch(/empate t[ée]cnico/i);
  });

  it('USA medalhas mesmo se o 2º/3º estão com 0 pts (só o líder importa)', () => {
    const out = formatRanking('Bolão xx', 1, 'Copa', [
      { posicao: 1, nome: 'Único Pontuador', pontuacaoTotal: 7 },
      { posicao: 2, nome: 'Segundo', pontuacaoTotal: 0 },
    ]);
    expect(out).toContain('🥇');
    expect(out).toContain('🥈');
  });

  it('lista vazia não crasha', () => {
    expect(() => formatRanking('Bolão vazio', 1, 'Copa', [])).not.toThrow();
  });
});
