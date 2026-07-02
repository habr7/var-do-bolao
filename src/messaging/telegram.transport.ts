import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../config/env.js';
import { processarUpdateTelegram } from './telegram.inbound.js';
import {
  tgDeleteWebhook,
  tgGetMe,
  tgGetUpdates,
  tgSetWebhook,
  type TelegramUpdate,
} from './telegram.client.js';

/**
 * Transporte do Telegram — DOIS modos, escolhidos por TELEGRAM_MODE:
 *
 *   "polling" (default): loop de long polling (getUpdates). O bot pergunta
 *     ao Telegram por mensagens novas segurando a conexão ~50s; a resposta
 *     chega em LOTE com as mensagens de TODAS as conversas de uma vez
 *     (1 loop pro bot inteiro, não 1 por conversa). Zero infra pública —
 *     funciona atrás de NAT/firewall, igual à Evolution conectada.
 *
 *   "webhook": o Telegram faz POST em {APP_URL}/webhook/telegram (push
 *     instantâneo). Exige APP_URL público com HTTPS válido. Validação por
 *     header secreto (X-Telegram-Bot-Api-Secret-Token).
 *
 * Os dois modos entregam os updates pro MESMO processarUpdateTelegram —
 * trocar de modo é só mudar a env e recriar o container.
 */

// ============================================================
// Polling
// ============================================================
let pollingAtivo = false;

async function loopPolling(): Promise<void> {
  // getUpdates e webhook são mutuamente exclusivos — remove webhook antigo.
  try {
    await tgDeleteWebhook();
  } catch (error) {
    console.warn('[telegram] deleteWebhook falhou (seguindo):', (error as Error).message);
  }

  let offset = 0;
  let backoffMs = 1000;

  while (pollingAtivo) {
    try {
      const updates = await tgGetUpdates(offset);
      backoffMs = 1000; // sucesso → reseta backoff
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        // Processa em série (ordem de chegada); cada update tem try/catch próprio.
        await processarUpdateTelegram(update);
      }
    } catch (error) {
      if (!pollingAtivo) break;
      console.error(
        `[telegram] erro no polling (retry em ${Math.round(backoffMs / 1000)}s):`,
        (error as Error).message,
      );
      await new Promise((r) => setTimeout(r, backoffMs));
      backoffMs = Math.min(backoffMs * 2, 60_000); // backoff expo, cap 60s
    }
  }
  console.log('[telegram] polling encerrado.');
}

// ============================================================
// Webhook
// ============================================================
export function registrarWebhookTelegram(app: FastifyInstance): void {
  app.post('/webhook/telegram', async (request: FastifyRequest, reply: FastifyReply) => {
    // Valida o segredo (se configurado) — rejeita POST que não veio do Telegram.
    if (env.TELEGRAM_WEBHOOK_SECRET) {
      const secret = request.headers['x-telegram-bot-api-secret-token'];
      if (secret !== env.TELEGRAM_WEBHOOK_SECRET) {
        reply.code(401).send({ ok: false });
        return;
      }
    }

    // 200 imediato (mesmo padrão do webhook da Evolution) — o Telegram
    // re-entrega se não receber 200 rápido; o dedup por update_id segura.
    reply.code(200).send({ ok: true });

    const update = request.body as TelegramUpdate;
    if (update && typeof update.update_id === 'number') {
      void processarUpdateTelegram(update);
    }
  });
}

// ============================================================
// Boot / shutdown
// ============================================================

/**
 * Inicia o canal Telegram conforme TELEGRAM_MODE. Chamar DEPOIS do
 * app.listen (a rota do webhook é registrada antes, em buildApp).
 * Nunca lança: falha no boot do Telegram não pode derrubar o WhatsApp.
 */
export async function iniciarTelegram(): Promise<void> {
  if (!env.ENABLE_TELEGRAM) return;
  if (env.DRY_RUN_WHATSAPP) {
    console.log('[telegram] DRY_RUN ativo — canal Telegram não iniciado.');
    return;
  }

  try {
    const me = await tgGetMe();
    console.log(`[telegram] 🤖 conectado como @${me.username} (id ${me.id})`);

    if (env.TELEGRAM_MODE === 'webhook') {
      const url = `${env.APP_URL.replace(/\/+$/, '')}/webhook/telegram`;
      await tgSetWebhook(url, env.TELEGRAM_WEBHOOK_SECRET);
      console.log(`[telegram] 📨 webhook registrado: ${url}`);
    } else {
      pollingAtivo = true;
      void loopPolling();
      console.log('[telegram] 🔄 long polling iniciado (getUpdates).');
    }
  } catch (error) {
    console.error(
      '❌ [telegram] falha ao iniciar canal (verifique TELEGRAM_BOT_TOKEN):',
      (error as Error).message,
    );
  }
}

/** Encerra o polling no shutdown gracioso (SIGINT/SIGTERM). */
export function pararTelegram(): void {
  pollingAtivo = false;
}
