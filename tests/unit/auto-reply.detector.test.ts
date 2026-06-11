import { describe, it, expect } from 'vitest';
import { parecAutoReply } from '../../src/whatsapp/auto-reply.detector.js';

/**
 * v3.18.0 — Bateria do detector de auto-reply.
 *
 * Caso real motivador (Lucas 11/06, print 09:00): bot mandou bom-dia →
 * WhatsApp do Lucas tinha auto-reply "Agradeço seu contato, respondo
 * em breve" → bot interpretou como AGRADECIMENTO → respondeu → loop de
 * 8 msgs em 60s.
 */

describe('parecAutoReply — casos POSITIVOS (silenciar)', () => {
  it('caso EXATO Lucas 11/06', () => {
    expect(parecAutoReply('Agradeço seu contato, respondo em breve.')).toBe(true);
  });
  it('variante sem pontuação', () => {
    expect(parecAutoReply('Agradeço seu contato respondo em breve')).toBe(true);
  });
  it('sem acento', () => {
    expect(parecAutoReply('Agradeco seu contato, respondo em breve')).toBe(true);
  });
  it('"Obrigado pelo contato, retorno em breve"', () => {
    expect(parecAutoReply('Obrigado pelo contato, retorno em breve.')).toBe(true);
  });
  it('"Obrigado pela mensagem, responderei assim que possível"', () => {
    expect(
      parecAutoReply('Obrigado pela mensagem, responderei assim que possível.'),
    ).toBe(true);
  });
  it('"Estou ausente no momento. Retorno em breve"', () => {
    expect(parecAutoReply('Estou ausente no momento. Retorno em breve.')).toBe(true);
  });
  it('"Fora do horário de atendimento. Volto amanhã"', () => {
    expect(parecAutoReply('Fora do horário de atendimento. Volto amanhã 9h.')).toBe(true);
  });
  it('"Mensagem automática: respondo o quanto antes"', () => {
    expect(parecAutoReply('Mensagem automática: respondo o quanto antes')).toBe(true);
  });
  it('"Olá! Estarei ausente. Sua mensagem será respondida em breve."', () => {
    expect(
      parecAutoReply('Olá! Estarei ausente. Sua mensagem será respondida em breve.'),
    ).toBe(true);
  });
  it('"Agradeço sua mensagem, responderei o mais rápido possível"', () => {
    expect(
      parecAutoReply('Agradeço sua mensagem, responderei o mais rápido possível.'),
    ).toBe(true);
  });
  it('"No momento não posso atender. Retorno o quanto antes"', () => {
    expect(parecAutoReply('No momento não posso atender. Retorno o quanto antes.')).toBe(
      true,
    );
  });
  it('"Fora do expediente. Resposta automática."', () => {
    expect(parecAutoReply('Fora do expediente. Resposta automática.')).toBe(true);
  });
});

describe('parecAutoReply — casos NEGATIVOS (responder normal)', () => {
  it('"obrigado" sozinho', () => {
    expect(parecAutoReply('obrigado')).toBe(false);
  });
  it('"valeu cara, muito obrigado"', () => {
    expect(parecAutoReply('valeu cara, muito obrigado')).toBe(false);
  });
  it('"Agradeço!" curto', () => {
    expect(parecAutoReply('Agradeço!')).toBe(false);
  });
  it('"Agradeço você"', () => {
    expect(parecAutoReply('Agradeço você')).toBe(false);
  });
  it('mensagem com "horário" mas sem padrão', () => {
    expect(parecAutoReply('Que horário começa o jogo do Brasil?')).toBe(false);
  });
  it('"Estou em casa" (não é auto-reply)', () => {
    expect(parecAutoReply('Estou em casa, manda os jogos')).toBe(false);
  });
  it('palpite normal longo', () => {
    expect(
      parecAutoReply('Brasil 2x1 Marrocos, Argentina 3x0 Algeria, Alemanha 1x1 França'),
    ).toBe(false);
  });
  it('mensagem vazia', () => {
    expect(parecAutoReply('')).toBe(false);
  });
  it('mensagem curta com "obrigado pelo"', () => {
    // "obrigado pelo" sozinho não casa (precisa "contato" ou "mensagem"
    // depois). E é curta — bloco de tamanho mínimo já filtra.
    expect(parecAutoReply('obrigado pelo')).toBe(false);
  });
});
