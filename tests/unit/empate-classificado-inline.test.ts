import { describe, it, expect } from 'vitest';
import { parseIntencao, parseMultiplePalpites, Intencao } from '../../src/whatsapp/message.parser.js';

/**
 * Mata-mata — captura do classificado quando o user já manda "quem passa" na
 * MESMA mensagem do palpite de empate ("Brasil 1x1 Japão e o Brasil passa").
 * Em decisivo o classificado é inferido do vencedor → o hint é ignorado.
 */
describe('empate + classificado inline', () => {
  const p = (texto: string) => parseMultiplePalpites(texto)[0];

  it('empate SEM hint → não captura (fluxo vai perguntar)', () => {
    const r = p('Brasil 1x1 Japão');
    expect(r).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Japão', golsCasa: 1, golsVisitante: 1 });
    expect(r.classificado).toBeUndefined();
  });

  it('captura CASA em várias formas de dizer que o mandante passa', () => {
    const casa = [
      'Brasil 1x1 Japão e o Brasil passa',
      'Brasil 1x1 Japão, Brasil classifica',
      'Brasil 1x1 Japão mas quem passa é o Brasil',
      'Brasil 1 a 1 Japão, vai o Brasil',
      'Brasil 1x1 Japão (Brasil)',
      'Brasil 1x1 Japão e o Brasil se classifica nos penaltis',
      'Brasil 1x1 Japão, o Brasil avança',
    ];
    for (const t of casa) {
      const r = p(t);
      expect(r, t).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Japão', classificado: 'CASA' });
    }
  });

  it('captura VISITANTE quando quem passa é o visitante', () => {
    const vis = [
      'Brasil 1x1 Japão com o Japão avançando',
      'Brasil 1x1 Japão, o Japão avança',
      '1x1 Brasil x Japão, classifico o Japão',
      'Brasil 1x1 Japão e o Japão passa',
    ];
    for (const t of vis) {
      const r = p(t);
      expect(r, t).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Japão', classificado: 'VISITANTE' });
    }
  });

  it('NÃO captura o nome do time poluído no placar', () => {
    // regressão: antes "Japão e o Brasil passa" virava o nome do visitante
    expect(p('Brasil 1x1 Japão e o Brasil passa').timeVisitante).toBe('Japão');
    expect(p('Brasil 1x1 Japão com o Japão avançando').timeVisitante).toBe('Japão');
  });

  it('DECISIVO ignora o hint (classificado é inferido do vencedor)', () => {
    expect(p('Brasil 2x1 Japão, Japão passa').classificado).toBeUndefined();
    expect(p('Brasil 2x1 Japão e o Brasil passa').classificado).toBeUndefined();
  });

  it('hint ambíguo / sem time do jogo → não captura (vai perguntar)', () => {
    expect(p('Brasil 1x1 Japão, vai dar zebra').classificado).toBeUndefined();
    expect(p('Brasil 1x1 Japão e alguém passa').classificado).toBeUndefined();
  });

  it('um palpite REAL não é sequestrado por INFO_PENALTI ("...nos penaltis")', () => {
    expect(parseIntencao('Brasil 1x1 Japão e o Brasil se classifica nos penaltis').intencao).toBe(
      Intencao.PALPITE_INLINE,
    );
    // pergunta pura sobre pênalti segue indo pra INFO_PENALTI
    expect(parseIntencao('penalti conta no placar?').intencao).toBe(Intencao.INFO_PENALTI);
  });

  it('lote com 2 empates capta o classificado de cada um', () => {
    const lote = parseMultiplePalpites('Brasil 1x1 Japão, Brasil passa\nFrança 0x0 Espanha, Espanha avança');
    expect(lote).toHaveLength(2);
    expect(lote[0]).toMatchObject({ timeCasa: 'Brasil', classificado: 'CASA' });
    expect(lote[1]).toMatchObject({ timeCasa: 'França', timeVisitante: 'Espanha', classificado: 'VISITANTE' });
  });
});
