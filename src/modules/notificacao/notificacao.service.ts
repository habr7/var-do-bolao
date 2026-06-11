import { sendText } from '../../whatsapp/evolution.client.js';
import { env } from '../../config/env.js';
import { formatRanking, type RankingEntry } from '../../utils/formatting.js';

/**
 * Envia um texto em DM para um wa_id.
 */
export async function notificarUsuario(waId: string, texto: string) {
  try {
    await sendText({ to: waId, text: texto });
  } catch (error) {
    console.error(`[notificacao] falha ao enviar para ${waId}:`, (error as Error).message);
  }
}

/**
 * Envia o mesmo texto para varios wa_ids. Falhas individuais sao logadas mas
 * nao interrompem o loop.
 */
export async function notificarEmMassa(waIds: string[], texto: string) {
  for (const waId of waIds) {
    await notificarUsuario(waId, texto);
  }
}

/**
 * v3.26.0 — Envio em massa COM throttle (delay entre envios) pra não tomar
 * ban/rate-limit do WhatsApp/Evolution num broadcast pra muita gente.
 * Falhas individuais são contadas e logadas, não interrompem o loop.
 * Em DRY_RUN_WHATSAPP o delay é pulado (testes/sim não dormem N segundos).
 */
export async function notificarEmMassaThrottled(
  waIds: string[],
  texto: string,
  delayMs = 0,
): Promise<{ enviados: number; falhas: number }> {
  let enviados = 0;
  let falhas = 0;
  const pularDelay = env.DRY_RUN_WHATSAPP || delayMs <= 0;
  for (let i = 0; i < waIds.length; i++) {
    try {
      await sendText({ to: waIds[i], text: texto });
      enviados++;
    } catch (error) {
      falhas++;
      console.error(`[notificacao] falha no broadcast para ${waIds[i]}:`, (error as Error).message);
    }
    if (!pularDelay && i < waIds.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return { enviados, falhas };
}

export async function enviarRankingParaParticipantes(params: {
  waIds: string[];
  nomeBolao: string;
  rodada: number;
  campeonato: string;
  ranking: RankingEntry[];
}) {
  const texto = formatRanking(params.nomeBolao, params.rodada, params.campeonato, params.ranking);
  await notificarEmMassa(params.waIds, texto);
}
