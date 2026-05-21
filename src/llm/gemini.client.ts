import { env } from '../config/env.js';

/**
 * Cliente HTTP fino pro Google Gemini (Generative Language API v1beta).
 *
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={KEY}
 *
 * A interface (`chat(messages, opts)`) eh identica ao ollama.client.ts
 * pra que o router em llm.client.ts possa trocar provedor sem afetar
 * os callers (intent.classifier, palpite.extractor, bolao.matcher).
 *
 * Conversao OpenAI -> Gemini:
 *   - mensagens com role 'system' viram `systemInstruction` (separado)
 *   - role 'user' -> 'user', role 'assistant' -> 'model'
 *   - content (string) -> parts: [{ text }]
 *
 * JSON estruturado: usa `generationConfig.responseMimeType: 'application/json'`
 * (suportado pelo gemini-2.5-flash, gemini-2.5-pro e variants).
 *
 * Retorna `string | null` (a mesma do Ollama) — null em qualquer falha
 * pra que o caller decida o fallback.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
    responseMimeType?: string;
    // Disponivel a partir do gemini-2.5: controla o budget de thinking.
    // thinkingBudget=0 desabilita thinking (resposta mais rapida, menos
    // tokens consumidos antes do JSON sair).
    thinkingConfig?: { thinkingBudget: number };
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string };
}

function toGeminiPayload(messages: ChatMessage[], opts: ChatOptions): GeminiRequest {
  const systemTexts: string[] = [];
  const contents: GeminiContent[] = [];

  for (const m of messages) {
    if (m.role === 'system') {
      systemTexts.push(m.content);
    } else {
      contents.push({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      });
    }
  }

  const body: GeminiRequest = { contents };
  if (systemTexts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
  }
  const gc: NonNullable<GeminiRequest['generationConfig']> = {
    temperature: opts.temperature ?? 0.3,
    maxOutputTokens: opts.maxTokens ?? 1024,
    // Desabilita thinking SEMPRE (nao so em JSON). Pras tarefas do bot
    // — classificacao, extracao, resposta curta — thinking nao agrega
    // qualidade e adiciona ~1s de latencia + consumo de tokens. Se um
    // dia precisarmos de raciocinio (ex: pergunta longa de futebol),
    // criamos um opt-in explicito.
    thinkingConfig: { thinkingBudget: 0 },
  };
  if (opts.json) {
    gc.responseMimeType = 'application/json';
  }
  body.generationConfig = gc;
  return body;
}

/**
 * Status HTTP retryable: 503 (model overloaded) e 429 (rate limit). Gemini
 * frequentemente retorna 503 quando o modelo flash-lite esta com pico de
 * demanda, e melhora em poucos segundos. 408 (timeout do server) tambem
 * vale a pena tentar.
 */
const STATUS_RETRYABLE = new Set([408, 429, 503]);
const MAX_RETRIES = 2; // 1 tentativa + 2 retries = ate 3 chamadas
const BACKOFF_MS = [400, 1200]; // backoff exponencial leve entre retries

/**
 * Uma chamada unica ao Gemini, sem retry. Usado como bloco basico de
 * `chatGemini` (que envolve com retry pra 503/429).
 */
async function chatGeminiSingle(
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<{ text: string | null; retryable: boolean }> {
  const timeoutMs = opts.timeoutMs ?? env.LLM_TIMEOUT_MS;
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}` +
    `:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  try {
    const body = toGeminiPayload(messages, opts);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const latency = Date.now() - t0;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const retryable = STATUS_RETRYABLE.has(response.status);
      console.warn(
        `[llm] gemini HTTP ${response.status} (${latency}ms)${retryable ? ' [retryable]' : ''}: ${errText.slice(0, 200)}`,
      );
      return { text: null, retryable };
    }

    const data = (await response.json()) as GeminiResponse;

    if (data.error) {
      console.warn(`[llm] gemini error: ${data.error.message ?? 'unknown'}`);
      return { text: null, retryable: false };
    }

    if (data.promptFeedback?.blockReason) {
      console.warn(`[llm] gemini bloqueado: ${data.promptFeedback.blockReason}`);
      return { text: null, retryable: false };
    }

    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? null;

    if (text) {
      console.log(`[llm] provider=gemini model=${env.GEMINI_MODEL} latency=${latency}ms ok`);
    }
    return { text: text?.trim() ?? null, retryable: false };
  } catch (error) {
    const err = error as { name?: string; message?: string };
    if (err.name === 'AbortError') {
      console.warn(`[llm] gemini timeout apos ${timeoutMs}ms [retryable]`);
      return { text: null, retryable: true }; // timeout vale a pena tentar de novo
    }
    console.warn('[llm] gemini erro:', err.message ?? String(err));
    return { text: null, retryable: false };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Chat com Gemini, com retry automatico em 503/429/timeout.
 *
 * Gemini 2.5 Flash Lite frequentemente retorna HTTP 503 ("This model is
 * currently experiencing high demand") em picos do Google. O retry resolve
 * em 90% dos casos com 1-2 tentativas extras (latencia adicional ~400ms-1.5s).
 *
 * Quando todos os retries falham, retorna null pro caller usar o fallback
 * (Ollama ou mensagem amigavel pro usuario).
 */
export async function chatGemini(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<string | null> {
  if (!env.LLM_ENABLED) {
    // Visivel pra diagnostico — sem isso ficava silencioso e dificultava
    // identificar quando o LLM estava desligado por env.
    console.warn('[llm] gemini SKIP — LLM_ENABLED=false');
    return null;
  }
  if (!env.GEMINI_API_KEY) {
    console.warn('[llm] gemini SKIP — GEMINI_API_KEY vazia');
    return null;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const wait = BACKOFF_MS[attempt - 1] ?? 1500;
      console.log(`[llm] gemini retry #${attempt} apos ${wait}ms backoff...`);
      await new Promise((r) => setTimeout(r, wait));
    }
    const result = await chatGeminiSingle(messages, opts);
    if (result.text !== null) return result.text;
    if (!result.retryable) return null; // erro nao-retryable: para imediato
  }

  // Esgotou retries
  console.warn(`[llm] gemini desistiu apos ${MAX_RETRIES + 1} tentativas`);
  return null;
}
