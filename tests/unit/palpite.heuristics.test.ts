import { describe, it, expect } from 'vitest';
import { parecePalpiteMasNaoEntendi } from '../../src/whatsapp/palpite.heuristics.js';

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
