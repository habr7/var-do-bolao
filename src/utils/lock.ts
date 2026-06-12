import { redis } from '../config/redis.js';

/**
 * v3.28.0 — Lock distribuído simples pra evitar execução sobreposta de
 * jobs (crons defasados ou múltiplas instâncias). Usa `SET NX` atômico —
 * mesmo padrão do `broadcast.ts`.
 *
 * Se o lock já está tomado, `comLockJob` NÃO executa `fn` e retorna false
 * (o tick é pulado — o próximo cron pega). O lock tem TTL de segurança
 * (default 5min) pra nunca ficar preso se o processo morrer com ele.
 */
export async function comLockJob(
  nome: string,
  fn: () => Promise<void>,
  ttlSegundos = 300,
): Promise<boolean> {
  const chave = `lock:job:${nome}`;
  const ok = await redis.set(chave, String(Date.now()), 'EX', ttlSegundos, 'NX');
  if (ok !== 'OK') {
    console.log(`[lock] ${nome} já está rodando — tick pulado`);
    return false;
  }
  try {
    await fn();
  } finally {
    await redis.del(chave);
  }
  return true;
}
