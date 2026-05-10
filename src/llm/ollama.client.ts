import { env } from '../config/env.js';

/**
 * Cliente HTTP fino para a Ollama Cloud (https://ollama.com).
 *
 * Usa o endpoint OpenAI-compatible:
 *   POST {LLM_URL}/v1/chat/completions
 *   Authorization: Bearer {LLM_API_KEY}
 *
 * Tem timeout curto (default 5s) — se o LLM demorar, o bot continua
 * funcionando sem ele. Em prod isso significa que o usuario as vezes
 * recebe a resposta padrao "nao entendi" em vez da assistida — ok.
 *
 * Em dry-run / LLM_ENABLED=false, retorna `null` sem fazer HTTP.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatOptions {
  /** Forca resposta JSON (alguns modelos respeitam, outros nao). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Override do timeout default. */
  timeoutMs?: number;
}

/**
 * Chama o LLM e devolve a string da primeira choice. Em qualquer falha
 * (timeout, erro HTTP, LLM_ENABLED=false) devolve `null` — caller decide
 * o fallback.
 */
export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string | null> {
  if (!env.LLM_ENABLED) return null;
  if (!env.LLM_API_KEY || env.LLM_API_KEY === 'dry-run-llm-key') return null;

  const timeoutMs = opts.timeoutMs ?? env.LLM_TIMEOUT_MS;
  const url = env.LLM_URL.replace(/\/+$/, '') + '/v1/chat/completions';

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: Record<string, unknown> = {
      model: env.LLM_MODEL,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 512,
    };
    if (opts.json) {
      body.response_format = { type: 'json_object' };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.LLM_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.warn(`[llm] HTTP ${response.status}: ${errBody.slice(0, 200)}`);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'AbortError') {
      console.warn(`[llm] timeout apos ${timeoutMs}ms`);
    } else {
      console.warn('[llm] erro:', err.message ?? String(err));
    }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Helper que tenta parsear JSON da resposta do LLM. Funciona mesmo se o
 * modelo embrulhar em ```json ... ``` ou colocar texto extra antes/depois.
 */
export function tryParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;

  // Tenta parse direto
  try {
    return JSON.parse(raw) as T;
  } catch {
    /* fallthrough */
  }

  // Tenta extrair bloco entre ```json ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {
      /* fallthrough */
    }
  }

  // Tenta achar o primeiro { ... } balanceado
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as T;
    } catch {
      /* fallthrough */
    }
  }

  return null;
}
