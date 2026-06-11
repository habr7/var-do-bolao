import { describe, it, expect } from 'vitest';
import { regrasTexto } from '../../src/whatsapp/regras.text.js';

/**
 * v3.13.0 — testes pro texto canônico de regras.
 *
 * Bug histórico: dizia "palpites travam quando o primeiro jogo da rodada
 * começa" — MENTIRA. Código (`palpite.service.ts:66`) trava cada jogo
 * no seu kickoff individual. Knowledge da LLM já estava correta. Texto
 * de regras era a única peça mentindo.
 */
describe('regrasTexto', () => {
  const texto = regrasTexto();
  const lower = texto.toLowerCase();

  describe('pontuação canônica 10/7/5/3/0', () => {
    it('cita 10 pts placar exato', () => {
      expect(texto).toContain('10 pts');
      expect(lower).toMatch(/placar exato/);
    });
    it('cita 7 pts vencedor + gols de um time', () => {
      expect(texto).toContain('7 pts');
    });
    it('cita 5 pts só vencedor', () => {
      expect(texto).toContain('5 pts');
    });
    it('cita 3 pts só gols com resultado errado', () => {
      expect(texto).toContain('3 pts');
    });
    it('cita 0 pts erro total', () => {
      expect(texto).toContain('0 pts');
    });
    it('explica que critérios NÃO acumulam', () => {
      expect(lower).toMatch(/n[ãa]o acumulam|melhor acerto/);
    });
  });

  describe('PRAZO DE PALPITE — v3.13.0 (caso pré-Copa)', () => {
    it('NÃO menciona mais "primeiro jogo da rodada" (texto antigo errado)', () => {
      expect(lower).not.toMatch(/primeiro jogo da rodada come[çc]a/);
    });
    it('cita que CADA jogo trava no kickoff individual', () => {
      expect(lower).toMatch(/cada palpite trava|cada jogo|kickoff/);
    });
    it('cita explicitamente que pode palpitar nos próximos do mesmo dia', () => {
      expect(lower).toMatch(/pr[óo]ximos do mesmo dia|cada jogo tem seu pr[óo]prio prazo/);
    });
    it('cita fuso de Brasília', () => {
      expect(lower).toMatch(/bras[íi]lia/);
    });
  });

  describe('comandos canônicos citados', () => {
    it('cita próximos jogos', () => {
      expect(lower).toContain('próximos jogos');
    });
    it('cita meus palpites', () => {
      expect(lower).toContain('meus palpites');
    });
    it('cita ranking', () => {
      expect(lower).toContain('ranking');
    });
  });
});
