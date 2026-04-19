import { describe, it, expect } from 'vitest';
import { calcularPontos } from '../../src/modules/ranking/pontuacao.calc.js';
import { PONTUACAO_PADRAO } from '../../src/modules/ranking/ranking.types.js';

describe('calcularPontos', () => {
  const config = PONTUACAO_PADRAO;

  it('retorna 10 para placar exato', () => {
    const palpite = { golsCasa: 2, golsVisitante: 1 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(10);
  });

  it('retorna 10 para empate exato', () => {
    const palpite = { golsCasa: 0, golsVisitante: 0 };
    const jogo = { golsCasa: 0, golsVisitante: 0 };
    expect(calcularPontos(palpite, jogo, config)).toBe(10);
  });

  it('retorna 7 para resultado certo + gols da casa corretos', () => {
    const palpite = { golsCasa: 2, golsVisitante: 0 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(7);
  });

  it('retorna 7 para resultado certo + gols do visitante corretos', () => {
    const palpite = { golsCasa: 3, golsVisitante: 1 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(7);
  });

  it('retorna 5 para resultado correto sem acertar gols', () => {
    const palpite = { golsCasa: 3, golsVisitante: 0 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(5);
  });

  it('retorna 5 para empate correto com placar diferente', () => {
    const palpite = { golsCasa: 2, golsVisitante: 2 };
    const jogo = { golsCasa: 1, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(5);
  });

  it('retorna 3 para gols da casa corretos mas resultado errado', () => {
    const palpite = { golsCasa: 2, golsVisitante: 3 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(3);
  });

  it('retorna 3 para gols do visitante corretos mas resultado errado', () => {
    const palpite = { golsCasa: 0, golsVisitante: 1 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(3);
  });

  it('retorna 0 para erro total', () => {
    const palpite = { golsCasa: 0, golsVisitante: 3 };
    const jogo = { golsCasa: 2, golsVisitante: 1 };
    expect(calcularPontos(palpite, jogo, config)).toBe(0);
  });

  it('retorna 0 quando jogo nao tem resultado', () => {
    const palpite = { golsCasa: 2, golsVisitante: 1 };
    const jogo = { golsCasa: null, golsVisitante: null };
    expect(calcularPontos(palpite, jogo, config)).toBe(0);
  });

  it('aceita pontuacao customizada', () => {
    const custom = { ...config, placarExato: 20 };
    const palpite = { golsCasa: 1, golsVisitante: 0 };
    const jogo = { golsCasa: 1, golsVisitante: 0 };
    expect(calcularPontos(palpite, jogo, custom)).toBe(20);
  });

  it('retorna 5 para vitoria visitante correta sem placar', () => {
    const palpite = { golsCasa: 0, golsVisitante: 2 };
    const jogo = { golsCasa: 1, golsVisitante: 3 };
    expect(calcularPontos(palpite, jogo, config)).toBe(5);
  });
});
