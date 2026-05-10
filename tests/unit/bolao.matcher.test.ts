import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/env.js', () => ({
  env: {
    LLM_ENABLED: true,
    LLM_URL: 'https://ollama.com',
    LLM_API_KEY: 'dry-run-llm-key',
    LLM_MODEL: 'gpt-oss:20b',
    LLM_TIMEOUT_MS: 5000,
  },
}));

vi.mock('../../src/llm/ollama.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm/ollama.client.js')>();
  return {
    ...actual,
    chat: vi.fn(),
  };
});

import { escolherBolaoDaLista, interpretarSimNao } from '../../src/llm/bolao.matcher.js';
import { chat } from '../../src/llm/ollama.client.js';

const BOLOES = [
  { id: 'b1', nome: 'Bolão da Firma' },
  { id: 'b2', nome: 'Bolão dos Amigos' },
  { id: 'b3', nome: 'Copa 2026 com a galera' },
];

describe('escolherBolaoDaLista', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna o unico bolao quando lista tem 1', async () => {
    const r = await escolherBolaoDaLista('qualquer texto', [BOLOES[0]]);
    expect(r?.id).toBe('b1');
  });

  it('retorna null quando lista vazia', async () => {
    const r = await escolherBolaoDaLista('texto', []);
    expect(r).toBeNull();
  });

  it('match exato (case-insensitive, sem acento)', async () => {
    const r = await escolherBolaoDaLista('bolao da firma', BOLOES);
    expect(r?.id).toBe('b1');
    expect(chat).not.toHaveBeenCalled();
  });

  it('match por substring', async () => {
    const r = await escolherBolaoDaLista('firma', BOLOES);
    expect(r?.id).toBe('b1');
    expect(chat).not.toHaveBeenCalled();
  });

  it('match por palavra parcial', async () => {
    const r = await escolherBolaoDaLista('amigos', BOLOES);
    expect(r?.id).toBe('b2');
  });

  it('cai pro LLM quando nao acha match local', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"bolaoId":"b3","confianca":0.85}');
    const r = await escolherBolaoDaLista('aquele com a turma', BOLOES);
    expect(r?.id).toBe('b3');
    expect(chat).toHaveBeenCalled();
  });

  it('retorna null quando LLM tem confianca baixa', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"bolaoId":"b1","confianca":0.4}');
    const r = await escolherBolaoDaLista('dunno', BOLOES);
    expect(r).toBeNull();
  });

  it('retorna null quando LLM responde NONE', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"bolaoId":"NONE","confianca":0}');
    const r = await escolherBolaoDaLista('coisa diferente', BOLOES);
    expect(r).toBeNull();
  });

  it('match exato vence quando ha varios candidatos', async () => {
    const opts = [
      { id: 'a', nome: 'Bolão' },
      { id: 'b', nome: 'Bolão da Familia' },
    ];
    // "bolao" bate exato em "Bolão" — nao deve cair no especificidade
    const r = await escolherBolaoDaLista('bolao', opts);
    expect(r?.id).toBe('a');
  });

  it('quando nao ha match exato, prefere o mais especifico', async () => {
    const opts = [
      { id: 'a', nome: 'Sub-13' },
      { id: 'b', nome: 'Sub-13 dos cariocas' },
    ];
    // "13 dos" so bate por substring (em b); a nao bate de jeito nenhum
    const r = await escolherBolaoDaLista('13 dos', opts);
    expect(r?.id).toBe('b');
  });
});

describe('interpretarSimNao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reconhece "sim" sem chamar LLM', async () => {
    expect(await interpretarSimNao('sim')).toBe('SIM');
    expect(await interpretarSimNao('SIM')).toBe('SIM');
    expect(await interpretarSimNao('claro')).toBe('SIM');
    expect(await interpretarSimNao('quero')).toBe('SIM');
    expect(chat).not.toHaveBeenCalled();
  });

  it('reconhece "nao" sem chamar LLM', async () => {
    expect(await interpretarSimNao('nao')).toBe('NAO');
    expect(await interpretarSimNao('não')).toBe('NAO');
    expect(await interpretarSimNao('deixa pra la')).toBe('NAO');
    expect(chat).not.toHaveBeenCalled();
  });

  it('cai pro LLM em frase ambigua', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"resposta":"SIM","confianca":0.9}');
    const r = await interpretarSimNao('bora ver entao essa parada toda');
    expect(r).toBe('SIM');
    expect(chat).toHaveBeenCalled();
  });

  it('retorna null quando LLM nao tem certeza', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"resposta":"AMBIGUO","confianca":0.9}');
    const r = await interpretarSimNao('sei la');
    expect(r).toBeNull();
  });

  it('retorna null quando LLM tem baixa confianca', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"resposta":"SIM","confianca":0.3}');
    const r = await interpretarSimNao('hmm');
    expect(r).toBeNull();
  });
});
