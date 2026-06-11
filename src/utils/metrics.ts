import { createHash } from 'node:crypto';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';

/**
 * Metricas em 2 camadas:
 *
 *   1. Redis (counters agregados, TTL 30d) — pra dashboards/debug rapido.
 *      Hash por dia: `metrics:YYYY-MM-DD` com contadores nomeados.
 *
 *   2. Prisma (amostras de mensagens nao entendidas, persistencia indefinida
 *      ate o job mensal de limpeza). Substituiu a antiga lista Redis
 *      `metrics:YYYY-MM-DD:nao-entendi` (que expirava no dia 31).
 *
 * IMPORTANTE: todas as funcoes sao FIRE-AND-FORGET / best-effort. Se Redis
 * ou Prisma falhar, o caller nao quebra — so loga warning. Metricas NUNCA
 * podem segurar o handler principal.
 *
 * LGPD: `whatsappId` nunca persistido em claro — so hash sha256-16.
 */

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias (Redis counters)

function chaveDoDia(prefix = 'metrics'): string {
  // YYYY-MM-DD em UTC. Pra metricas internas, fuso nao importa muito.
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Hash curto de identificador (sha256, primeiros 16 hex). LGPD-friendly:
 * permite agrupar mensagens do mesmo usuario sem persistir telefone em claro.
 */
export function hashIdentificador(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 16);
}

/**
 * Incrementa um contador nomeado pra o dia atual (Redis).
 *
 * Convencoes de nome (use estes prefixos):
 *   msg.total                      — toda mensagem entrando
 *   msg.nao_entendi                — caiu no "nao entendi" final
 *   intent.<NOME>                  — regex casou esta intent (camada 1)
 *   llm.intent.classifier.hit      — LLM intent classifier acertou (camada 2)
 *   llm.intent.classifier.miss     — LLM intent classifier sem resposta
 *   llm.intent.classifier.low_conf — LLM tentou mas confianca < threshold
 *   llm.conversational.hit         — LLM smart-fallback respondeu (camada 3)
 *   llm.conversational.miss        — LLM smart-fallback sem resposta
 *   admin.<acao>                   — acoes admin (aprovar_todos, recusar, etc)
 */
export async function incContador(nome: string): Promise<void> {
  try {
    const key = chaveDoDia();
    await redis.hincrby(key, nome, 1);
    await redis.expire(key, TTL_SECONDS);
  } catch (err) {
    console.warn('[metrics] falha incContador:', (err as Error).message);
  }
}

export type MotivoNaoEntendido =
  | 'regex_fail'
  | 'llm_fail'
  | 'final_fallback'
  | 'low_confidence'
  // v3.15.0 — user reportou erro/bug ("meus pontos estão errados").
  // Logado pra revisão offline — ouro pra achar bugs reais de pontuação.
  | 'reclamacao_bug';

export interface ExtrasNaoEntendido {
  /** whatsappId em claro — vai virar hash antes de persistir. */
  whatsappId?: string;
  /** FK opcional pro Usuario (anonimiza com onDelete: SET NULL). */
  usuarioId?: string;
  /** intent que o LLM tentou (mesmo quando rejeitado por low confidence). */
  llmIntent?: string;
  /** confianca retornada pela LLM, 0-1. */
  llmConfianca?: number;
}

/**
 * Grava uma amostra de mensagem nao entendida no Prisma. Substitui a
 * antiga lista Redis (top 500/dia, TTL 30d). Agora persiste indefinidamente
 * — apenas o job mensal de limpeza derruba registros velhos.
 *
 * Fire-and-forget: nunca lanca, nunca segura o handler principal.
 */
export async function registrarMsgNaoEntendida(
  text: string,
  state: string,
  motivo: MotivoNaoEntendido = 'final_fallback',
  extras: ExtrasNaoEntendido = {},
): Promise<void> {
  try {
    const whatsappIdHash = extras.whatsappId
      ? hashIdentificador(extras.whatsappId)
      : 'anon';
    await prisma.mensagemNaoEntendida.create({
      data: {
        usuarioId: extras.usuarioId ?? null,
        whatsappIdHash,
        texto: text.slice(0, 500),
        state,
        motivo,
        llmIntent: extras.llmIntent ?? null,
        llmConfianca: extras.llmConfianca ?? null,
      },
    });
  } catch (err) {
    console.warn(
      '[metrics] falha registrarMsgNaoEntendida:',
      (err as Error).message,
    );
  }
}

/**
 * Le o hash de contadores de um dia (YYYY-MM-DD). Util pra endpoint admin
 * ou inspecao via redis-cli.
 */
export async function lerMetricasDoDia(dia: string): Promise<Record<string, number>> {
  try {
    const raw = await redis.hgetall(`metrics:${dia}`);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) {
      out[k] = parseInt(v, 10) || 0;
    }
    return out;
  } catch (err) {
    console.warn('[metrics] falha lerMetricasDoDia:', (err as Error).message);
    return {};
  }
}

/**
 * Le as ultimas N amostras de mensagens nao entendidas (de um dia OU
 * agregado dos ultimos N). Agora le do Prisma — fonte de verdade.
 *
 * @param dia Se passado no formato YYYY-MM-DD, filtra so daquele dia.
 *            Se vazio/undefined, retorna as N mais recentes em geral.
 * @param limit Default 100.
 * @param motivo Filtro opcional (regex_fail / llm_fail / etc).
 */
export async function lerAmostrasNaoEntendi(
  dia?: string,
  limit = 100,
  motivo?: MotivoNaoEntendido,
): Promise<
  Array<{
    id: string;
    texto: string;
    state: string;
    motivo: string;
    llmIntent: string | null;
    llmConfianca: number | null;
    criadoEm: Date;
  }>
> {
  try {
    const where: Record<string, unknown> = {};
    if (dia) {
      const ini = new Date(`${dia}T00:00:00Z`);
      const fim = new Date(`${dia}T23:59:59.999Z`);
      where.criadoEm = { gte: ini, lte: fim };
    }
    if (motivo) where.motivo = motivo;

    const rows = await prisma.mensagemNaoEntendida.findMany({
      where,
      orderBy: { criadoEm: 'desc' },
      take: limit,
      select: {
        id: true,
        texto: true,
        state: true,
        motivo: true,
        llmIntent: true,
        llmConfianca: true,
        criadoEm: true,
      },
    });
    return rows;
  } catch (err) {
    console.warn('[metrics] falha lerAmostrasNaoEntendi:', (err as Error).message);
    return [];
  }
}
