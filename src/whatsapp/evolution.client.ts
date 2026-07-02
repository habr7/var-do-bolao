import { env } from '../config/env.js';
import { resolverRotaEnvio } from '../messaging/channel-router.js';
import { tgSendText, tgSendPhoto } from '../messaging/telegram.client.js';

/**
 * Cliente HTTP para a Evolution API v2.x (evoapicloud/evolution-api).
 *
 * MULTI-CANAL (v3.59.0): este módulo continua sendo o ÚNICO ponto de envio
 * do bot (324+ callsites importam sendText daqui), mas agora ele ROTEIA por
 * destinatário: WhatsApp (Evolution, comportamento atual) ou Telegram
 * (Bot API), decidido pelo channel-router. Com ENABLE_TELEGRAM=false
 * (default) NADA muda — todo envio segue pra Evolution como sempre.
 * O capture de dry-run acontece ANTES do roteamento (simulador e testes
 * continuam enxergando toda mensagem, independente de canal).
 *
 * Endpoints usados:
 *   POST {base}/message/sendText/{instance}   — texto, body { number, text }
 *   POST {base}/message/sendMedia/{instance}  — imagem, body { number, mediatype, media, caption }
 *   POST {base}/chat/markMessageAsRead/{instance} — marca lida (best-effort)
 *
 * Auth: header `apikey: {EVOLUTION_API_KEY}`.
 *
 * Em modo DRY_RUN_WHATSAPP=true, NAO faz HTTP — captura em memoria
 * para o REPL/sim e para os testes unitarios.
 *
 * Nota sobre formato `to`: aceita string opaca — pode ser digits puros
 * ("5511999999999"), jid completo ("5511...@s.whatsapp.net") ou
 * LinkedID ("198...@lid"). Baileys/Evolution normaliza.
 *
 * Se voltar pra Evolution v1.8.x: usar formato comentado em cada metodo
 * abaixo (envelopa em textMessage/mediaMessage; markAsRead vira no-op).
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

  // Multi-canal: decide WhatsApp × Telegram por destinatário (v3.59.0).
  const rota = await resolverRotaEnvio(to);
  if (rota.canal === 'telegram') {
    await tgSendText(rota.chatId, text);
    return { telegram: true };
  }
  if (rota.canal === 'drop') {
    console.warn(`[sendText] mensagem descartada: ${rota.motivo}`);
    return { dropped: true };
  }

  // Formato Evolution v2.x (evoapicloud/evolution-api:latest)
  return evoFetch(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
    number: to,
    text,
  });

  // FALLBACK v1.8.x — descomentar (e comentar acima) se voltar pra v1:
  // return evoFetch(`/message/sendText/${env.EVOLUTION_INSTANCE}`, {
  //   number: to,
  //   textMessage: { text },
  // });
}

export async function sendImage({ to, imageUrl, caption }: SendImageInput) {
  if (env.DRY_RUN_WHATSAPP) {
    capture({ to, imageUrl, caption, at: new Date() });
    return { dryRun: true };
  }

  // Multi-canal: decide WhatsApp × Telegram por destinatário (v3.59.0).
  const rota = await resolverRotaEnvio(to);
  if (rota.canal === 'telegram') {
    await tgSendPhoto(rota.chatId, imageUrl, caption);
    return { telegram: true };
  }
  if (rota.canal === 'drop') {
    console.warn(`[sendImage] mensagem descartada: ${rota.motivo}`);
    return { dropped: true };
  }

  // Formato Evolution v2.x (evoapicloud/evolution-api:latest)
  return evoFetch(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
    number: to,
    mediatype: 'image',
    media: imageUrl,
    caption: caption ?? '',
  });

  // FALLBACK v1.8.x — descomentar (e comentar acima) se voltar pra v1:
  // return evoFetch(`/message/sendMedia/${env.EVOLUTION_INSTANCE}`, {
  //   number: to,
  //   mediaMessage: {
  //     mediatype: 'image',
  //     media: imageUrl,
  //     caption: caption ?? '',
  //   },
  // });
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
  if (!remoteJid) return;
  if (remoteJid.startsWith('tg:')) return; // Telegram não tem markAsRead — no-op

  // Evolution v2.x expoe /chat/markMessageAsRead/{instance}.
  // (v1.8.x retornava 404 — se voltar pra v1, virar no-op.)
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
