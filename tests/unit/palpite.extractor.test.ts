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

import { extrairPalpites } from '../../src/llm/palpite.extractor.js';
import { chat } from '../../src/llm/ollama.client.js';

const JOGOS = [
  { timeCasa: 'Brasil', timeVisitante: 'Marrocos' },
  { timeCasa: 'Argentina', timeVisitante: 'Argélia' },
];

describe('extrairPalpites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extrai palpite valido em linguagem natural', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      '{"palpites":[{"timeCasa":"Brasil","golsCasa":2,"timeVisitante":"Marrocos","golsVisitante":1}]}',
    );
    const result = await extrairPalpites('acho que o brasil ganha de 2 a 1', JOGOS);
    expect(result).toEqual([
      { timeCasa: 'Brasil', golsCasa: 2, timeVisitante: 'Marrocos', golsVisitante: 1 },
    ]);
  });

  it('extrai multiplos palpites', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      JSON.stringify({
        palpites: [
          { timeCasa: 'Brasil', golsCasa: 3, timeVisitante: 'Marrocos', golsVisitante: 0 },
          { timeCasa: 'Argentina', golsCasa: 1, timeVisitante: 'Argélia', golsVisitante: 1 },
        ],
      }),
    );
    const result = await extrairPalpites(
      'brasil 3x0 marrocos e argentina empata com a argelia 1x1',
      JOGOS,
    );
    expect(result).toHaveLength(2);
    expect(result[0].golsCasa).toBe(3);
    expect(result[1].timeCasa).toBe('Argentina');
  });

  it('retorna array vazio quando LLM nao consegue extrair', async () => {
    vi.mocked(chat).mockResolvedValueOnce('{"palpites":[]}');
    const result = await extrairPalpites('vai dar empate', JOGOS);
    expect(result).toEqual([]);
  });

  it('retorna array vazio quando LLM falha', async () => {
    vi.mocked(chat).mockResolvedValueOnce(null);
    const result = await extrairPalpites('algum texto', JOGOS);
    expect(result).toEqual([]);
  });

  it('filtra entradas invalidas (gols negativos, tipos errados)', async () => {
    vi.mocked(chat).mockResolvedValueOnce(
      JSON.stringify({
        palpites: [
          { timeCasa: 'Brasil', golsCasa: -1, timeVisitante: 'Marrocos', golsVisitante: 1 },
          { timeCasa: 'Argentina', golsCasa: 'dois', timeVisitante: 'Argélia', golsVisitante: 1 },
          { timeCasa: 'Brasil', golsCasa: 2, timeVisitante: 'Marrocos', golsVisitante: 0 },
        ],
      }),
    );
    const result = await extrairPalpites('texto qualquer', JOGOS);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      timeCasa: 'Brasil',
      golsCasa: 2,
      timeVisitante: 'Marrocos',
      golsVisitante: 0,
    });
  });

  it('retorna [] sem chamar LLM quando lista de jogos eh vazia', async () => {
    const result = await extrairPalpites('texto', []);
    expect(result).toEqual([]);
    expect(chat).not.toHaveBeenCalled();
  });
});
