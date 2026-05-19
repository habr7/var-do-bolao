/**
 * Registra todas as rotas + plugins da Web API no app Fastify do bot.
 *
 * Chamada CONDICIONAL em src/index.ts:
 *   if (env.WEB_API_ENABLED) await registerWebApi(app);
 *
 * Quando WEB_API_ENABLED=false (default), nada disso eh carregado e o
 * bot fica idntico ao binario antigo. Zero risco pra producao do bot.
 */
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { env } from '../config/env.js';
import { registerAuthRoutes } from './auth.routes.js';
import { registerMeRoutes } from './me.routes.js';
import { registerBolaoRoutes } from './bolao.routes.js';

export async function registerWebApi(app: FastifyInstance) {
  // --- @fastify/cookie ---
  // Sem segredo aqui — assinamos manualmente via HMAC no session.service
  // pra ter controle total do formato (e poder validar do Next se
  // necessario sem dependencia mutua de libs).
  await app.register(cookie);

  // --- @fastify/cors ---
  // Aceita mais de uma origem separada por virgula. credentials=true
  // pra cookie httpOnly funcionar em cross-origin (dev).
  const origens = env.WEB_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);
  await app.register(cors, {
    origin: origens,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  // --- Rotas ---
  registerAuthRoutes(app);
  registerMeRoutes(app);
  registerBolaoRoutes(app);

  app.log.info(
    `[web-api] habilitada. origens permitidas: ${origens.join(', ')}`,
  );
}
