import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { invalidarCacheCanal } from './channel-router.js';
import type { Usuario } from '@prisma/client';

/**
 * Identidade Telegram ↔ Usuario — resolve quem é a pessoa e conduz o
 * ONBOARDING do 1º contato ("me fala teu WhatsApp que eu recupero teus
 * pontos"), ligando a conta do Telegram ao cadastro existente.
 *
 * Fluxo (mini-FSM própria em Redis, keyed por chatId — SEPARADA da FSM
 * de conversa do bot, que só começa depois do vínculo):
 *
 *   1º contato/ /start → AGUARDANDO_NUMERO
 *      pessoa manda o número → acha o Usuario por variantes do número
 *        achou   → CONFIRMANDO_VINCULO ("Achei: *Fulano* — é você?")
 *        não achou → CONFIRMANDO_CRIAR_NOVO ("começar do zero?")
 *      sim (vínculo) → grava telegramId + canalPreferido='telegram' → pronto
 *      sim (novo)    → cria Usuario com o número informado → pronto
 *
 * Depois do vínculo, TODA mensagem da pessoa vira um handleIncomingMessage
 * normal com waId = usuario.whatsappId — o command.router nem sabe que a
 * conversa veio do Telegram, e o histórico/pontuação aparecem sozinhos.
 */

// ============================================================
// Normalização de número BR
// ============================================================

/**
 * Normaliza o que a pessoa digitou pra dígitos canônicos com DDI:
 *   "(11) 97613-5412"   → "5511976135412"
 *   "11 97613 5412"     → "5511976135412"
 *   "+55 11 97613-5412" → "5511976135412"
 * Devolve null se não parecer um telefone BR válido.
 */
export function normalizarNumeroBR(entrada: string): string | null {
  const digits = entrada.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return null;

  // Já com DDI 55 (12–13 dígitos: 55 + DDD + 8–9)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // Sem DDI (10–11 dígitos: DDD + 8–9) → prefixa 55
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return null;
}

/**
 * Variantes de armazenamento do MESMO número, pra casar com o que existe
 * no banco (produção grava "…@s.whatsapp.net"; simulador grava só dígitos;
 * e o 9º dígito BR pode ter sido gravado com ou sem):
 *   5511976135412 → [5511976135412, 551176135412, +sufixos @s.whatsapp.net]
 */
export function variantesNumeroBR(numeroCanonico: string): string[] {
  const base = new Set<string>([numeroCanonico]);

  // 55 + DDD(2) + 9XXXXXXXX (13 dígitos) → variante sem o 9º dígito
  if (numeroCanonico.length === 13 && numeroCanonico[4] === '9') {
    base.add(numeroCanonico.slice(0, 4) + numeroCanonico.slice(5));
  }
  // 55 + DDD(2) + XXXXXXXX (12 dígitos) → variante com o 9º dígito
  if (numeroCanonico.length === 12) {
    base.add(`${numeroCanonico.slice(0, 4)}9${numeroCanonico.slice(4)}`);
  }

  const todas: string[] = [];
  for (const n of base) {
    todas.push(n, `${n}@s.whatsapp.net`);
  }
  return todas;
}

// ============================================================
// Resolução de identidade
// ============================================================

export async function buscarUsuarioPorTelegramId(chatId: string | number): Promise<Usuario | null> {
  return prisma.usuario.findUnique({ where: { telegramId: String(chatId) } });
}

export async function buscarUsuarioPorNumero(numeroCanonico: string): Promise<Usuario | null> {
  return prisma.usuario.findFirst({
    where: { whatsappId: { in: variantesNumeroBR(numeroCanonico) } },
  });
}

/** Grava o vínculo Telegram no cadastro existente (recupera pontuação). */
export async function vincularTelegram(
  usuarioId: string,
  chatId: string | number,
  telegramUsername?: string | null,
): Promise<Usuario> {
  const usuario = await prisma.usuario.update({
    where: { id: usuarioId },
    data: {
      telegramId: String(chatId),
      telegramUsername: telegramUsername ?? null,
      canalPreferido: 'telegram',
    },
  });
  invalidarCacheCanal(usuario.whatsappId);
  return usuario;
}

/** Cria cadastro NOVO já vinculado ao Telegram (pessoa sem histórico). */
export async function criarUsuarioViaTelegram(
  numeroCanonico: string,
  nome: string,
  chatId: string | number,
  telegramUsername?: string | null,
): Promise<Usuario> {
  const usuario = await prisma.usuario.create({
    data: {
      whatsappId: numeroCanonico,
      telefone: numeroCanonico,
      nome: nome || 'Craque',
      telegramId: String(chatId),
      telegramUsername: telegramUsername ?? null,
      canalPreferido: 'telegram',
    },
  });
  invalidarCacheCanal(numeroCanonico);
  return usuario;
}

// ============================================================
// FSM de onboarding (Redis) — separada da FSM de conversa
// ============================================================

export type OnboardingState =
  | 'AGUARDANDO_NUMERO'
  | 'CONFIRMANDO_VINCULO'
  | 'CONFIRMANDO_CRIAR_NOVO';

export interface OnboardingSession {
  state: OnboardingState;
  // candidato achado pelo número (CONFIRMANDO_VINCULO)
  usuarioIdCandidato?: string;
  nomeCandidato?: string;
  // número canônico informado (usado em CONFIRMANDO_CRIAR_NOVO)
  numeroCanonico?: string;
  tentativas?: number;
}

const ONBOARDING_PREFIX = 'tg_onboarding:';
const ONBOARDING_TTL_SECONDS = 60 * 30; // 30 min (igual à sessão de conversa)

export async function getOnboarding(chatId: string | number): Promise<OnboardingSession | null> {
  const raw = await redis.get(`${ONBOARDING_PREFIX}${chatId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OnboardingSession;
  } catch {
    return null;
  }
}

export async function setOnboarding(
  chatId: string | number,
  session: OnboardingSession,
): Promise<void> {
  await redis.setex(
    `${ONBOARDING_PREFIX}${chatId}`,
    ONBOARDING_TTL_SECONDS,
    JSON.stringify(session),
  );
}

export async function clearOnboarding(chatId: string | number): Promise<void> {
  await redis.del(`${ONBOARDING_PREFIX}${chatId}`);
}
