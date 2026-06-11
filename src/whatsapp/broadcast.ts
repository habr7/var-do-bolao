import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { sendText } from './evolution.client.js';
import { notificarEmMassaThrottled } from '../modules/notificacao/notificacao.service.js';

/**
 * v3.26.0 — Broadcast administrativo.
 *
 * O dono do bot manda uma mensagem no WhatsApp começando com o marcador
 * `#ENVIOPARAVARDOBOLAO#` e o texto seguinte é enviado pra todos os
 * usuários (ou, em modo teste, só pro próprio dono).
 *
 * Segurança / robustez (revisado):
 *   - Só número(s) dono(s) (env OWNER_WHATSAPP_IDS) disparam. Comparação
 *     por DÍGITOS (o waId chega como JID `…@s.whatsapp.net` em produção e
 *     como dígitos no simulador).
 *   - Não-dono com o marcador → NÃO intercepta (segue fluxo normal, não
 *     revela o comando).
 *   - Idempotência atômica por messageId (SET NX) — evita duplo disparo em
 *     redelivery do webhook. Lock global (SET NX) evita 2 broadcasts juntos.
 *   - Envio aos `whatsappId` CRUS (JID/@lid) com throttle; dedup no valor cru.
 *   - Bypassa o cap MAX_AVISOS_DIA (é mensagem admin, não pode ser silenciada).
 *
 * ⚠️ Em produção, antes de BROADCAST_TEST_MODE=false, garantir
 * EVOLUTION_WEBHOOK_TOKEN setado — senão um POST forjado no webhook poderia
 * disparar broadcast pra todos.
 */

const LIMITE_CHARS = 4096;

export function soDigitos(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

/** Lista de donos normalizada (só dígitos, descarta entradas curtas/vazias). */
export function listaDonos(raw: string): string[] {
  return (raw ?? '')
    .split(',')
    .map(soDigitos)
    .filter((d) => d.length >= 8);
}

export function ehDono(waId: string, donosRaw: string): boolean {
  const d = soDigitos(waId);
  if (d.length < 8) return false;
  return listaDonos(donosRaw).includes(d);
}

/**
 * Detecta o comando de broadcast. Retorna `null` se a mensagem NÃO começa
 * com o marcador (não é broadcast). Se começa, retorna `{ corpo }` (o corpo
 * pode vir vazio — o caller valida). Preserva o case original do corpo.
 */
export function parseBroadcast(text: string, marker: string): { corpo: string } | null {
  const t = (text ?? '').trim();
  if (!t.toLowerCase().startsWith(marker.toLowerCase())) return null;
  return { corpo: t.slice(marker.length).trim() };
}

/**
 * Interceptador chamado no topo de `handleIncomingMessage`. Retorna `true`
 * se tratou a mensagem como broadcast (curto-circuito do pipeline normal).
 */
export async function tentarBroadcastAdmin(msg: {
  waId: string;
  messageId: string;
  text: string;
}): Promise<boolean> {
  if (!ehDono(msg.waId, env.OWNER_WHATSAPP_IDS)) return false;
  const parsed = parseBroadcast(msg.text, env.BROADCAST_MARKER);
  if (!parsed) return false; // dono mandou mensagem normal → segue fluxo

  // A partir daqui é comando de broadcast → sempre tratado (return true).
  const corpo = parsed.corpo;
  if (!corpo) {
    await sendText({
      to: msg.waId,
      text:
        '⚠️ Broadcast vazio. Manda o marcador seguido da mensagem:\n\n' +
        `${env.BROADCAST_MARKER}\nsua mensagem aqui`,
    });
    return true;
  }
  if (corpo.length > LIMITE_CHARS) {
    await sendText({
      to: msg.waId,
      text: `⚠️ Mensagem longa demais (${corpo.length} chars). Máximo ${LIMITE_CHARS}.`,
    });
    return true;
  }

  // Idempotência atômica: se o webhook redeliverar, o 2º não reenvia.
  if (msg.messageId) {
    const claimed = await redis.set(`broadcast:done:${msg.messageId}`, '1', 'EX', 86400, 'NX');
    if (claimed !== 'OK') return true;
  }

  // Lock global: evita 2 broadcasts simultâneos.
  const lockKey = 'broadcast:lock';
  const lock = await redis.set(lockKey, msg.messageId || '1', 'EX', 600, 'NX');
  if (lock !== 'OK') {
    await sendText({
      to: msg.waId,
      text: '⏳ Já tem um broadcast rodando. Espera terminar e tenta de novo.',
    });
    return true;
  }

  try {
    await executarBroadcast(msg.waId, corpo);
  } catch (error) {
    console.error('[broadcast] erro:', (error as Error).message);
    await sendText({ to: msg.waId, text: `❌ Broadcast falhou: ${(error as Error).message}` });
  } finally {
    await redis.del(lockKey);
  }
  return true;
}

async function executarBroadcast(donoWaId: string, corpo: string): Promise<void> {
  const testMode = env.BROADCAST_TEST_MODE;

  let destinatarios: string[];
  if (testMode) {
    destinatarios = [donoWaId];
  } else {
    const rows = await prisma.usuario.findMany({ select: { whatsappId: true } });
    // dedup no valor CRU (JID/@lid) — sendText aceita o whatsappId como está
    destinatarios = [...new Set(rows.map((r) => r.whatsappId).filter(Boolean))];
  }

  await sendText({
    to: donoWaId,
    text:
      `📣 Broadcast iniciando — ${destinatarios.length} destinatário(s)` +
      `${testMode ? ' (modo TESTE: só você)' : ''}.`,
  });

  const { enviados, falhas } = await notificarEmMassaThrottled(
    destinatarios,
    corpo,
    env.BROADCAST_THROTTLE_MS,
  );

  console.log(
    `[broadcast] testMode=${testMode} destinatarios=${destinatarios.length} ` +
      `enviados=${enviados} falhas=${falhas}`,
  );

  await sendText({
    to: donoWaId,
    text: `✅ Broadcast concluído: ${enviados} enviado(s)${falhas ? `, ${falhas} falha(s)` : ''}.`,
  });
}
