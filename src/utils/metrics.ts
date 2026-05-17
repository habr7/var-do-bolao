import { redis } from '../config/redis.js';

/**
 * Metricas simples baseadas em Redis (hashes por dia + lista de amostras
 * de mensagens nao roteadas). ISSUE-008.
 *
 * Estrutura:
 *   metrics:YYYY-MM-DD              hash  { nome: contador, ... }
 *   metrics:YYYY-MM-DD:nao-entendi  list  amostras JSON (top 500)
 *
 * TTL 30 dias. Sem dashboard ainda — leitura via endpoint admin futuro
 * (ISSUE-043) ou direto via redis-cli.
 *
 * IMPORTANTE: todas as funcoes sao FIRE-AND-FORGET / best-effort. Se o
 * Redis estiver fora, o caller nao quebra — so loga warning. Metricas
 * NUNCA podem segurar o handler principal.
 */

const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 dias

function chaveDoDia(prefix = 'metrics'): string {
  // YYYY-MM-DD em UTC. Pra metricas internas, fuso nao importa muito.
  return `${prefix}:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Incrementa um contador nomeado pra o dia atual.
 *
 * Convencoes de nome (use estes prefixos):
 *   msg.total                      — toda mensagem entrando
 *   msg.nao_entendi                — caiu no "nao entendi" final
 *   intent.<NOME>                  — regex casou esta intent (camada 1)
 *   llm.intent.classifier.hit      — LLM intent classifier acertou (camada 2)
 *   llm.intent.classifier.miss     — LLM intent classifier sem resposta
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

/**
 * Guarda uma amostra de mensagem nao entendida (texto + state) pro dia.
 * Mantem ate 500 amostras por dia (LPUSH + LTRIM). Util pra revisar
 * manualmente toda semana e migrar pra regex/handler novo.
 */
export async function registrarMsgNaoEntendida(
  text: string,
  state: string,
  motivo: 'regex_fail' | 'llm_fail' | 'final_fallback' = 'final_fallback',
): Promise<void> {
  try {
    const key = `${chaveDoDia()}:nao-entendi`;
    const amostra = JSON.stringify({
      text: text.slice(0, 200),
      state,
      motivo,
      ts: Date.now(),
    });
    await redis.lpush(key, amostra);
    await redis.ltrim(key, 0, 499);
    await redis.expire(key, TTL_SECONDS);
  } catch (err) {
    console.warn('[metrics] falha registrarMsgNaoEntendida:', (err as Error).message);
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
 * Le as ultimas N amostras de mensagens nao entendidas de um dia.
 */
export async function lerAmostrasNaoEntendi(
  dia: string,
  limit = 100,
): Promise<Array<{ text: string; state: string; motivo: string; ts: number }>> {
  try {
    const raws = await redis.lrange(`metrics:${dia}:nao-entendi`, 0, limit - 1);
    return raws
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('[metrics] falha lerAmostrasNaoEntendi:', (err as Error).message);
    return [];
  }
}
