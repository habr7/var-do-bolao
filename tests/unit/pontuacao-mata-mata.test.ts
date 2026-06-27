import { describe, it, expect } from 'vitest';
import { pontuarJogoMataMata } from '../../src/modules/ranking/pontuacao.calc.js';
import { TABELA_PONTOS, BONUS_CLASSIFICADO, PONTUACAO_PADRAO } from '../../src/modules/ranking/ranking.types.js';

/**
 * Travas da pontuação de mata-mata (dois eixos aditivos: placar por fase +
 * bônus de classificado). CASA = primeiro time. Placar do bolão = 90'+
 * prorrogação; pênalti NUNCA entra no placar, só define o classificado.
 *
 * Casos A–G da spec (16-avos / R32) + reprodução por fase.
 */
describe('pontuarJogoMataMata — casos A–G (R32)', () => {
  // | # | Palpite | Resultado | Classif real | Classif palpite | placar | bônus | total |
  // A: 2x2 vs 1x1, pênaltis, real CASA, palpite CASA (acertou) → só resultado 5 +3 = 8
  it('A — empate palpitado, acerta classificado: 5 + 3 = 8', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 2, palpiteVisitante: 2,
      palpiteClassificado: 'CASA',
      resultadoCasa: 1, resultadoVisitante: 1,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 5, bonus: 3 });
  });

  // B: 2x2 vs 1x1, pênaltis, real VISITANTE, palpite CASA (errou) → 5 + 0 = 5
  it('B — mesmo placar de A, erra classificado: 5 + 0 = 5 (placar intacto)', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 2, palpiteVisitante: 2,
      palpiteClassificado: 'CASA',
      resultadoCasa: 1, resultadoVisitante: 1,
      classificadoReal: 'VISITANTE',
    });
    expect(r).toEqual({ placar: 5, bonus: 0 });
  });

  // C: 3x1 vs 2x0, decisivo, real CASA (inferido CASA) → só resultado 5 +3 = 8
  it('C — decisivo, classificado inferido do vencedor: 5 + 3 = 8', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 3, palpiteVisitante: 1,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 0,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 5, bonus: 3 });
  });

  // D: 3x0 vs 2x0, real CASA → resultado + gols de 1 time 7 +3 = 10
  it('D — resultado + gols de um time (acertou o 0 do visitante): 7 + 3 = 10', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 3, palpiteVisitante: 0,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 0,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 7, bonus: 3 });
  });

  // E: 2x0 vs 2x0, real CASA → placar exato 10 +3 = 13
  it('E — placar exato: 10 + 3 = 13', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 2, palpiteVisitante: 0,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 0,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 10, bonus: 3 });
  });

  // F: 1x1 (passa CASA) vs 1x1 pênaltis, real CASA → exato empate 10 +3 = 13
  it('F — crava o empate e acerta quem passa: 10 + 3 = 13', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 1, palpiteVisitante: 1,
      palpiteClassificado: 'CASA',
      resultadoCasa: 1, resultadoVisitante: 1,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 10, bonus: 3 });
  });

  // G: 1x1 (passa VIS) vs 1x1 pênaltis, real CASA → exato empate 10 +0 = 10
  it('G — crava o empate mas erra quem passa: 10 + 0 = 10 (crava NUNCA perdida)', () => {
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 1, palpiteVisitante: 1,
      palpiteClassificado: 'VISITANTE',
      resultadoCasa: 1, resultadoVisitante: 1,
      classificadoReal: 'CASA',
    });
    expect(r).toEqual({ placar: 10, bonus: 0 });
  });
});

describe('pontuarJogoMataMata — invariantes', () => {
  it('R32 usa exatamente PONTUACAO_PADRAO no placar (mesmo nível dos grupos)', () => {
    expect(TABELA_PONTOS.R32).toEqual(PONTUACAO_PADRAO);
    expect(TABELA_PONTOS.GRUPOS).toEqual(PONTUACAO_PADRAO);
  });

  it('placar errado dá 0 de placar, mas o bônus do classificado sobrevive', () => {
    // palpite 5x0 decisivo CASA; resultado 0x3 (visitante venceu) → erro de placar.
    // Classificado inferido do palpite = CASA, real = CASA → bônus mesmo errando tudo no placar.
    const r = pontuarJogoMataMata({
      fase: 'R32',
      palpiteCasa: 5, palpiteVisitante: 0,
      palpiteClassificado: null,
      resultadoCasa: 0, resultadoVisitante: 3,
      classificadoReal: 'VISITANTE', // real visitante; palpitei CASA → erra bônus
    });
    expect(r.placar).toBe(0);
    expect(r.bonus).toBe(0);
  });

  it('sem classificado real ainda (null) → só placar, bônus 0', () => {
    const r = pontuarJogoMataMata({
      fase: 'QUARTAS',
      palpiteCasa: 2, palpiteVisitante: 1,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 1,
      classificadoReal: null,
    });
    expect(r).toEqual({ placar: 15, bonus: 0 });
  });

  it('empate sem palpiteClassificado (null) nunca leva bônus', () => {
    const r = pontuarJogoMataMata({
      fase: 'OITAVAS',
      palpiteCasa: 1, palpiteVisitante: 1,
      palpiteClassificado: null,
      resultadoCasa: 1, resultadoVisitante: 1,
      classificadoReal: 'CASA',
    });
    expect(r.bonus).toBe(0);
    expect(r.placar).toBe(TABELA_PONTOS.OITAVAS.placarExato); // 12
  });
});

describe('pontuarJogoMataMata — valores por fase (caso D = resultado+gols + bônus)', () => {
  // Caso D (3x0 vs 2x0, real CASA) repetido por fase: placar = resultadoMaisGols
  // da fase, bônus = BONUS_CLASSIFICADO da fase.
  const fases = ['R32', 'OITAVAS', 'QUARTAS', 'SEMI', 'TERCEIRO', 'FINAL'] as const;
  for (const fase of fases) {
    it(`${fase}: 7→${TABELA_PONTOS[fase].resultadoMaisGols} placar + ${BONUS_CLASSIFICADO[fase]} bônus`, () => {
      const r = pontuarJogoMataMata({
        fase,
        palpiteCasa: 3, palpiteVisitante: 0,
        palpiteClassificado: null,
        resultadoCasa: 2, resultadoVisitante: 0,
        classificadoReal: 'CASA',
      });
      expect(r.placar).toBe(TABELA_PONTOS[fase].resultadoMaisGols);
      expect(r.bonus).toBe(BONUS_CLASSIFICADO[fase]);
    });
  }

  it('exemplo da spec: caso D em QUARTAS = 10 + 4 = 14', () => {
    const r = pontuarJogoMataMata({
      fase: 'QUARTAS',
      palpiteCasa: 3, palpiteVisitante: 0,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 0,
      classificadoReal: 'CASA',
    });
    expect(r.placar + r.bonus).toBe(14);
  });

  it('final placar exato + bônus = 22 + 6 = 28 (teto do torneio)', () => {
    const r = pontuarJogoMataMata({
      fase: 'FINAL',
      palpiteCasa: 2, palpiteVisitante: 1,
      palpiteClassificado: null,
      resultadoCasa: 2, resultadoVisitante: 1,
      classificadoReal: 'CASA',
    });
    expect(r.placar + r.bonus).toBe(28);
  });
});
