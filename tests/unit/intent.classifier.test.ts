import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka env (LLM ligado mas chave dry-run pra forcar bypass)
vi.mock('../../src/config/env.js', () => ({
  env: {
    LLM_ENABLED: true,
    LLM_URL: 'https://ollama.com',
    LLM_API_KEY: 'dry-run-llm-key',
    LLM_MODEL: 'gpt-oss:20b',
    LLM_TIMEOUT_MS: 5000,
  },
}));

// Mocka o ollama.client pra controlar resposta sem fazer HTTP real
vi.mock('../../src/llm/ollama.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/ollama.client.js')>();
  return {
    ...actual,
    chat: vi.fn(),
  };
});

import { classificarIntencao } from '../../src/llm/intent.classifier.js';
import { chat } from '../../src/llm/ollama.client.js';
import { Intencao } from '../../src/whatsapp/message.parser.js';

describe('classificarIntencao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mapeia resposta valida pra Intencao', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      '{"intencao":"RANKING","confianca":0.9,"motivo":"usuario quer ver classificacao"}',
    );
    const result = await classificarIntencao('como tao os pontos do pessoal?');
    expect(result).toBe(Intencao.RANKING);
  });

  it('retorna null quando confianca eh baixa', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"AJUDA","confianca":0.3}');
    const result = await classificarIntencao('alguma coisa ambigua');
    expect(result).toBeNull();
  });

  it('retorna null quando intencao eh DESCONHECIDO', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"DESCONHECIDO","confianca":0.9}');
    const result = await classificarIntencao('blá blá blá');
    expect(result).toBeNull();
  });

  it('retorna null quando LLM devolve null (timeout/erro)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(null);
    const result = await classificarIntencao('qualquer texto');
    expect(result).toBeNull();
  });

  it('retorna null quando JSON eh invalido', async () => {
    vi.mocked(chat).mockResolvedValueOnce('isso nao eh json');
    const result = await classificarIntencao('texto');
    expect(result).toBeNull();
  });

  it('aceita JSON em fenced block ```json', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      '```json\n{"intencao":"CRIAR_BOLAO","confianca":0.85}\n```',
    );
    const result = await classificarIntencao('quero abrir um bolao');
    expect(result).toBe(Intencao.CRIAR_BOLAO);
  });
});
