import { env } from '../config/env.js';
import { chat as chatOllama, tryParseJson as tryParseJsonOllama } from './ollama.client.js';
import { chatGemini, type ChatMessage, type ChatOptions } from './gemini.client.js';

/**
 * Router de LLM: tenta o provedor configurado primeiro, com fallback
 * automatico pro outro em caso de falha.
 *
 * Ordem de tentativas:
 *   LLM_PROVIDER=gemini   -> gemini -> ollama (se gemini retornar null)
 *   LLM_PROVIDER=ollama   -> ollama -> nada
 *   LLM_PROVIDER=auto:
 *     - se GEMINI_API_KEY setada: gemini -> ollama
 *     - senao: ollama direto
 *
 * Mesma assinatura/retorno do ollama.client.ts:chat — os callers
 * (intent.classifier, palpite.extractor, bolao.matcher) nao precisam saber
 * qual provedor esta sendo usado.
 */

export type { ChatMessage, ChatOptions };

function pickProvider(): 'gemini' | 'ollama' {
  if (env.LLM_PROVIDER === 'gemini') return 'gemini';
  if (env.LLM_PROVIDER === 'ollama') return 'ollama';
  // auto: gemini se tiver API key, senao ollama
  return env.GEMINI_API_KEY ? 'gemini' : 'ollama';
}

export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string | null> {
  const primary = pickProvider();

  if (primary === 'gemini') {
    const out = await chatGemini(messages, opts);
    if (out !== null) return out;
    // fallback Ollama (silencioso se nao configurado)
    return await chatOllama(messages, opts);
  }

  return await chatOllama(messages, opts);
}

// Re-export tryParseJson pra callers continuarem importando daqui
export const tryParseJson = tryParseJsonOllama;
