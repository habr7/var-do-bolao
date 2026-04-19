import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { validateMetaSignature } from './signature.js';
import { markAsRead } from './meta.client.js';
import { handleIncomingMessage } from './command.router.js';

// ============================================================
// GET — Handshake de verificacao do webhook
// ============================================================
// Meta envia uma GET com hub.verify_token; devolvemos hub.challenge em texto
// puro caso bata com o WHATSAPP_VERIFY_TOKEN.
export async function webhookVerifyHandler(
  request: FastifyRequest<{
    Querystring: {
      'hub.mode'?: string;
      'hub.verify_token'?: string;
      'hub.challenge'?: string;
    };
  }>,
  reply: FastifyReply,
) {
  const mode = request.query['hub.mode'];
  const token = request.query['hub.verify_token'];
  const challenge = request.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    reply.code(200).type('text/plain').send(challenge);
    return;
  }

  reply.code(403).send({ error: 'verify_token mismatch' });
}

// ============================================================
// POST — Eventos de mensagem
// ============================================================
interface MetaMessageEvent {
  object: string;
  entry?: Array<{
    id: string;
    changes?: Array<{
      field: string;
      value: {
        messaging_product: string;
        metadata?: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
        messages?: Array<{
          from: string;
          id: string;
          timestamp: string;
          type: string;
          text?: { body: string };
          button?: { text: string; payload: string };
          interactive?: {
            type: string;
            button_reply?: { id: string; title: string };
            list_reply?: { id: string; title: string };
          };
        }>;
        statuses?: Array<unknown>;
      };
    }>;
  }>;
}

export async function webhookMessageHandler(
  request: FastifyRequest<{ Body: MetaMessageEvent }>,
  reply: FastifyReply,
) {
  // Valida assinatura (raw body precisa estar disponivel em request.rawBody — configurar no content-type parser)
  const rawBody = (request as unknown as { rawBody?: string }).rawBody ?? JSON.stringify(request.body);
  const signature = request.headers['x-hub-signature-256'] as string | undefined;

  if (env.NODE_ENV !== 'development' && !validateMetaSignature(rawBody, signature)) {
    // Em producao, sempre retorna 200 mas nao processa — evita sinalizar pro atacante
    request.log.warn('Assinatura invalida no webhook WhatsApp');
    reply.code(200).send({ ok: true });
    return;
  }

  const body = request.body;

  if (body.object !== 'whatsapp_business_account') {
    reply.code(200).send({ ok: true });
    return;
  }

  // Responde 200 imediatamente (Meta espera ack rapido)
  reply.code(200).send({ ok: true });

  // Processa assincrono apos responder
  try {
    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        const contacts = value.contacts ?? [];
        const messages = value.messages ?? [];

        for (const msg of messages) {
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const senderName = contact?.profile?.name ?? 'Usuario';

          // Extrai texto segundo o tipo
          const text = extractText(msg);
          if (!text) continue;

          // Marca como lida (best effort)
          markAsRead(msg.id).catch(() => undefined);

          await handleIncomingMessage({
            waId: msg.from,
            messageId: msg.id,
            senderName,
            text,
          });
        }
      }
    }
  } catch (error) {
    request.log.error({ err: error }, 'Erro processando webhook Meta');
  }
}

function extractText(msg: NonNullable<NonNullable<NonNullable<MetaMessageEvent['entry']>[0]['changes']>[0]['value']['messages']>[0]): string | null {
  if (msg.type === 'text' && msg.text) return msg.text.body;
  if (msg.type === 'button' && msg.button) return msg.button.text;
  if (msg.type === 'interactive') {
    if (msg.interactive?.type === 'button_reply') return msg.interactive.button_reply?.title ?? null;
    if (msg.interactive?.type === 'list_reply') return msg.interactive.list_reply?.title ?? null;
  }
  return null;
}
