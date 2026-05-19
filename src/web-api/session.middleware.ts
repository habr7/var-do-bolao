/**
 * Middleware Fastify que extrai o cookie de sessao, valida HMAC e popula
 * request.session. Rotas que precisam de auth declaram `preHandler:
 * [requireSession]`. As publicas (OTP request, etc) pulam.
 *
 * Cookie eh setado pelo Fastify (via @fastify/cookie) — mesmo dominio
 * em prod (api.vardobolao.com.br + www.vardobolao.com.br compartilham
 * `.vardobolao.com.br`).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie'; // augments FastifyRequest with `cookies`
import {
  SESSION_COOKIE_NAME,
  type SessionPayload,
  verifySessionToken,
} from './session.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionPayload;
  }
}

export async function loadSession(req: FastifyRequest): Promise<void> {
  const cookies = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  const token = cookies?.[SESSION_COOKIE_NAME];
  if (!token) return;
  const payload = verifySessionToken(token);
  if (payload) req.session = payload;
}

export async function requireSession(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await loadSession(req);
  if (!req.session) {
    reply.code(401).send({ error: 'UNAUTHENTICATED' });
  }
}
