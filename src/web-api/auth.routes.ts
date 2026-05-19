/**
 * Rotas de autenticacao web. Todas em /api/auth/*.
 *
 *  POST /api/auth/otp/request   { celular }            → 200 sempre (anti enum)
 *  POST /api/auth/otp/verify    { celular, codigo }    → 200 + cookie (ou 401)
 *  POST /api/auth/first-access  { nome, email, dataNascimento?, senha }
 *                                                       → 200 + cookie (precisa pre-cookie)
 *  POST /api/auth/login         { email, senha }       → 200 + cookie
 *  POST /api/auth/logout                                → 204 + clear cookie
 *
 * Cookie de sessao eh setado pelo @fastify/cookie (httpOnly, Secure em prod,
 * SameSite=Lax). Em dev o site fica em http://localhost:3001 e o bot em
 * http://localhost:3000 — usamos Lax pra cookie funcionar em mesma origem
 * via proxy / fetch credenciais.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import {
  gerarEEnviarOtp,
  normalizarTelefoneBR,
  verificarOtp,
} from './otp.service.js';
import {
  checkLoginRateLimit,
  checkOtpRateLimit,
} from './rate-limit.js';
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
} from './session.service.js';
import { loadSession, requireSession } from './session.middleware.js';

// Pre-cookie usado entre OTP verify e first-access (10min). Marca o
// waId verificado pra criar a UsuarioWeb sem precisar de nova validacao.
const PRE_COOKIE_NAME = 'vdb_pre_cadastro';
const PRE_COOKIE_TTL_SECONDS = 10 * 60;

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(
    SESSION_COOKIE_NAME,
    token,
    cookieOptions(env.WEB_SESSION_TTL_DAYS * 86_400),
  );
}

function setPreCookie(reply: FastifyReply, waId: string) {
  reply.setCookie(PRE_COOKIE_NAME, waId, cookieOptions(PRE_COOKIE_TTL_SECONDS));
}

function clearCookie(reply: FastifyReply, name: string) {
  reply.setCookie(name, '', { ...cookieOptions(0), maxAge: 0 });
}

export function registerAuthRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // POST /api/auth/otp/request
  // ----------------------------------------------------------------
  app.post('/api/auth/otp/request', async (req, reply) => {
    const schema = z.object({ celular: z.string().min(8) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

    const waId = normalizarTelefoneBR(parsed.data.celular);
    if (!waId) return reply.code(400).send({ error: 'INVALID_PHONE' });

    // Rate limit por waId (1/min, 5/dia default)
    const limited = await checkOtpRateLimit(
      waId,
      env.OTP_RATE_LIMIT_PER_MINUTE,
      env.OTP_RATE_LIMIT_PER_DAY,
    );
    if (limited) {
      return reply
        .code(429)
        .send({ error: 'RATE_LIMITED', resetSeconds: limited.resetSeconds });
    }

    // So manda OTP se o waId existe como Usuario do bot. Mas devolve
    // 200 igual pra nao revelar (anti enumeration).
    const usuario = await prisma.usuario.findUnique({
      where: { whatsappId: waId },
    });

    if (usuario) {
      await gerarEEnviarOtp(waId).catch((err) => {
        console.error('[web-api] gerarEEnviarOtp falhou:', err);
      });
    }

    // Sempre 200 — UI mostra "se o numero existe, mandamos um codigo"
    return reply.send({ ok: true });
  });

  // ----------------------------------------------------------------
  // POST /api/auth/otp/verify
  // ----------------------------------------------------------------
  app.post('/api/auth/otp/verify', async (req, reply) => {
    const schema = z.object({
      celular: z.string().min(8),
      codigo: z.string().min(4).max(8),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

    const waId = normalizarTelefoneBR(parsed.data.celular);
    if (!waId) return reply.code(400).send({ error: 'INVALID_PHONE' });

    const result = await verificarOtp(waId, parsed.data.codigo);
    if (!result.ok) {
      const codigo = result.reason === 'EXPIRED' ? 410 : 401;
      return reply.code(codigo).send({ error: result.reason });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { whatsappId: waId },
      include: { usuarioWeb: true },
    });
    if (!usuario) {
      // Caso bizarro: token valido mas usuario sumiu. 500.
      return reply.code(500).send({ error: 'USER_GONE' });
    }

    if (usuario.usuarioWeb) {
      // Conta web existe — emite cookie de sessao definitiva
      const token = createSessionToken(usuario.id, usuario.usuarioWeb.id);
      await prisma.usuarioWeb.update({
        where: { id: usuario.usuarioWeb.id },
        data: { ultimoLoginEm: new Date() },
      });
      setSessionCookie(reply, token);
      return reply.send({
        ok: true,
        firstAccess: false,
        nome: usuario.nome,
      });
    }

    // Sem conta web — emite pre-cookie pro first-access
    setPreCookie(reply, waId);
    return reply.send({
      ok: true,
      firstAccess: true,
      nome: usuario.nome,
    });
  });

  // ----------------------------------------------------------------
  // POST /api/auth/first-access
  // ----------------------------------------------------------------
  app.post('/api/auth/first-access', async (req, reply) => {
    const cookies = (req as FastifyRequest & {
      cookies?: Record<string, string>;
    }).cookies;
    const waId = cookies?.[PRE_COOKIE_NAME];
    if (!waId) return reply.code(401).send({ error: 'PRE_COOKIE_MISSING' });

    const schema = z.object({
      nome: z.string().min(2).max(80).optional(),
      email: z.string().email().max(120),
      senha: z.string().min(8).max(72),
      dataNascimento: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'INVALID_BODY', issues: parsed.error.flatten() });
    }

    const usuario = await prisma.usuario.findUnique({
      where: { whatsappId: waId },
      include: { usuarioWeb: true },
    });
    if (!usuario) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
    if (usuario.usuarioWeb) {
      return reply.code(409).send({ error: 'WEB_ACCOUNT_EXISTS' });
    }

    // Email unique check antes do create pra dar erro mais claro
    const emailEmUso = await prisma.usuarioWeb.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
    });
    if (emailEmUso) return reply.code(409).send({ error: 'EMAIL_TAKEN' });

    const senhaHash = await bcrypt.hash(parsed.data.senha, 12);

    const dataNascimento = parsed.data.dataNascimento
      ? new Date(parsed.data.dataNascimento)
      : null;

    if (dataNascimento && Number.isNaN(dataNascimento.getTime())) {
      return reply.code(400).send({ error: 'INVALID_BIRTHDATE' });
    }

    const usuarioWeb = await prisma.usuarioWeb.create({
      data: {
        usuarioId: usuario.id,
        email: parsed.data.email.toLowerCase(),
        senhaHash,
        dataNascimento,
      },
    });

    // Atualiza nome no Usuario se veio diferente (UX: usuario corrigiu)
    if (parsed.data.nome && parsed.data.nome.trim() !== usuario.nome) {
      await prisma.usuario.update({
        where: { id: usuario.id },
        data: { nome: parsed.data.nome.trim() },
      });
    }

    clearCookie(reply, PRE_COOKIE_NAME);
    const token = createSessionToken(usuario.id, usuarioWeb.id);
    setSessionCookie(reply, token);

    return reply.send({ ok: true, nome: parsed.data.nome ?? usuario.nome });
  });

  // ----------------------------------------------------------------
  // POST /api/auth/login (senha)
  // ----------------------------------------------------------------
  app.post('/api/auth/login', async (req, reply) => {
    const schema = z.object({
      email: z.string().email().max(120),
      senha: z.string().min(1).max(72),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

    const email = parsed.data.email.toLowerCase();

    const limited = await checkLoginRateLimit(email);
    if (limited) {
      return reply
        .code(429)
        .send({ error: 'RATE_LIMITED', resetSeconds: limited.resetSeconds });
    }

    const conta = await prisma.usuarioWeb.findUnique({
      where: { email },
      include: { usuario: true },
    });

    // Sempre faz bcrypt.compare (mesmo se conta nao existe) pra equalizar
    // o tempo de resposta — evita timing-based enumeration.
    const hashAlvo = conta?.senhaHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalido';
    const ok = await bcrypt.compare(parsed.data.senha, hashAlvo);

    if (!conta || !ok) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
    }

    await prisma.usuarioWeb.update({
      where: { id: conta.id },
      data: { ultimoLoginEm: new Date() },
    });

    const token = createSessionToken(conta.usuarioId, conta.id);
    setSessionCookie(reply, token);
    return reply.send({ ok: true, nome: conta.usuario.nome });
  });

  // ----------------------------------------------------------------
  // POST /api/auth/logout
  // ----------------------------------------------------------------
  app.post('/api/auth/logout', { preHandler: [loadSession] }, async (_req, reply) => {
    clearCookie(reply, SESSION_COOKIE_NAME);
    return reply.code(204).send();
  });

  // ----------------------------------------------------------------
  // GET /api/auth/me — sanity check de cookie
  // ----------------------------------------------------------------
  app.get(
    '/api/auth/session',
    { preHandler: [requireSession] },
    async (req) => {
      return { uid: req.session!.uid, wid: req.session!.wid };
    },
  );
}
