/**
 * Rotas /api/boloes/:codigo/* — sempre leitura.
 *  GET /api/boloes/:codigo/ranking
 *  GET /api/boloes/:codigo/meus-palpites
 *  GET /api/boloes/:codigo/proximos-jogos
 *
 * Validacao de permissao: usuario logado precisa ser admin OU participante
 * do bolao. Caso contrario 403.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { buscarRankingBolao } from '../modules/ranking/ranking.repository.js';
import { buscarBolaoAtivoPorCodigo } from '../modules/bolao/bolao.repository.js';
import { buscarRodadaAberta } from '../modules/rodada/rodada.repository.js';
import { requireSession } from './session.middleware.js';

type CodigoParams = { codigo: string };

async function loadBolaoComAcesso(
  req: FastifyRequest<{ Params: CodigoParams }>,
  reply: FastifyReply,
) {
  const codigo = req.params.codigo.toUpperCase().replace(/^#/, '');
  // buscarBolaoAtivoPorCodigo so retorna ATIVO — pra consultas a gente
  // tambem precisa de FINALIZADO. Fazemos query direta.
  const bolao = await prisma.bolao.findUnique({
    where: { codigo },
    include: { participacoes: true },
  });
  if (!bolao) {
    reply.code(404).send({ error: 'BOLAO_NOT_FOUND' });
    return null;
  }
  const { uid } = req.session!;
  const isAdmin = bolao.adminId === uid;
  const isParticipante = bolao.participacoes.some((p) => p.usuarioId === uid);
  if (!isAdmin && !isParticipante) {
    reply.code(403).send({ error: 'FORBIDDEN' });
    return null;
  }
  return { bolao, isAdmin };
}

// helper pra silenciar a importacao nao usada
void buscarBolaoAtivoPorCodigo;

export function registerBolaoRoutes(app: FastifyInstance) {
  // ----------------------------------------------------------------
  // GET /api/boloes/:codigo/ranking
  // ----------------------------------------------------------------
  app.get<{ Params: CodigoParams }>(
    '/api/boloes/:codigo/ranking',
    { preHandler: [requireSession] },
    async (req, reply) => {
      const ctx = await loadBolaoComAcesso(req, reply);
      if (!ctx) return;
      const { bolao } = ctx;
      const ranking = await buscarRankingBolao(bolao.id);
      return {
        bolao: {
          id: bolao.id,
          codigo: bolao.codigo,
          nome: bolao.nome,
          status: bolao.status,
        },
        ranking: ranking.map((p, i) => ({
          posicao: i + 1,
          usuarioId: p.usuarioId,
          nome: p.usuario.nome,
          pontuacao: p.pontuacaoTotal,
          isVoce: p.usuarioId === req.session!.uid,
        })),
      };
    },
  );

  // ----------------------------------------------------------------
  // GET /api/boloes/:codigo/meus-palpites
  // ----------------------------------------------------------------
  app.get<{ Params: CodigoParams }>(
    '/api/boloes/:codigo/meus-palpites',
    { preHandler: [requireSession] },
    async (req, reply) => {
      const ctx = await loadBolaoComAcesso(req, reply);
      if (!ctx) return;
      const { bolao } = ctx;
      const { uid } = req.session!;

      const palpites = await prisma.palpite.findMany({
        where: { usuarioId: uid, rodada: { bolaoId: bolao.id } },
        include: {
          rodada: true,
          jogos: { include: { jogo: true } },
        },
        orderBy: { rodada: { numero: 'desc' } },
      });

      return {
        rodadas: palpites.map((p) => ({
          rodada: p.rodada.numero,
          rodadaStatus: p.rodada.status,
          pontuacao: p.pontuacao,
          calculado: p.calculado,
          jogos: p.jogos.map((pj) => ({
            jogoId: pj.jogoId,
            timeCasa: pj.jogo.timeCasa,
            timeVisitante: pj.jogo.timeVisitante,
            golsCasaReais: pj.jogo.golsCasa,
            golsVisitanteReais: pj.jogo.golsVisitante,
            statusJogo: pj.jogo.status,
            palpiteCasa: pj.golsCasa,
            palpiteVisitante: pj.golsVisitante,
            pontosObtidos: pj.pontosObtidos,
            dataHora: pj.jogo.dataHora,
          })),
        })),
      };
    },
  );

  // ----------------------------------------------------------------
  // GET /api/boloes/:codigo/proximos-jogos
  // ----------------------------------------------------------------
  app.get<{ Params: CodigoParams }>(
    '/api/boloes/:codigo/proximos-jogos',
    { preHandler: [requireSession] },
    async (req, reply) => {
      const ctx = await loadBolaoComAcesso(req, reply);
      if (!ctx) return;
      const { bolao } = ctx;
      const { uid } = req.session!;

      const rodada = await buscarRodadaAberta(bolao.id);
      if (!rodada) return { rodada: null, jogos: [] };

      const jogos = await prisma.jogo.findMany({
        where: { rodadaId: rodada.id, status: { in: ['AGENDADO', 'AO_VIVO'] } },
        orderBy: { dataHora: 'asc' },
      });

      const palpite = await prisma.palpite.findUnique({
        where: { usuarioId_rodadaId: { usuarioId: uid, rodadaId: rodada.id } },
        include: { jogos: true },
      });
      const palpitesPorJogo = new Map(
        (palpite?.jogos ?? []).map((pj) => [pj.jogoId, pj]),
      );

      return {
        rodada: { numero: rodada.numero, status: rodada.status },
        jogos: jogos.map((j) => {
          const pj = palpitesPorJogo.get(j.id);
          return {
            jogoId: j.id,
            timeCasa: j.timeCasa,
            timeVisitante: j.timeVisitante,
            dataHora: j.dataHora,
            status: j.status,
            jaPalpitou: !!pj,
            palpiteCasa: pj?.golsCasa ?? null,
            palpiteVisitante: pj?.golsVisitante ?? null,
          };
        }),
      };
    },
  );
}
