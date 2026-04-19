import { sendText } from '../../whatsapp/meta.client.js';
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
