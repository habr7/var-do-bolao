import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

/**
 * Roteador de canal — decide POR DESTINATÁRIO se uma mensagem de saída
 * vai pelo WhatsApp (Evolution API) ou pelo Telegram (Bot API).
 *
 * O resto do bot continua chamando `sendText({ to })` com o endereço de
 * sempre (waId/JID). A decisão de canal acontece SÓ aqui, na fronteira:
 *
 *   1. `to` começa com "tg:"  → Telegram direto (usado pelo onboarding,
 *      antes de existir vínculo com um Usuario).
 *   2. Senão, `to` é um waId. Busca o Usuario (cache 60s) e decide:
 *      - ENABLE_TELEGRAM + user linkado + (canalPreferido='telegram' OU
 *        WhatsApp desligado)                       → Telegram
 *      - ENABLE_WHATSAPP                            → WhatsApp (comportamento atual)
 *      - nenhum canal viável                        → 'drop' (loga e não envia)
 *
 * REGRA DE OURO: com as flags default (ENABLE_WHATSAPP=true,
 * ENABLE_TELEGRAM=false) TODA mensagem sai pelo WhatsApp exatamente como
 * hoje — zero mudança de comportamento sem opt-in explícito no .env.
 */

export type RotaEnvio =
  | { canal: 'whatsapp'; to: string }
  | { canal: 'telegram'; chatId: string }
  | { canal: 'drop'; motivo: string };

/** Prefixo de endereço que força Telegram (chat ainda sem vínculo). */
export const TG_PREFIX = 'tg:';

export function enderecoTelegram(chatId: string | number): string {
  return `${TG_PREFIX}${chatId}`;
}

export function ehEnderecoTelegram(to: string): boolean {
  return to.startsWith(TG_PREFIX);
}

// ============================================================
// Cache curto em memória (evita 1 SELECT por mensagem enviada)
// ============================================================
interface CacheEntry {
  telegramId: string | null;
  canalPreferido: string | null;
  expira: number;
}
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/** Invalida o cache de um waId — chamar quando vincular/desvincular Telegram. */
export function invalidarCacheCanal(waId?: string): void {
  if (waId) {
    cache.delete(waId);
    cache.delete(soDigitosDe(waId));
  } else {
    cache.clear();
  }
}

function soDigitosDe(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Busca dados de canal do usuário pelo waId. Tenta match exato (formato
 * que o próprio bot gravou) e cai pra variantes com/sem sufixo JID —
 * produção grava "5511…@s.whatsapp.net", simulador/jobs às vezes só dígitos.
 */
async function buscarDadosCanal(waId: string): Promise<CacheEntry> {
  const agora = Date.now();
  const hit = cache.get(waId);
  if (hit && hit.expira > agora) return hit;

  const digits = soDigitosDe(waId);
  const candidatos = [waId, digits, `${digits}@s.whatsapp.net`].filter(
    (v, i, arr) => v.length > 0 && arr.indexOf(v) === i,
  );

  let entry: CacheEntry = { telegramId: null, canalPreferido: null, expira: agora + CACHE_TTL_MS };
  try {
    const usuario = await prisma.usuario.findFirst({
      where: { whatsappId: { in: candidatos } },
      select: { telegramId: true, canalPreferido: true },
    });
    if (usuario) {
      entry = {
        telegramId: usuario.telegramId,
        canalPreferido: usuario.canalPreferido,
        expira: agora + CACHE_TTL_MS,
      };
    }
  } catch (error) {
    // DB fora do ar não pode derrubar envio — assume sem vínculo (WhatsApp).
    console.warn('[channel-router] falha ao buscar canal do usuario:', (error as Error).message);
  }

  cache.set(waId, entry);
  return entry;
}

// ============================================================
// Decisão de rota
// ============================================================
export async function resolverRotaEnvio(to: string): Promise<RotaEnvio> {
  // Endereço explícito de Telegram (onboarding / chat sem vínculo)
  if (ehEnderecoTelegram(to)) {
    if (!env.ENABLE_TELEGRAM) return { canal: 'drop', motivo: 'ENABLE_TELEGRAM=false' };
    return { canal: 'telegram', chatId: to.slice(TG_PREFIX.length) };
  }

  // Atalho: Telegram desligado → WhatsApp direto, sem tocar no banco
  // (caminho quente atual — zero custo novo enquanto o Telegram não liga).
  if (!env.ENABLE_TELEGRAM) {
    if (!env.ENABLE_WHATSAPP) return { canal: 'drop', motivo: 'ambos os canais desligados' };
    return { canal: 'whatsapp', to };
  }

  const dados = await buscarDadosCanal(to);
  const temVinculoTelegram = Boolean(dados.telegramId);

  if (temVinculoTelegram) {
    // Preferência explícita do usuário OU WhatsApp desligado → Telegram
    if (dados.canalPreferido === 'telegram' || !env.ENABLE_WHATSAPP) {
      return { canal: 'telegram', chatId: dados.telegramId as string };
    }
    // linkado mas preferindo whatsapp (canalPreferido='whatsapp'/null)
    return { canal: 'whatsapp', to };
  }

  if (env.ENABLE_WHATSAPP) return { canal: 'whatsapp', to };

  return {
    canal: 'drop',
    motivo: `usuario sem vinculo Telegram e ENABLE_WHATSAPP=false (to=${to.slice(0, 6)}…)`,
  };
}
