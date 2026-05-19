/**
 * Rotas /api/me — dados do usuario logado.
 *  GET /api/me                  → perfil + dados web
 *  GET /api/me/boloes           → lista resumida de boloes
 *  PATCH /api/me                → atualiza nome / dataNascimento
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { listarBoloesDoUsuarioComHistorico } from '../modules/bolao/bolao.repository.js';
import { buscarRodadaAberta } from '../modules/rodada/rodada.repository.js';
import { requireSession } from './session.middleware.js';

export function registerMeRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // GET /api/me
  // ----------------------------------------------------------------
  app.get('/api/me', { preHandler: [requireSession] }, async (req, reply) => {
    const { uid } = req.session!;
    const usuario = await prisma.usuario.findUnique({
      where: { id: uid },
      include: { usuarioWeb: true },
    });
    if (!usuario || !usuario.usuarioWeb) {
      return reply.code(404).send({ error: 'USER_GONE' });
    }
    return {
      id: usuario.id,
      nome: usuario.nome,
      celular: usuario.whatsappId,
      email: usuario.usuarioWeb.email,
      dataNascimento: usuario.usuarioWeb.dataNascimento,
      emailVerificado: usuario.usuarioWeb.emailVerificado,
      criadoEm: usuario.usuarioWeb.criadoEm,
    };
  });

  // ----------------------------------------------------------------
  // PATCH /api/me
  // ----------------------------------------------------------------
  app.patch('/api/me', { preHandler: [requireSession] }, async (req, reply) => {
    const { uid, wid } = req.session!;
    const schema = z.object({
      nome: z.string().min(2).max(80).optional(),
      dataNascimento: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use formato YYYY-MM-DD')
        .nullable()
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_BODY' });

    if (parsed.data.nome) {
      await prisma.usuario.update({
        where: { id: uid },
        data: { nome: parsed.data.nome.trim() },
      });
    }

    if (parsed.data.dataNascimento !== undefined) {
      const data = parsed.data.dataNascimento
        ? new Date(parsed.data.dataNascimento)
        : null;
      if (data && Number.isNaN(data.getTime())) {
        return reply.code(400).send({ error: 'INVALID_BIRTHDATE' });
      }
      await prisma.usuarioWeb.update({
        where: { id: wid },
        data: { dataNascimento: data },
      });
    }

    return { ok: true };
  });

  // ----------------------------------------------------------------
  // GET /api/me/boloes
  // ----------------------------------------------------------------
  app.get('/api/me/boloes', { preHandler: [requireSession] }, async (req) => {
    const { uid } = req.session!;
    const boloes = await listarBoloesDoUsuarioComHistorico(uid);

    // Pra cada bolao, pega:
    //  - pontuacao do usuario (vinda de participacao)
    //  - posicao atual (calculada a partir do ranking)
    //  - proximo jogo (rodada aberta, primeiro AGENDADO)
    //  - flag "faltaPalpitar" (rodada aberta, ainda sem palpite confirmado)
    const resultados = await Promise.all(
      boloes.map(async (b) => {
        const participacao = b.participacoes[0];
        const isAdmin = b.adminId === uid;

        // Posicao via ranking
        const ranking = await prisma.participacao.findMany({
          where: { bolaoId: b.id },
          orderBy: { pontuacaoTotal: 'desc' },
          select: { usuarioId: true, pontuacaoTotal: true },
        });
        const idx = ranking.findIndex((p) => p.usuarioId === uid);
        const posicao = idx >= 0 ? idx + 1 : null;
        const total = ranking.length;

        // Proximo jogo
        const rodadaAberta = await buscarRodadaAberta(b.id);
        let proximoJogo: {
          times: string;
          dataHora: Date;
        } | null = null;
        let faltaPalpitar = false;

        if (rodadaAberta) {
          const proximo = await prisma.jogo.findFirst({
            where: {
              rodadaId: rodadaAberta.id,
              status: 'AGENDADO',
              dataHora: { gt: new Date() },
            },
            orderBy: { dataHora: 'asc' },
          });
          if (proximo) {
            proximoJogo = {
              times: `${proximo.timeCasa} × ${proximo.timeVisitante}`,
              dataHora: proximo.dataHora,
            };
          }
          // Palpite do usuario nessa rodada?
          const palpite = await prisma.palpite.findUnique({
            where: {
              usuarioId_rodadaId: { usuarioId: uid, rodadaId: rodadaAberta.id },
            },
            include: { jogos: true },
          });
          faltaPalpitar = !palpite || palpite.jogos.length === 0;
        }

        return {
          id: b.id,
          codigo: b.codigo,
          nome: b.nome,
          status: b.status,
          isAdmin,
          pontos: participacao?.pontuacaoTotal ?? 0,
          posicao,
          total,
          proximoJogo,
          faltaPalpitar,
        };
      }),
    );

    return { boloes: resultados };
  });
}
