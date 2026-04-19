import { env } from '../config/env.js';

interface SendTextInput {
  to: string; // wa_id, apenas digitos (ex: "5511999999999")
  text: string;
}

interface SendImageInput {
  to: string;
  imageUrl: string; // URL publica acessivel pela Meta
  caption?: string;
}

interface SendImageByIdInput {
  to: string;
  mediaId: string;
  caption?: string;
}

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

export async function sendText({ to, text }: SendTextInput) {
  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  });
}

export async function sendImage({ to, imageUrl, caption }: SendImageInput) {
  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { link: imageUrl, caption: caption ?? '' },
  });
}

export async function sendImageById({ to, mediaId, caption }: SendImageByIdInput) {
  return metaFetch('/messages', {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'image',
    image: { id: mediaId, caption: caption ?? '' },
  });
}

/**
 * Marca uma mensagem recebida como lida. Melhora UX (mostra o "lido").
 */
export async function markAsRead(messageId: string) {
  try {
    await metaFetch('/messages', {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    });
  } catch (error) {
    // nao falhar o fluxo por falta do read receipt
    console.warn('⚠️  Falha ao marcar como lida:', (error as Error).message);
  }
}

/**
 * Faz upload de uma imagem como media da conta e retorna o media_id.
 * Util pra enviar PNG gerado pelo sharp (cards de ranking/resultados)
 * sem precisar expor URL publica.
 */
export async function uploadMedia(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
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
