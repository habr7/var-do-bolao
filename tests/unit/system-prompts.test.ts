import { describe, it, expect } from 'vitest';
import { BASE_CONTEXT } from '../../src/llm/system-prompts.js';

/**
 * v3.13.0 — testes pra BASE_CONTEXT do LLM.
 *
 * Bug histórico (descoberto no audit pré-Copa): BASE_CONTEXT dizia
 * "5 pts placar exato, 3 pts vencedor, 2 pts empate" — pontuação ANTIGA.
 * Verdade canônica é 10/7/5/3/0. Isso afetava classifier, extractor,
 * matchers — toda LLM que importa BASE_CONTEXT.
 */
describe('BASE_CONTEXT (LLM)', () => {
  describe('pontuação correta (10/7/5/3/0)', () => {
    it('cita 10 pts placar exato', () => {
      expect(BASE_CONTEXT.toLowerCase()).toMatch(/10 pts.*placar exato/);
    });
    it('cita 7 pts vencedor + gols', () => {
      expect(BASE_CONTEXT.toLowerCase()).toMatch(/7 pts.*vencedor/);
    });
    it('NÃO cita "5 pts placar exato" (texto antigo errado)', () => {
      expect(BASE_CONTEXT.toLowerCase()).not.toMatch(/5 pts placar exato/);
    });
    it('NÃO cita "2 pts" (que era a versão antiga errada do empate)', () => {
      expect(BASE_CONTEXT.toLowerCase()).not.toMatch(/2 pts/);
    });
  });

  describe('outras verdades canônicas', () => {
    it('cita que admin NÃO vê palpites individuais (v3.11.0)', () => {
      expect(BASE_CONTEXT.toLowerCase()).toMatch(/admin n[ãa]o ve|admin n[ãa]o ve o conteudo/);
    });
    it('cita prazo por jogo individual (kickoff), não por rodada', () => {
      expect(BASE_CONTEXT.toLowerCase()).toMatch(/kickoff do jogo|cada palpite trava|cada jogo tem/);
    });
    it('cita fuso de Brasília', () => {
      expect(BASE_CONTEXT.toLowerCase()).toMatch(/brasilia|brasília/);
    });
    it('cita feature multi-bolão TODOS (v3.12.0)', () => {
      expect(BASE_CONTEXT.toUpperCase()).toContain('TODOS');
    });
  });
});
