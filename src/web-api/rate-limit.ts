/**
 * Rate limit via bucket Redis. INCR + EXPIRE atomico (INCR cria se nao
 * existir; EXPIRE so na primeira vez evita renovar TTL a cada hit).
 *
 * Usado pra:
 *  - OTP request: 1 por minuto + 5 por dia por whatsappId
 *  - Login senha: 5 tentativas / 15min por email
 *  - Generico por IP em endpoints caros
 *
 * NAO eh distributed-friendly perfeitamente (race entre INCR e EXPIRE
 * em multi-instance pode resetar TTL), mas pra MVP single-node basta.
 */
import { redis } from '../config/redis.js';

export type RateLimitResult = {
  allowed: boolean;
  current: number;
  limit: number;
  resetSeconds: number;
};

export async function consumirBucket(
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const fullKey = `ratelimit:${key}`;
  const current = await redis.incr(fullKey);

  let ttl = await redis.ttl(fullKey);
  if (current === 1 || ttl < 0) {
    await redis.expire(fullKey, windowSeconds);
    ttl = windowSeconds;
  }

  return {
    allowed: current <= limit,
    current,
    limit,
    resetSeconds: ttl,
  };
}

/**
 * Verifica AMBOS os limites (por minuto + por dia) pra OTP.
 * Retorna o primeiro que estourou (UI mostra mensagem clara).
 */
export async function checkOtpRateLimit(
  whatsappId: string,
  perMinute: number,
  perDay: number,
): Promise<RateLimitResult | null> {
  const m = await consumirBucket(`otp:m:${whatsappId}`, perMinute, 60);
  if (!m.allowed) return m;
  const d = await consumirBucket(`otp:d:${whatsappId}`, perDay, 86_400);
  if (!d.allowed) return d;
  return null;
}

/**
 * Helper pra login com senha (anti brute force por identifier).
 */
export async function checkLoginRateLimit(
  identifier: string,
  limit = 5,
  windowSeconds = 15 * 60,
): Promise<RateLimitResult | null> {
  const r = await consumirBucket(`login:${identifier}`, limit, windowSeconds);
  return r.allowed ? null : r;
}
