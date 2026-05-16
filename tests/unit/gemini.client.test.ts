import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock env antes de importar o cliente (Gemini só roda se GEMINI_API_KEY existir)
vi.mock('../../src/config/env.js', () => ({
  env: {
    LLM_ENABLED: true,
    LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-2.5-flash-lite',
    LLM_TIMEOUT_MS: 5000,
    LLM_URL: 'https://ollama.com',
    LLM_API_KEY: 'dry-run-llm-key',
    LLM_MODEL: 'gpt-oss:20b',
  },
}));

import { chatGemini } from '../../src/llm/gemini.client.js';

describe('chatGemini', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('converte mensagens system → systemInstruction + user/assistant → contents', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'olá!' }] } }],
      }),
    } as Response);

    const out = await chatGemini([
      { role: 'system', content: 'voce eh um bot' },
      { role: 'user', content: 'oi' },
    ]);

    expect(out).toBe('olá!');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-2.5-flash-lite');
    expect(url).toContain('key=test-key');

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.systemInstruction.parts[0].text).toBe('voce eh um bot');
    expect(body.contents).toHaveLength(1);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[0].parts[0].text).toBe('oi');
  });

  it('passa responseMimeType=application/json quando opts.json=true', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
    } as Response);

    await chatGemini([{ role: 'user', content: 'classifica' }], { json: true });

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('desabilita thinking SEMPRE (mesmo sem json)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    } as Response);

    // Chamada SEM json: ainda deve ter thinkingBudget=0
    await chatGemini([{ role: 'user', content: 'oi' }]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig.responseMimeType).toBeUndefined();
  });

  it('retorna null quando HTTP != 2xx', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit',
    } as Response);

    const out = await chatGemini([{ role: 'user', content: 'oi' }]);
    expect(out).toBeNull();
  });

  it('retorna null quando promptFeedback.blockReason', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        promptFeedback: { blockReason: 'SAFETY' },
      }),
    } as Response);

    const out = await chatGemini([{ role: 'user', content: 'oi' }]);
    expect(out).toBeNull();
  });

  it('mapeia role assistant → model', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }),
    } as Response);

    await chatGemini([
      { role: 'user', content: 'a' },
      { role: 'assistant', content: 'b' },
      { role: 'user', content: 'c' },
    ]);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.contents[0].role).toBe('user');
    expect(body.contents[1].role).toBe('model');
    expect(body.contents[2].role).toBe('user');
  });
});
