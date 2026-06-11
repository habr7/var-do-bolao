import { describe, it, expect } from 'vitest';
import { calcularPontos } from '../../src/modules/ranking/pontuacao.calc.js';
import { PONTUACAO_PADRAO } from '../../src/modules/ranking/ranking.types.js';

/**
 * v3.14.0 (auditoria pré-Copa) — bateria EXAUSTIVA de cenários de
 * pontuação. Garante que TODOS os 5 tiers (10/7/5/3/0) estão corretos
 * em TODAS as combinações relevantes antes da Copa começar amanhã.
 *
 * Estrutura: `it.each` paramétrico pra fácil leitura.
 *
 * Regras canônicas (regras.text.ts):
 * - 10 pts: placar exato
 * - 7 pts: vencedor correto + gols de UM dos times corretos
 * - 5 pts: só o resultado (vencedor ou empate)
 * - 3 pts: só gols de um time com resultado errado
 * - 0 pts: errou tudo
 * - NÃO acumulam — vale sempre o melhor acerto.
 */

const cfg = PONTUACAO_PADRAO;

interface Cenario {
  nome: string;
  palpite: [number, number];
  jogo: [number, number];
  esperado: number;
}

function calc(c: Cenario): number {
  return calcularPontos(
    { golsCasa: c.palpite[0], golsVisitante: c.palpite[1] },
    { golsCasa: c.jogo[0], golsVisitante: c.jogo[1] },
    cfg,
  );
}

describe('🎯 Tier 10 pts — PLACAR EXATO', () => {
  const casos: Cenario[] = [
    { nome: 'casa vence magra 1x0', palpite: [1, 0], jogo: [1, 0], esperado: 10 },
    { nome: 'visitante vence magra 0x1', palpite: [0, 1], jogo: [0, 1], esperado: 10 },
    { nome: 'casa vence 2x1', palpite: [2, 1], jogo: [2, 1], esperado: 10 },
    { nome: 'visitante vence 1x2', palpite: [1, 2], jogo: [1, 2], esperado: 10 },
    { nome: 'empate 0x0', palpite: [0, 0], jogo: [0, 0], esperado: 10 },
    { nome: 'empate 1x1', palpite: [1, 1], jogo: [1, 1], esperado: 10 },
    { nome: 'empate 2x2', palpite: [2, 2], jogo: [2, 2], esperado: 10 },
    { nome: 'empate 3x3', palpite: [3, 3], jogo: [3, 3], esperado: 10 },
    { nome: 'goleada 5x0', palpite: [5, 0], jogo: [5, 0], esperado: 10 },
    { nome: 'goleada 5x3', palpite: [5, 3], jogo: [5, 3], esperado: 10 },
    { nome: 'goleada absurda 9x0 (raro mas possível)', palpite: [9, 0], jogo: [9, 0], esperado: 10 },
    { nome: 'goleada visitante 0x7', palpite: [0, 7], jogo: [0, 7], esperado: 10 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(10));
});

describe('🥇 Tier 7 pts — vencedor + gols casa corretos', () => {
  const casos: Cenario[] = [
    { nome: '2x0 vs 2x1 (acertou casa+vitória, errou visitante)', palpite: [2, 0], jogo: [2, 1], esperado: 7 },
    { nome: '3x0 vs 3x1', palpite: [3, 0], jogo: [3, 1], esperado: 7 },
    { nome: '4x1 vs 4x2 (margem diferente, casa certo)', palpite: [4, 1], jogo: [4, 2], esperado: 7 },
    { nome: '1x0 vs 1x0 → exato 10 (não 7)', palpite: [1, 0], jogo: [1, 0], esperado: 10 },
    { nome: '5x0 vs 5x2 (goleada com casa certo)', palpite: [5, 0], jogo: [5, 2], esperado: 7 },
    { nome: '2x0 vs 2x0 → exato 10', palpite: [2, 0], jogo: [2, 0], esperado: 10 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(c.esperado));
});

describe('🥇 Tier 7 pts — vencedor + gols visitante corretos', () => {
  const casos: Cenario[] = [
    { nome: '3x1 vs 2x1 (casa vence em ambos, visitante=1 certo)', palpite: [3, 1], jogo: [2, 1], esperado: 7 },
    { nome: '4x2 vs 3x2', palpite: [4, 2], jogo: [3, 2], esperado: 7 },
    { nome: '0x2 vs 1x2 (visitante vence em ambos, visitante=2 certo)', palpite: [0, 2], jogo: [1, 2], esperado: 7 },
    { nome: '0x3 vs 1x3', palpite: [0, 3], jogo: [1, 3], esperado: 7 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(7));
});

describe('✅ Tier 5 pts — só vencedor/empate certo, sem gols certos', () => {
  const casos: Cenario[] = [
    { nome: '2x0 vs 3x1 (casa vence em ambos, mas gols todos errados)', palpite: [2, 0], jogo: [3, 1], esperado: 5 },
    { nome: '3x0 vs 4x1 (vitória casa, gols errados)', palpite: [3, 0], jogo: [4, 1], esperado: 5 },
    { nome: '1x2 vs 0x3 (visitante vence, gols errados)', palpite: [1, 2], jogo: [0, 3], esperado: 5 },
    { nome: 'empate 1x1 vs empate 2x2', palpite: [1, 1], jogo: [2, 2], esperado: 5 },
    { nome: 'empate 0x0 vs empate 3x3', palpite: [0, 0], jogo: [3, 3], esperado: 5 },
    { nome: 'empate 2x2 vs empate 1x1', palpite: [2, 2], jogo: [1, 1], esperado: 5 },
    { nome: 'empate 3x3 vs empate 0x0', palpite: [3, 3], jogo: [0, 0], esperado: 5 },
    { nome: 'vitória ampla certa (5x0 vs 2x1)', palpite: [5, 0], jogo: [2, 1], esperado: 5 },
    { nome: 'visitante goleia (0x5 vs 1x3)', palpite: [0, 5], jogo: [1, 3], esperado: 5 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(5));
});

describe('📊 Tier 3 pts — só gols de um time, resultado errado', () => {
  const casos: Cenario[] = [
    { nome: '2x3 vs 2x1 (casa=2 certo, mas perdedor virou vencedor)', palpite: [2, 3], jogo: [2, 1], esperado: 3 },
    { nome: '0x1 vs 2x1 (visitante=1 certo, mas resultado invertido)', palpite: [0, 1], jogo: [2, 1], esperado: 3 },
    { nome: '2x1 vs 0x1 (visitante=1 certo, casa palpitou vence mas perdeu)', palpite: [2, 1], jogo: [0, 1], esperado: 3 },
    { nome: '3x0 vs 1x1 (casa palpitou ganhou, deu empate, casa=? errou)', palpite: [3, 0], jogo: [1, 1], esperado: 0 },
    { nome: '1x0 vs 0x0 (empate, mas casa=0 errado, visitante=0 acertou)', palpite: [1, 0], jogo: [0, 0], esperado: 3 },
    { nome: '0x1 vs 0x0 (visitante palpitou ganhou, deu empate, casa=0 acertou)', palpite: [0, 1], jogo: [0, 0], esperado: 3 },
    { nome: '0x2 vs 0x3 (visitante vence em ambos, casa=0 certo) → 7, não 3', palpite: [0, 2], jogo: [0, 3], esperado: 7 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(c.esperado));
});

describe('❌ Tier 0 pts — errou tudo', () => {
  const casos: Cenario[] = [
    { nome: 'placar inverso 1x2 vs 2x1', palpite: [1, 2], jogo: [2, 1], esperado: 0 },
    { nome: 'placar inverso 0x3 vs 3x0', palpite: [0, 3], jogo: [3, 0], esperado: 0 },
    { nome: '2x0 vs 0x3 (casa palpitou ganha, perdeu, gols errados)', palpite: [2, 0], jogo: [0, 3], esperado: 0 },
    { nome: 'empate palpite mas casa goleia (1x1 vs 5x0)', palpite: [1, 1], jogo: [5, 0], esperado: 0 },
    { nome: 'empate palpite mas visitante goleia (0x0 vs 0x4 → casa=0 acerta)', palpite: [0, 0], jogo: [0, 4], esperado: 3 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(c.esperado));
});

describe('🧪 Casos da Copa do Mundo (jogos REAIS dos primeiros dias)', () => {
  // Cenários inspirados na rodada inicial 11-14/06/2026.
  // Não é predição — só estresse do sistema com nomes/placares plausíveis.
  const casos: Cenario[] = [
    { nome: 'Mexico 2x0 África Sul (palpitei 2x1)', palpite: [2, 1], jogo: [2, 0], esperado: 7 },
    { nome: 'Brasil 3x1 Marrocos (palpitei exato)', palpite: [3, 1], jogo: [3, 1], esperado: 10 },
    { nome: 'Argentina 2x0 Algeria (palpitei 3x0)', palpite: [3, 0], jogo: [2, 0], esperado: 7 },
    { nome: 'Empate Coreia x Tcheca 1x1 (palpitei 2x1) — visitante=1 acerta', palpite: [2, 1], jogo: [1, 1], esperado: 3 },
    { nome: 'Empate Coreia x Tcheca 0x0 (palpitei empate 1x1)', palpite: [1, 1], jogo: [0, 0], esperado: 5 },
    { nome: 'Goleada Espanha 5x0 (palpitei 3x0)', palpite: [3, 0], jogo: [5, 0], esperado: 7 },
    { nome: 'Zebra: Catar 1x0 Suíça (palpitei 0x2)', palpite: [0, 2], jogo: [1, 0], esperado: 0 },
    { nome: 'Empate 2x2 EUA Paraguai (palpitei 3x3)', palpite: [3, 3], jogo: [2, 2], esperado: 5 },
  ];
  it.each(casos)('$nome → $esperado pts', (c) => expect(calc(c)).toBe(c.esperado));
});

describe('🛡️ Edge cases — placar null (jogo ainda não rolou)', () => {
  it('jogo sem placar (null/null) → 0 pts', () => {
    const pontos = calcularPontos(
      { golsCasa: 2, golsVisitante: 1 },
      { golsCasa: null, golsVisitante: null },
      cfg,
    );
    expect(pontos).toBe(0);
  });
  it('jogo com casa null → 0 pts', () => {
    const pontos = calcularPontos(
      { golsCasa: 2, golsVisitante: 1 },
      { golsCasa: null, golsVisitante: 0 },
      cfg,
    );
    expect(pontos).toBe(0);
  });
  it('jogo com visitante null → 0 pts', () => {
    const pontos = calcularPontos(
      { golsCasa: 2, golsVisitante: 1 },
      { golsCasa: 2, golsVisitante: null },
      cfg,
    );
    expect(pontos).toBe(0);
  });
});

describe('⚖️ Simetria casa/visitante (espelho)', () => {
  // Pra cada par (a,b) vs (c,d), o mesmo placar espelhado (b,a) vs (d,c)
  // deve dar a MESMA pontuação. Garante que a função não favorece um lado.
  const espelhos: Array<[Cenario, Cenario]> = [
    [
      { nome: '2x0 vs 2x1', palpite: [2, 0], jogo: [2, 1], esperado: 7 },
      { nome: '0x2 vs 1x2 (espelho)', palpite: [0, 2], jogo: [1, 2], esperado: 7 },
    ],
    [
      { nome: '3x0 vs 2x1', palpite: [3, 0], jogo: [2, 1], esperado: 5 },
      { nome: '0x3 vs 1x2 (espelho)', palpite: [0, 3], jogo: [1, 2], esperado: 5 },
    ],
    [
      { nome: '1x2 vs 2x1 (inverso = 0)', palpite: [1, 2], jogo: [2, 1], esperado: 0 },
      { nome: '2x1 vs 1x2 (espelho)', palpite: [2, 1], jogo: [1, 2], esperado: 0 },
    ],
  ];
  it.each(espelhos)('par $0.nome ↔ $1.nome têm mesma pontuação', (a, b) => {
    expect(calc(a)).toBe(calc(b));
    expect(calc(a)).toBe(a.esperado);
  });
});

describe('📜 Regra "NÃO acumula" — sempre vale o MELHOR acerto', () => {
  // Cenários onde múltiplos critérios poderiam dar pontos diferentes.
  // O esperado é SEMPRE o tier MAIS ALTO que casa.
  it('placar exato passa POR todos os critérios — vale só 10', () => {
    // 2x1 vs 2x1: exato (10), também acerta resultado (5) e gols (3 ou 7).
    // Mas só vale 10.
    expect(calc({ nome: '', palpite: [2, 1], jogo: [2, 1], esperado: 10 })).toBe(10);
  });
  it('vencedor+gols casa NÃO vira "exato" (7, não 10)', () => {
    expect(calc({ nome: '', palpite: [2, 0], jogo: [2, 1], esperado: 7 })).toBe(7);
  });
});
