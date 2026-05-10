import { env } from '../config/env.js';

/**
 * Cliente HTTP para a Evolution API v2.
 *
 * Endpoints usados:
 *   POST {base}/message/sendText/{instance}   — texto puro
 *   POST {base}/message/sendMedia/{instance}  — imagem por URL ou base64
 *   POST {base}/chat/markMessageAsRead/{instance}
 *
 * Auth: header `apikey: {EVOLUTION_API_KEY}`.
 *
 * Em modo DRY_RUN_WHATSAPP=true, NAO faz HTTP — captura em memoria
 * para o REPL/sim e para os testes unitarios.
 */

interface SendTextInput {
  to: string; // somente digitos, ex: "5511999999999"
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
// Dry-run — captura em memoria, sem HTTP
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

export function setCaptureListener(listener: ((msg: CapturedMessage) => void) | null): void {
  onCapture = listener;
}

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
      /* listener nao deve interromper o fluxo */
    }
  }
}

// ============================================================
// HTTP real
// ============================================================
function evoUrl(path: string): string {
  // path comeca com "/", base nao termina com "/"
  const base = env.EVOLUTION_API_URL.replace(/\/+$/, '');
  return `${base}${path}`;
}

async function evoFetch(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(evoUrl(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.EVOLUTION_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`❌ Erro Evolution API (${response.status}):`, errorBody);
    throw new Error(`Evolution API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// API publica
// ============================================================
export async function sendText({ to, text }: SendTextInput) {
  if (env.DRY_RUN_WHATSAPP) {
    capture({ to, text, at: new Date() });
    return { dryRun: true };
  }

  return evoFetch(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
    number: to,
    text,
  });
}

export async function sendImage({ to, imageUrl, caption }: SendImageInput) {
  if (env.DRY_RUN_WHATSAPP) {
    capture({ to, imageUrl, caption, at: new Date() });
    return { dryRun: true };
  }

  return evoFetch(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
    number: to,
    mediatype: 'image',
    media: imageUrl,
    caption: caption ?? '',
  });
}

/**
 * Mantido por compatibilidade com a API antiga. Na Evolution nao ha o
 * conceito de "media_id pre-uploaded" como na Meta — sempre envia URL ou
 * base64. Aqui tratamos `mediaId` como URL.
 */
export async function sendImageById({ to, mediaId, caption }: SendImageByIdInput) {
  return sendImage({ to, imageUrl: mediaId, caption });
}

export async function markAsRead(messageId: string, remoteJid?: string) {
  if (env.DRY_RUN_WHATSAPP) return { dryRun: true };

  // Evolution exige `readMessages: [{ remoteJid, fromMe, id }]`.
  // Se o caller nao passar remoteJid, usamos best-effort vazio (vai falhar
  // silenciosamente — markAsRead nao eh critico).
  if (!remoteJid) return;

  try {
    await evoFetch(`/chat/markMessageAsRead/${env.EVOLUTION_INSTANCE}`, {
      readMessages: [{ remoteJid, fromMe: false, id: messageId }],
    });
  } catch (error) {
    console.warn('⚠️  Falha ao marcar como lida:', (error as Error).message);
  }
}

/**
 * Upload de mídia. Na Evolution v2 normalmente envia-se a URL diretamente
 * em sendMedia. Esta funcao fica como stub para compatibilidade — retorna
 * a propria URL (caller deve passar URL publica, nao buffer).
 */
export async function uploadMedia(_buffer: Buffer, _filename: string, _mimeType: string): Promise<string> {
  if (env.DRY_RUN_WHATSAPP) {
    return `dry-run-media-${Date.now()}`;
  }
  throw new Error('uploadMedia: para Evolution API, use sendImage com URL publica diretamente.');
}
