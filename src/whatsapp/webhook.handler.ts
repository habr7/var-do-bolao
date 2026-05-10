import type { FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.js';
import { markAsRead } from './evolution.client.js';
import { handleIncomingMessage } from './command.router.js';

// ============================================================
// Webhook da Evolution API v2
// ============================================================
// A Evolution API faz POST {APP_URL}/webhook/whatsapp com payload do tipo:
//
// {
//   "event": "messages.upsert",
//   "instance": "varbolao",
//   "data": {
//     "key": {
//       "remoteJid": "5511999999999@s.whatsapp.net",   // ou ...@g.us para grupo
//       "fromMe": false,
//       "id": "ABCD1234..."
//     },
//     "pushName": "Humberto",
//     "message": {
//       "conversation": "oi"                                  // texto simples
//       // OU "extendedTextMessage": { "text": "oi" }         // texto com formatacao
//       // OU "imageMessage": { ... }                          // mídia (ignorado por enquanto)
//     },
//     "messageType": "conversation",
//     "messageTimestamp": 1700000000
//   }
// }
//
// A Evolution NAO assina HMAC; protegemos via:
//  - validacao de instance (so processa o nome configurado)
//  - opcional: token estatico no header (EVOLUTION_WEBHOOK_TOKEN)
//
// Em modo dev, o GET de teste retorna 200 ok.
// ============================================================

interface EvolutionWebhookEvent {
  event?: string;
  instance?: string;
  data?: {
    key?: {
      remoteJid?: string;
      fromMe?: boolean;
      id?: string;
    };
    pushName?: string;
    message?: {
      conversation?: string;
      extendedTextMessage?: { text?: string };
      buttonsResponseMessage?: { selectedButtonId?: string; selectedDisplayText?: string };
      listResponseMessage?: { singleSelectReply?: { selectedRowId?: string }; title?: string };
    };
    messageType?: string;
    messageTimestamp?: number;
  };
}

// GET /webhook/whatsapp — apenas resposta para healthcheck do painel.
// A Evolution NAO faz handshake como a Meta, mas alguns painéis chamam GET pra testar.
export async function webhookVerifyHandler(_request: FastifyRequest, reply: FastifyReply) {
  reply.code(200).send({ ok: true, provider: 'evolution-api' });
}

// POST /webhook/whatsapp — eventos da Evolution
export async function webhookMessageHandler(
  request: FastifyRequest<{ Body: EvolutionWebhookEvent }>,
  reply: FastifyReply,
) {
  // Token simples no header (opcional). Se EVOLUTION_WEBHOOK_TOKEN estiver
  // configurado, exige-se que o request traga o mesmo valor.
  if (env.NODE_ENV !== 'development' && env.EVOLUTION_WEBHOOK_TOKEN) {
    const incomingToken =
      (request.headers['x-evolution-token'] as string | undefined) ??
      (request.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '');

    if (incomingToken !== env.EVOLUTION_WEBHOOK_TOKEN) {
      request.log.warn('Token de webhook invalido');
      reply.code(200).send({ ok: true });
      return;
    }
  }

  const body = request.body;

  // Responde 200 imediatamente — qualquer processamento mais demorado
  // acontece depois. A Evolution faz retry se nao receber 200 rapido.
  reply.code(200).send({ ok: true });

  try {
    if (body.event !== 'messages.upsert') return;
    if (env.EVOLUTION_INSTANCE && body.instance && body.instance !== env.EVOLUTION_INSTANCE) {
      return; // outra instancia, ignora
    }

    const data = body.data;
    if (!data?.key) return;
    if (data.key.fromMe) return; // mensagens enviadas pelo proprio bot

    const remoteJid = data.key.remoteJid ?? '';
    if (remoteJid.endsWith('@g.us')) return; // ignora grupos — sistema eh DM-only
    if (!remoteJid.endsWith('@s.whatsapp.net')) return;

    const waId = remoteJid.replace(/@s\.whatsapp\.net$/, '');
    if (!/^\d{10,15}$/.test(waId)) return;

    const text = extractText(data.message);
    if (!text) return;

    const messageId = data.key.id ?? '';
    const senderName = data.pushName?.trim() || 'Craque';

    // Marca como lida (best-effort)
    if (messageId) {
      markAsRead(messageId, remoteJid).catch(() => undefined);
    }

    await handleIncomingMessage({
      waId,
      messageId,
      senderName,
      text,
    });
  } catch (error) {
    request.log.error({ err: error }, 'Erro processando webhook Evolution');
  }
}

type EvolutionMessageBody = NonNullable<NonNullable<EvolutionWebhookEvent['data']>['message']>;

function extractText(message: EvolutionMessageBody | undefined): string | null {
  if (!message) return null;
  if (message.conversation) return message.conversation.trim();
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text.trim();
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText.trim();
  if (message.listResponseMessage?.title) return message.listResponseMessage.title.trim();
  return null;
}
