import { describe, it, expect, vi } from 'vitest';

// intent.classifier importa llm.client → env (que valida DATABASE_URL no
// load). Mocka o env pra este teste de estrutura não depender de ambiente.
vi.mock('../../src/config/env.js', () => ({ env: { LLM_TIMEOUT_MS: 8000 } }));

const { INTENCOES_VALIDAS } = await import('../../src/llm/intent.classifier.js');
const { INTENT_CLASSIFIER_PROMPT } = await import('../../src/llm/system-prompts.js');
const { Intencao } = await import('../../src/whatsapp/message.parser.js');

/**
 * v3.32.0 — Teste ANTI-DRIFT do classificador LLM.
 *
 * Bug estrutural real (caso Humberto 11/06 23:49): o INTENT_CLASSIFIER_PROMPT
 * descrevia PLACAR_JOGO/STATUS_RODADA/etc. (o Gemini classificava certo),
 * mas a whitelist INTENCOES_VALIDAS estava congelada na era Sprint 4 e
 * REJEITAVA o retorno → "Quais jogos estao rolando?" caía no "não sei"
 * mesmo com o jogo AO VIVO no banco.
 *
 * Este teste garante que TODA intent descrita no prompt (linhas "- NOME:")
 * está na whitelist e existe no enum — intent nova no prompt sem entrar na
 * whitelist quebra o build.
 */

function intentsDoPrompt(): string[] {
  return [...INTENT_CLASSIFIER_PROMPT.matchAll(/^- ([A-Z_]+):/gm)]
    .map((m) => m[1])
    .filter((nome) => nome !== 'DESCONHECIDO'); // sentinel "não sei" — fora da whitelist de propósito
}

describe('anti-drift: INTENT_CLASSIFIER_PROMPT ↔ INTENCOES_VALIDAS ↔ enum', () => {
  it('o prompt descreve pelo menos 40 intents (sanidade do extrator)', () => {
    expect(intentsDoPrompt().length).toBeGreaterThanOrEqual(40);
  });

  it('toda intent descrita no prompt está na whitelist INTENCOES_VALIDAS', () => {
    const whitelist = new Set<string>(INTENCOES_VALIDAS as readonly string[]);
    const faltando = intentsDoPrompt().filter((nome) => !whitelist.has(nome));
    expect(faltando, `Intents descritas no prompt mas REJEITADAS pela whitelist (bug do "não sei"): ${faltando.join(', ')}`).toEqual([]);
  });

  it('toda intent descrita no prompt existe no enum Intencao', () => {
    const enumNomes = new Set(Object.values(Intencao) as string[]);
    const fantasmas = intentsDoPrompt().filter((nome) => !enumNomes.has(nome));
    expect(fantasmas, `Intents no prompt que não existem no enum: ${fantasmas.join(', ')}`).toEqual([]);
  });

  it('toda intent da whitelist existe no enum Intencao', () => {
    const enumNomes = new Set(Object.values(Intencao) as string[]);
    const fantasmas = (INTENCOES_VALIDAS as readonly string[]).filter((n) => !enumNomes.has(n));
    expect(fantasmas).toEqual([]);
  });

  it('caso real 11/06: PLACAR_JOGO e STATUS_RODADA estão na whitelist', () => {
    const whitelist = new Set<string>(INTENCOES_VALIDAS as readonly string[]);
    expect(whitelist.has('PLACAR_JOGO')).toBe(true);
    expect(whitelist.has('STATUS_RODADA')).toBe(true);
    expect(whitelist.has('PALPITE_OUTROS')).toBe(true);
  });
});
