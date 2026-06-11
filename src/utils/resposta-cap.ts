import { redis } from '../config/redis.js';
import { createHash } from 'node:crypto';

/**
 * v3.18.0 — Anti-loop reativo (proteção contra ping-pong com auto-reply
 * do WhatsApp Business).
 *
 * Caso real (Lucas 11/06): 8 respostas do bot em ~60s. Auto-reply
 * disparava cada vez que o bot respondia.
 *
 * Cobre 2 camadas das 4 (1=detector de auto-reply, 2=patterns
 * restritos, 3=rate-limit, 4=repetida):
 *
 *   3. Rate-limit por waId: máximo 8 respostas/60s. Acima, bot
 *      silencia + Redis flag `silenciado:` TTL 5min pra evitar
 *      reentrada imediata. 8 = exato número do print do Lucas.
 *
 *   4. Detector de mensagem repetida idêntica: se a MESMA string chega
 *      2+ vezes em <60s, silencia. Hash SHA-1 truncado.
 *
 * Aplicado em `handleIncomingMessage` ANTES do parser. Não afeta
 * jobs push (que têm cap separado em `aviso-cap.ts`).
 */

const JANELA_SEGUNDOS = 60;
const CAP_RESPOSTAS_JANELA = 8;
const TTL_SILENCIADO_SEGUNDOS = 5 * 60;
const TTL_HASH_SEGUNDOS = 60;

function hashCurto(texto: string): string {
  return createHash('sha1').update(texto).digest('hex').slice(0, 16);
}

function bucketAtual(): string {
  // Bucket de 60s; o contador rola naturalmente em janela deslizante
  // grosseira (chave muda a cada 60s, TTL 90s).
  return String(Math.floor(Date.now() / 1000 / JANELA_SEGUNDOS));
}

/**
 * Resultado da verificação anti-loop.
 *
 * Quando `permitir=false`, `motivo` explica por quê (pra log).
 * Quando `permitir=true`, o caller pode prosseguir mas DEVE chamar
 * `registrarResposta` se acabar respondendo o user — pra que a próxima
 * mensagem entre na conta.
 */
export interface VerificacaoAntiLoop {
  permitir: boolean;
  motivo?: 'silenciado' | 'cap_60s' | 'repetida';
  detalhe?: string;
}

/**
 * Camada 3 + 4: checa se o bot pode responder esse waId/texto agora.
 *
 * Ordem de checagem:
 *   a) Flag `silenciado:{waId}` ativa (de bloqueio anterior) → não
 *   b) Cap atingido (≥ 8 respostas no último bucket) → não, e seta
 *      flag pra silenciar 5min
 *   c) Mensagem repetida idêntica em <60s → não
 */
export async function verificarAntiLoop(
  waId: string,
  texto: string,
): Promise<VerificacaoAntiLoop> {
  // (a) Já está silenciado
  if (await redis.get(`silenciado:${waId}`)) {
    return { permitir: false, motivo: 'silenciado' };
  }

  // (b) Cap por janela
  const keyCount = `resposta:count:${waId}:${bucketAtual()}`;
  const atual = parseInt((await redis.get(keyCount)) ?? '0', 10);
  if (atual >= CAP_RESPOSTAS_JANELA) {
    // Bloqueia +5min
    await redis.set(`silenciado:${waId}`, '1', 'EX', TTL_SILENCIADO_SEGUNDOS);
    return { permitir: false, motivo: 'cap_60s', detalhe: `msgs=${atual}` };
  }

  // (c) Repetida
  const hash = hashCurto(texto.trim());
  const keyHash = `resposta:lasthash:${waId}`;
  const ultimoHash = await redis.get(keyHash);
  if (ultimoHash === hash) {
    return { permitir: false, motivo: 'repetida' };
  }

  return { permitir: true };
}

/**
 * Marca que o bot respondeu o user. Chamar DEPOIS de enviar (não antes —
 * se sendText falhar, não conta na cota).
 *
 * O `texto` é o texto da MENSAGEM RECEBIDA do user (não o que o bot
 * mandou). É o que vai ser hash-comparado na próxima chamada de
 * `verificarAntiLoop`.
 */
export async function registrarResposta(waId: string, texto: string): Promise<void> {
  const keyCount = `resposta:count:${waId}:${bucketAtual()}`;
  const novo = await redis.incr(keyCount);
  if (novo === 1) {
    await redis.expire(keyCount, JANELA_SEGUNDOS + 30); // 90s, dá folga
  }
  const keyHash = `resposta:lasthash:${waId}`;
  await redis.set(keyHash, hashCurto(texto.trim()), 'EX', TTL_HASH_SEGUNDOS);
}
