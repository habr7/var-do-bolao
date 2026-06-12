import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * v3.17.0 — Cap diário de avisos por usuário, cross-job.
 *
 * Problema motivador (caso Camila 11/06): em 3.5h o bot mandou 3 mensagens
 * (bom-dia 10:00 + palpite-call 13:00 + reminder 13:30). Risco real:
 *   - hoje (Evolution + número pessoal): pode levar a reportar como
 *     spam → derruba o número
 *   - amanhã (Meta Cloud API oficial): cada mensagem business-initiated
 *     fora de janela de 24h custa template (~$0.008-0.0625 USD).
 *     1000 users × 3 msgs × 30d × $0.008 = ~$720/mês
 *
 * Solução: cap absoluto de N msgs/dia por user (default 2),
 * compartilhado entre TODOS os jobs de aviso (bom-dia, palpite-call,
 * reminders). Configurável via `MAX_AVISOS_DIA`.
 *
 * Não substitui a flag `aviso_jogo:{waId}` TTL 24h (cooldown
 * cross-job da v3.13.0) — complementa: a flag bloqueia "outro aviso
 * de jogo hoje" depois do 1º. O cap aqui é a defesa de profundidade
 * pra caso a flag falhe (ex: TTL Redis perdido por restart).
 */

/** Chave Redis do contador diário (YYYY-MM-DD em BRT pra alinhar com user). */
function chaveContador(waId: string): string {
  const d = new Date();
  // BRT (UTC-3): YYYY-MM-DD do "dia do usuário"
  const brtMillis = d.getTime() - 3 * 3600 * 1000;
  const brt = new Date(brtMillis);
  const yyyy = brt.getUTCFullYear();
  const mm = String(brt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(brt.getUTCDate()).padStart(2, '0');
  return `avisos:count:${waId}:${yyyy}-${mm}-${dd}`;
}

/**
 * Retorna true se o usuário ainda tem cota de aviso disponível hoje.
 * NÃO consome — chame `registrarAvisoEnviado` após enviar.
 */
export async function podeEnviarAvisoHoje(waId: string): Promise<boolean> {
  const v = await redis.get(chaveContador(waId));
  const atual = v ? parseInt(v, 10) : 0;
  return atual < env.MAX_AVISOS_DIA;
}

/**
 * Incrementa o contador de avisos do user. TTL de 30h cobre fuso e
 * permite o contador "rodar" naturalmente sem cron de limpeza.
 *
 * Idealmente o caller chama isso DEPOIS de `sendText` ter sucesso —
 * se a Evolution/Meta falhar, não consome cota.
 */
export async function registrarAvisoEnviado(waId: string): Promise<void> {
  const key = chaveContador(waId);
  const novo = await redis.incr(key);
  if (novo === 1) {
    await redis.expire(key, 30 * 3600);
  }
}

/**
 * v3.28.0 — Reserva uma cota de aviso de forma ATÔMICA (corrige TOCTOU:
 * antes `podeEnviarAvisoHoje` (GET) + `registrarAvisoEnviado` (INCR) não
 * eram atômicos, então 2 jobs no mesmo tick podiam ambos passar no check).
 *
 * Faz `INCR` primeiro e compara o retorno: se passou do cap, devolve a
 * cota (`DECR`) e retorna false. O caller deve chamar `devolverCotaAviso`
 * se o envio falhar, pra não consumir cota à toa.
 */
export async function reservarCotaAviso(waId: string): Promise<boolean> {
  const key = chaveContador(waId);
  const novo = await redis.incr(key);
  if (novo === 1) {
    await redis.expire(key, 30 * 3600);
  }
  if (novo > env.MAX_AVISOS_DIA) {
    await redis.decr(key); // estourou o cap — devolve e não envia
    return false;
  }
  return true;
}

/** Devolve uma cota reservada (rollback quando o envio falha). */
export async function devolverCotaAviso(waId: string): Promise<void> {
  await redis.decr(chaveContador(waId));
}
