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
      // Campos auxiliares do Baileys: quando remoteJid eh @lid (LinkedID
      // de remetente nao-contato), estes carregam o numero real:
      participant?: string;       // formato @s.whatsapp.net (group ou 1on1 com LID)
      participantPn?: string;     // numero real linkado ao participant LID
      senderPn?: string;          // 1on1 com LID: numero real do remetente
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
    // ====== LOG DIAGNOSTICO (temporario) ======
    console.log(
      `[webhook-debug] event=${body.event ?? '(none)'}`,
      `instance=${body.instance ?? '(none)'}`,
      `dataKeys=${body.data ? Object.keys(body.data).join(',') : '(no data)'}`,
      `keyKeys=${body.data?.key ? Object.keys(body.data.key).join(',') : '(no key)'}`,
      `remoteJid=${body.data?.key?.remoteJid ?? '(none)'}`,
      `fromMe=${body.data?.key?.fromMe ?? '(none)'}`,
      `messageKeys=${body.data?.message ? Object.keys(body.data.message).join(',') : '(no message)'}`,
    );
    // ============================================

    // Aceita "messages.upsert" (formato Evolution padrao) e tambem
    // "MESSAGES_UPSERT" (variacao uppercase usada por algumas builds v2.x).
    const eventNorm = (body.event ?? '').toLowerCase().replace(/_/g, '.');
    if (eventNorm !== 'messages.upsert') return;

    if (env.EVOLUTION_INSTANCE && body.instance && body.instance !== env.EVOLUTION_INSTANCE) {
      return; // outra instancia, ignora
    }

    const data = body.data;
    if (!data?.key) return;
    if (data.key.fromMe) return; // mensagens enviadas pelo proprio bot

    const remoteJid = data.key.remoteJid ?? '';
    if (remoteJid.endsWith('@g.us')) return; // ignora grupos — sistema eh DM-only

    // Aceita @s.whatsapp.net (jid de numero normal) ou @lid (LinkedID, novo
    // formato do WhatsApp usado quando o remetente nao eh contato salvo do
    // bot — privacy feature). Recusa qualquer outro sufixo (broadcast, etc).
    if (!remoteJid.endsWith('@s.whatsapp.net') && !remoteJid.endsWith('@lid')) return;

    // Valida prefixo numerico (digits antes do @). @lid pode ter ate 20 digitos.
    const prefixo = remoteJid.replace(/@(s\.whatsapp\.net|lid)$/, '');
    if (!/^\d{8,20}$/.test(prefixo)) return;

    // Quando remoteJid eh @lid, Evolution v1.8.x retorna 400 ao tentar
    // sendText (LID nao eh um numero real). Tentamos resolver pra PN
    // real via campos auxiliares do Baileys.
    let waId = remoteJid;
    if (remoteJid.endsWith('@lid')) {
      const pnCandidato =
        data.key.senderPn ?? data.key.participantPn ?? data.key.participant ?? null;
      if (pnCandidato && /^\d+@s\.whatsapp\.net$/.test(pnCandidato)) {
        waId = pnCandidato;
        console.log(`[webhook] @lid resolvido para PN real: ${pnCandidato}`);
      } else {
        // Log de diagnostico — ajuda achar onde o PN real esta no payload
        console.warn(
          '[webhook] mensagem de @lid sem PN resolvivel. Payload key:',
          JSON.stringify(data.key),
          '— pulando processamento (bot nao consegue responder).',
        );
        return;
      }
    }

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
