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

  // Sprint 3: assinatura mudou de `Intencao | null` para
  // `{ intencao, intencaoTentada?, confianca? }` pra suportar captura
  // de low_confidence. Todos os tests acessam `.intencao` agora.

  it('mapeia resposta valida pra Intencao', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      '{"intencao":"RANKING","confianca":0.9,"motivo":"usuario quer ver classificacao"}',
    );
    const result = await classificarIntencao('como tao os pontos do pessoal?');
    expect(result.intencao).toBe(Intencao.RANKING);
    expect(result.intencaoTentada).toBe('RANKING');
    expect(result.confianca).toBe(0.9);
  });

  it('retorna intencao=null mas mantem tentada/confianca quando confianca eh baixa (low_confidence)', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"AJUDA","confianca":0.3}');
    const result = await classificarIntencao('alguma coisa ambigua');
    expect(result.intencao).toBeNull();
    // Importante: preserva pra log de low_confidence
    expect(result.intencaoTentada).toBe('AJUDA');
    expect(result.confianca).toBe(0.3);
  });

  it('retorna null quando intencao eh DESCONHECIDO (mesmo com confianca alta)', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"DESCONHECIDO","confianca":0.9}');
    const result = await classificarIntencao('blá blá blá');
    expect(result.intencao).toBeNull();
    expect(result.intencaoTentada).toBe('DESCONHECIDO');
  });

  it('retorna null quando LLM devolve null (timeout/erro)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(null);
    const result = await classificarIntencao('qualquer texto');
    expect(result.intencao).toBeNull();
    expect(result.intencaoTentada).toBeUndefined();
  });

  it('retorna null quando JSON eh invalido', async () => {
    vi.mocked(chat).mockResolvedValueOnce('isso nao eh json');
    const result = await classificarIntencao('texto');
    expect(result.intencao).toBeNull();
    expect(result.intencaoTentada).toBeUndefined();
  });

  it('aceita JSON em fenced block ```json', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      '```json\n{"intencao":"CRIAR_BOLAO","confianca":0.85}\n```',
    );
    const result = await classificarIntencao('quero abrir um bolao');
    expect(result.intencao).toBe(Intencao.CRIAR_BOLAO);
  });

  it('confianca exatamente 0.55 eh aceita (threshold inclusivo)', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"RANKING","confianca":0.55}');
    const result = await classificarIntencao('texto');
    expect(result.intencao).toBe(Intencao.RANKING);
  });

  it('confianca 0.54 cai em low_confidence (intencao=null, mas tentada=RANKING)', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"intencao":"RANKING","confianca":0.54}');
    const result = await classificarIntencao('texto');
    expect(result.intencao).toBeNull();
    expect(result.intencaoTentada).toBe('RANKING');
    expect(result.confianca).toBe(0.54);
  });
});
