import { env } from '../config/env.js';

interface SendTextInput {
  to: string; // wa_id, apenas digitos (ex: "5511999999999")
  text: string;
}

interface SendImageInput {
  to: string;
  imageUrl: string;
  caption?: string;
}

interface SendImageByIdInput {
  to: string;
  mediaId: string;
  caption?: string;
}

// ============================================================
// Dry-run mode — captura em memoria, sem HTTP
// ============================================================
export interface CapturedMessage {
  to: string;
  text?: string;
  imageUrl?: string;
  caption?: string;
  at: Date;
}

const captured: CapturedMessage[] = [];
let onCapture: ((msg: CapturedMessage) => void) | null = null;

/**
 * Registra uma callback chamada toda vez que o bot "enviaria" uma mensagem
 * em modo dry-run. Usado pelo REPL de simulacao.
 */
export function setCaptureListener(listener: ((msg: CapturedMessage) => void) | null): void {
  onCapture = listener;
}

/**
 * Retorna e limpa a fila de mensagens capturadas em dry-run.
 */
export function drainCapturedMessages(): CapturedMessage[] {
  const copy = captured.slice();
  captured.length = 0;
  return copy;
}

function capture(msg: CapturedMessage): void {
  captured.push(msg);
  if (onCapture) {
    try {
      onCapture(msg);
    } catch {
      /* listener nao deve interromper fluxo */
    }
  }
}

// ============================================================
// HTTP real
// ============================================================
function graphUrl(path: string): string {
  return `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}${path}`;
}

async function metaFetch(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(graphUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`❌ Erro Meta Cloud API (${response.status}):`, errorBody);
    throw new Error(`Meta Cloud API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// API publica — decide dry-run vs HTTP
// ============================================================
export async function sendText({ to, text }: SendTextInput) {
  if (env.DRY_RUN_META) {
    capture({ to, text, at: new Date() });
    return { dryRun: true };
  }

  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

export async function sendImage({ to, imageUrl, caption }: SendImageInput) {
  if (env.DRY_RUN_META) {
    capture({ to, imageUrl, caption, at: new Date() });
    return { dryRun: true };
  }

  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: imageUrl, caption: caption ?? '' },
  });
}

export async function sendImageById({ to, mediaId, caption }: SendImageByIdInput) {
  if (env.DRY_RUN_META) {
    capture({ to, caption, at: new Date() });
    return { dryRun: true };
  }

  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { id: mediaId, caption: caption ?? '' },
  });
}

export async function markAsRead(messageId: string) {
  if (env.DRY_RUN_META) return { dryRun: true };

  try {
    await metaFetch('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (error) {
    console.warn('⚠️  Falha ao marcar como lida:', (error as Error).message);
  }
}

export async function uploadMedia(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  if (env.DRY_RUN_META) {
    return `dry-run-media-${Date.now()}`;
  }

  const url = graphUrl('/media');

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([buffer], { type: mimeType }), filename);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Upload media falhou (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}
