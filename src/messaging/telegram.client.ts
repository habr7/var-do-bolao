import { env } from '../config/env.js';
import {
  whatsappParaTelegramHtml,
  htmlParaTextoPuro,
  quebrarMensagemLonga,
} from './telegram.format.js';

/**
 * Cliente HTTP para a Telegram Bot API (https://core.telegram.org/bots/api).
 *
 * Métodos usados:
 *   POST /bot{token}/sendMessage     — texto (parse_mode=HTML)
 *   POST /bot{token}/sendPhoto      — imagem por URL
 *   POST /bot{token}/sendChatAction — indicador "digitando…" (best-effort)
 *   POST /bot{token}/getUpdates     — long polling (transporte polling)
 *   POST /bot{token}/setWebhook     — registra webhook (transporte webhook)
 *   POST /bot{token}/deleteWebhook  — remove webhook (necessário pro polling)
 *   POST /bot{token}/getMe          — sanity-check do token no boot
 *
 * Diferenças pro WhatsApp tratadas AQUI (o resto do bot não sabe que o
 * Telegram existe):
 *   - Formatação: dialeto WhatsApp → HTML (telegram.format.ts), com
 *     fallback pra texto puro se o Telegram rejeitar o HTML (nunca cala).
 *   - Limite 4096 chars/mensagem: quebra automática em partes.
 *   - Rate limit (429): respeita retry_after uma vez e re-tenta.
 *
 * Em DRY_RUN_WHATSAPP=true NÃO faz HTTP — o fluxo nem chega aqui (o
 * capture do dry-run acontece antes, no messaging/dispatcher), mas o
 * guard existe por segurança (testes que importem direto).
 */

// ============================================================
// Tipos mínimos da Bot API (só o que o bot usa)
// ============================================================
export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  first_name?: string;
  last_name?: string;
  username?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  // Tipos de mídia detectados pra resposta amigável (paridade com o
  // comportamento do WhatsApp — v3.15.0)
  photo?: unknown;
  audio?: unknown;
  voice?: unknown;
  video?: unknown;
  sticker?: unknown;
  document?: unknown;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

// ============================================================
// HTTP base
// ============================================================
function tgUrl(method: string): string {
  return `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`;
}

class TelegramApiError extends Error {
  constructor(
    public readonly method: string,
    public readonly errorCode: number | undefined,
    public readonly description: string | undefined,
    public readonly retryAfter?: number,
  ) {
    super(`Telegram API error em ${method}: [${errorCode ?? '?'}] ${description ?? 'sem descricao'}`);
  }
}

async function tgFetch<T>(
  method: string,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);
  try {
    const response = await fetch(tgUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await response.json()) as TelegramApiResponse<T>;
    if (!data.ok) {
      throw new TelegramApiError(method, data.error_code, data.description, data.parameters?.retry_after);
    }
    return data.result as T;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * fetch com 1 retry automático em 429 (rate limit), respeitando o
 * retry_after do Telegram (cap de 10s pra não travar o worker).
 */
async function tgFetchComRetry<T>(
  method: string,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await tgFetch<T>(method, body, opts);
  } catch (error) {
    if (error instanceof TelegramApiError && error.errorCode === 429) {
      const waitS = Math.min(error.retryAfter ?? 1, 10);
      console.warn(`[telegram] 429 em ${method} — aguardando ${waitS}s e re-tentando`);
      await new Promise((r) => setTimeout(r, waitS * 1000));
      return tgFetch<T>(method, body, opts);
    }
    throw error;
  }
}

// ============================================================
// API pública — envio
// ============================================================

/**
 * Envia texto pra um chat do Telegram. Recebe o texto no DIALETO DO
 * WHATSAPP (como todo o bot produz) e converte pra HTML aqui.
 *
 * - Mensagem > 4096 chars: quebrada em partes (enviadas em ordem).
 * - HTML rejeitado (400): re-envia como texto puro (fallback, nunca cala).
 */
export async function tgSendText(chatId: string | number, textoWhatsApp: string): Promise<void> {
  if (env.DRY_RUN_WHATSAPP) return; // guard extra; dry-run captura antes de chegar aqui

  const html = whatsappParaTelegramHtml(textoWhatsApp);
  const partes = quebrarMensagemLonga(html);

  for (const parte of partes) {
    try {
      await tgFetchComRetry('sendMessage', {
        chat_id: chatId,
        text: parte,
        parse_mode: 'HTML',
        // Links de convite/FIFA no meio do texto não devem virar preview gigante
        link_preview_options: { is_disabled: true },
      });
    } catch (error) {
      if (error instanceof TelegramApiError && error.errorCode === 400) {
        // HTML inválido pro Telegram (caso raro que o conversor não cobriu):
        // manda sem formatação — melhor sem negrito do que sem resposta.
        console.warn(`[telegram] HTML rejeitado (${error.description}) — fallback texto puro`);
        await tgFetchComRetry('sendMessage', {
          chat_id: chatId,
          text: htmlParaTextoPuro(parte),
          link_preview_options: { is_disabled: true },
        });
      } else {
        throw error;
      }
    }
  }
}

/** Envia imagem por URL pública, com legenda opcional (dialeto WhatsApp). */
export async function tgSendPhoto(
  chatId: string | number,
  photoUrl: string,
  caption?: string,
): Promise<void> {
  if (env.DRY_RUN_WHATSAPP) return;
  await tgFetchComRetry('sendPhoto', {
    chat_id: chatId,
    photo: photoUrl,
    ...(caption
      ? { caption: whatsappParaTelegramHtml(caption).slice(0, 1024), parse_mode: 'HTML' }
      : {}),
  });
}

/** Indicador "digitando…" (best-effort — nunca falha o fluxo). */
export async function tgSendTyping(chatId: string | number): Promise<void> {
  if (env.DRY_RUN_WHATSAPP) return;
  try {
    await tgFetch('sendChatAction', { chat_id: chatId, action: 'typing' }, { timeoutMs: 5_000 });
  } catch {
    /* cosmético — ignora */
  }
}

// ============================================================
// API pública — transporte
// ============================================================

/**
 * Long polling: segura a conexão até `timeoutS` esperando updates novos.
 * UMA chamada cobre TODAS as conversas do bot (o Telegram devolve o lote).
 */
export async function tgGetUpdates(offset: number, timeoutS = 50): Promise<TelegramUpdate[]> {
  return tgFetch<TelegramUpdate[]>(
    'getUpdates',
    {
      offset,
      timeout: timeoutS,
      allowed_updates: ['message'],
    },
    // timeout HTTP > timeout do long poll (senão aborta antes do Telegram responder)
    { timeoutMs: (timeoutS + 15) * 1000 },
  );
}

/** Registra o webhook (modo webhook). O secret é validado no handler. */
export async function tgSetWebhook(url: string, secretToken: string): Promise<void> {
  await tgFetch('setWebhook', {
    url,
    secret_token: secretToken || undefined,
    allowed_updates: ['message'],
    drop_pending_updates: false,
  });
}

/** Remove o webhook — OBRIGATÓRIO antes de usar getUpdates (são exclusivos). */
export async function tgDeleteWebhook(): Promise<void> {
  await tgFetch('deleteWebhook', { drop_pending_updates: false });
}

/** Sanity-check do token no boot. Devolve o user do bot (id/username). */
export async function tgGetMe(): Promise<TelegramUser> {
  return tgFetch<TelegramUser>('getMe', {});
}
