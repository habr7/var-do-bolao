/**
 * Sessao web — token HMAC compacto, em cookie httpOnly.
 *
 * Formato: <payload-base64url>.<sig-base64url>
 *   payload = { uid: usuarioId, wid: usuarioWebId, exp: unix-ts }
 *
 * Validacao puramente criptografica — nao precisa hit no banco a cada
 * request (basta verificar HMAC + exp). Logout = expira o cookie no
 * browser; nao mantemos lista de revogacao no MVP.
 *
 * Por que cookie httpOnly em vez de localStorage: protege contra XSS.
 * O cookie eh assinado com WEB_SESSION_SECRET (apenas o bot conhece).
 *
 * Por que tudo aqui em vez de iron-session: zero dependencia, mesmo
 * runtime do bot, footprint minimo.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

export type SessionPayload = {
  uid: string; // usuarioId
  wid: string; // usuarioWebId
  exp: number; // unix timestamp (segundos)
};

export const SESSION_COOKIE_NAME = 'vdb_session';

function sign(data: string): string {
  return createHmac('sha256', env.WEB_SESSION_SECRET)
    .update(data)
    .digest('base64url');
}

/**
 * Constante-time string compare. Evita timing attacks.
 */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function createSessionToken(
  uid: string,
  wid: string,
  ttlSeconds: number = env.WEB_SESSION_TTL_DAYS * 86_400,
): string {
  const payload: SessionPayload = {
    uid,
    wid,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;

  const [encoded, sig] = token.split('.', 2);
  if (!encoded || !sig) return null;

  const expected = sign(encoded);
  if (!safeEqual(expected, sig)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.uid !== 'string' || typeof payload.wid !== 'string') return null;
  if (typeof payload.exp !== 'number') return null;
  if (payload.exp * 1000 < Date.now()) return null;

  return payload;
}
