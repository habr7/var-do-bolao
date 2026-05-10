import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  env: {
    LLM_ENABLED: false,
    LLM_URL: 'https://ollama.com',
    LLM_API_KEY: 'dry-run-llm-key',
    LLM_MODEL: 'gpt-oss:20b',
    LLM_TIMEOUT_MS: 5000,
  },
}));

import { tryParseJson } from '../../src/llm/ollama.client.js';

describe('tryParseJson', () => {
  it('parseia JSON puro', () => {
    expect(tryParseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('extrai JSON de fenced block ```json', () => {
    const raw = 'Resposta:\n```json\n{"intencao":"RANKING","confianca":0.9}\n```\nFim.';
    expect(tryParseJson<{ intencao: string; confianca: number }>(raw)).toEqual({
      intencao: 'RANKING',
      confianca: 0.9,
    });
  });

  it('extrai JSON de fenced block ``` sem language', () => {
    const raw = '```\n{"foo":"bar"}\n```';
    expect(tryParseJson<{ foo: string }>(raw)).toEqual({ foo: 'bar' });
  });

  it('extrai JSON entre chaves quando ha texto antes/depois', () => {
    const raw = 'Aqui esta a resposta: {"resultado":42, "ok":true}. Espero ter ajudado!';
    expect(tryParseJson<{ resultado: number; ok: boolean }>(raw)).toEqual({
      resultado: 42,
      ok: true,
    });
  });

  it('retorna null pra entrada null', () => {
    expect(tryParseJson(null)).toBeNull();
  });

  it('retorna null pra entrada sem JSON valido', () => {
    expect(tryParseJson('isso nao eh json nem perto')).toBeNull();
  });

  it('retorna null pra JSON malformado', () => {
    expect(tryParseJson('{"chave":')).toBeNull();
  });
});
