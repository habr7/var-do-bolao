import crypto from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Valida o header X-Hub-Signature-256 enviado pela Meta.
 * A assinatura é `sha256={hex}` onde `hex = HMAC-SHA256(APP_SECRET, rawBody)`.
 *
 * IMPORTANTE: precisa do raw body, nao do JSON parseado.
 */
export function validateMetaSignature(rawBody: string | Buffer, signatureHeader: string | undefined): boolean {
  if (!signatureHeader) return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const received = signatureHeader.slice('sha256='.length);

  const expected = crypto
    .createHmac('sha256', env.WHATSAPP_APP_SECRET)
    .update(rawBody)
    .digest('hex');

  // timing-safe compare
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
