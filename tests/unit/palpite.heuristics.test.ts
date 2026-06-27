import { describe, it, expect } from 'vitest';
import {
  parecePalpiteMasNaoEntendi,
  parecePalpiteSoPlacar,
  pareceListaDeConfrontosSemPlacar,
} from '../../src/whatsapp/palpite.heuristics.js';

/**
 * v3.10.0 — Testes do guard anti-mentira do LLM (caso Valéria 22/05).
 * Detecta texto que parece palpite e bloqueia o smart-fallback, evitando
 * que o LLM responda "Seus palpites foram registrados" sem registrar.
 */
describe('parecePalpiteMasNaoEntendi', () => {
  describe('CASOS POSITIVOS — bloqueia LLM', () => {
    it('caso real Valéria 22/05 11:23 (10 palpites formato invertido) → true', () => {
      const texto = `1x1 México x África do Sul
1x0 Coreia do Sul x República Tcheca
0x1 Canadá x Bósnia e Herzegovina
1x2 Estados Unidos x Paraguai`;
      expect(parecePalpiteMasNaoEntendi(texto)).toBe(true);
    });

    it('caso real Valéria 22/05 11:20 (linha única, 10 placares) → true', () => {
      const texto =
        '1x1 México x África do Sul 1x0 Coreia do Sul x República Tcheca 0x1 Canadá x Bósnia';
      expect(parecePalpiteMasNaoEntendi(texto)).toBe(true);
    });

    it('"Brasil 2x1 Marrocos. Argentina 0x0 Peru" (2 placares mesmo se parser falhar) → true', () => {
      expect(parecePalpiteMasNaoEntendi('Brasil 2x1 Marrocos. Argentina 0x0 Peru')).toBe(true);
    });

    it('2 placares com separador "a" → true', () => {
      expect(parecePalpiteMasNaoEntendi('Brasil 2 a 1 Marrocos. Peru 1 a 0 Chile')).toBe(true);
    });

    it('2 placares com traço → true', () => {
      expect(parecePalpiteMasNaoEntendi('1-0 Brasil x Argentina, 2-1 Peru x Chile')).toBe(true);
    });
  });

  describe('CASOS NEGATIVOS — deixa LLM responder', () => {
    it('1 placar só ("vou no jogo 2x1 sábado") → false', () => {
      expect(parecePalpiteMasNaoEntendi('vou no jogo 2x1 sábado')).toBe(false);
    });

    it('1 palpite válido isolado ("Brasil 2x1 Marrocos") → false', () => {
      // Esse já deve cair em PALPITE_INLINE, não em smart-fallback. Mas
      // garantimos que o guard não bloqueia ele caso passe por aqui.
      expect(parecePalpiteMasNaoEntendi('Brasil 2x1 Marrocos')).toBe(false);
    });

    it('texto sem placar nenhum → false', () => {
      expect(parecePalpiteMasNaoEntendi('quais palpites foram registrados?')).toBe(false);
    });

    it('saudação → false', () => {
      expect(parecePalpiteMasNaoEntendi('oi tudo bem')).toBe(false);
    });

    it('pergunta sobre Copa → false', () => {
      expect(parecePalpiteMasNaoEntendi('quando o Brasil joga?')).toBe(false);
    });

    it('horário (não é placar de bolão) → false', () => {
      // "20:00" tem dígitos mas não casa formato NxN
      expect(parecePalpiteMasNaoEntendi('o jogo é 20:00 sábado')).toBe(false);
    });
  });
});

/**
 * v3.40.0 — placar puro sem time (caso real "3x0").
 */
describe('parecePalpiteSoPlacar', () => {
  it('"3x0" → {placar:"3x0"}', () => {
    expect(parecePalpiteSoPlacar('3x0')).toEqual({ placar: '3x0' });
  });
  it('"3 x 0!" (espaços + pontuação) → 3x0', () => {
    expect(parecePalpiteSoPlacar('3 x 0!')).toEqual({ placar: '3x0' });
  });
  it('"2 a 1" (separador por extenso) → normaliza pra 2x1', () => {
    expect(parecePalpiteSoPlacar('2 a 1')).toEqual({ placar: '2x1' });
  });
  it('"Brasil 3x0" (tem time) → null (é parecePalpiteIncompleto)', () => {
    expect(parecePalpiteSoPlacar('Brasil 3x0')).toBeNull();
  });
  it('"3x0 Brasil" (tem time depois) → null', () => {
    expect(parecePalpiteSoPlacar('3x0 Brasil')).toBeNull();
  });
  it('lote "2x1, 0x0" (2 âncoras) → null', () => {
    expect(parecePalpiteSoPlacar('2x1, 0x0')).toBeNull();
  });
  it('texto sem placar → null', () => {
    expect(parecePalpiteSoPlacar('oi')).toBeNull();
  });
});

/**
 * v3.40.0 — lista de confrontos SEM placar (caso real 6 jogos).
 */
describe('pareceListaDeConfrontosSemPlacar', () => {
  it('caso real: 6 confrontos sem placar → detecta os 6', () => {
    const texto = `Noruega x França
Senegal x Iraque
Uruguai x Espanha
Cabo Verde x Arábia Saudita
Egito x Irã
Nova Zelândia x Bélgica`;
    const r = pareceListaDeConfrontosSemPlacar(texto);
    expect(r).not.toBeNull();
    expect(r?.confrontos).toHaveLength(6);
    expect(r?.confrontos[0]).toBe('Noruega x França');
  });

  it('aceita "vs" e "contra" como separador', () => {
    const r = pareceListaDeConfrontosSemPlacar('Brasil vs Argentina\nPeru contra Chile');
    expect(r?.confrontos).toHaveLength(2);
  });

  it('1 confronto só → null (pode ser pergunta "quem ganha?")', () => {
    expect(pareceListaDeConfrontosSemPlacar('Noruega x França')).toBeNull();
  });

  it('lista COM placar → null (outro fluxo cuida)', () => {
    expect(
      pareceListaDeConfrontosSemPlacar('Brasil 2x1 Argentina\nPeru 0x0 Chile'),
    ).toBeNull();
  });

  it('texto em prosa (não confrontos) → null', () => {
    expect(
      pareceListaDeConfrontosSemPlacar('oi tudo bem\nquando começa o bolão?'),
    ).toBeNull();
  });
});
