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

  describe('v3.13.0 — edge cases (audit pré-Copa)', () => {
    it('placar 0x0 exato → 10 pts', () => {
      expect(calcularPontos({ golsCasa: 0, golsVisitante: 0 }, { golsCasa: 0, golsVisitante: 0 }, config)).toBe(10);
    });
    it('placar exato com gols altos (5x3) → 10 pts', () => {
      expect(calcularPontos({ golsCasa: 5, golsVisitante: 3 }, { golsCasa: 5, golsVisitante: 3 }, config)).toBe(10);
    });
    it('palpite 0x0 mas deu 1x1 (empate diferente) → 5 pts (só resultado)', () => {
      expect(calcularPontos({ golsCasa: 0, golsVisitante: 0 }, { golsCasa: 1, golsVisitante: 1 }, config)).toBe(5);
    });
    it('palpite acerta gols só do time visitante com resultado errado → 3 pts', () => {
      // Você 2x1 (casa ganha), deu 0x1 (visitante perde mas empate aqui não)
      // Resultado errado, gols visitante (1) correto → 3 pts
      expect(calcularPontos({ golsCasa: 2, golsVisitante: 1 }, { golsCasa: 0, golsVisitante: 1 }, config)).toBe(3);
    });
    it('placar quase exato 2x1 vs 2x0 → 7 pts (resultado + gols casa)', () => {
      expect(calcularPontos({ golsCasa: 2, golsVisitante: 1 }, { golsCasa: 2, golsVisitante: 0 }, config)).toBe(7);
    });
    it('vitória visitante por 2 gols (3x1 vs 1x3) → 5 pts (só resultado)', () => {
      expect(calcularPontos({ golsCasa: 1, golsVisitante: 3 }, { golsCasa: 0, golsVisitante: 2 }, config)).toBe(5);
    });
    it('placar inverso (palpite 1x2, deu 2x1) → 0 pts (errou vencedor e gols)', () => {
      expect(calcularPontos({ golsCasa: 1, golsVisitante: 2 }, { golsCasa: 2, golsVisitante: 1 }, config)).toBe(0);
    });
  });
});
