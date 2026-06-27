import { jogoEstaRolandoPorHorario } from '../utils/jogo-status.js';
import { resultadoEmoji } from '../utils/football.terms.js';
import { formatarHoraBR } from '../utils/datetime.js';

/**
 * v3.33.0 — Renderiza a linha de STATUS/RESULTADO de um palpite num jogo,
 * decidindo o rótulo pelo STATUS do jogo (não pela presença de placar).
 *
 * Bug grave corrigido (caso Humberto 12/06 00:22): o "meus palpites"
 * testava `golsCasa != null` ANTES do status, então um jogo AO_VIVO com
 * placar PARCIAL (a FIFA grava 0x1 ao vivo) era mostrado como
 * "oficial: 0x1 ❌ (0 pts)" — como se fosse final e o usuário tivesse
 * zerado. Na verdade o jogo ainda rolava e nem foi pontuado (o gate de
 * pontuação só pontua FINALIZADO). Resultado: ❌ + "0 pts" enganosos num
 * jogo que ainda podia virar 3 ou 10 pts.
 *
 * Regra:
 *   - FINALIZADO + placar:
 *       - rodada já calculada  → "oficial: X 🔥 (N pts)"
 *       - ainda calculando      → "oficial: X — ⏳ calculando pontos…"
 *   - rolando (AO_VIVO ou kickoff passou e não finalizou):
 *       - com placar parcial    → "🔴 ao vivo: parcial X — pontua no apito"
 *       - sem placar            → "🔴 ao vivo — pontua no apito"
 *   - ADIADO / CANCELADO        → rótulo próprio
 *   - senão                     → "ainda não rolou (HH:MM)"
 */
export interface JogoStatusResultado {
  status: string;
  golsCasa: number | null;
  golsVisitante: number | null;
  dataHora: Date;
  // Mata-mata: jogo decidido nos pênaltis (placar segue 90'+prorrogação).
  decididoNosPenaltis?: boolean | null;
}

export function montarStatusResultado(
  jogo: JogoStatusResultado,
  pontosObtidos: number,
  rodadaCalculada: boolean,
  agora: Date = new Date(),
  // Mata-mata: bônus de classificado (aditivo ao placar). 0 em grupos.
  bonusObtido = 0,
): string {
  const temPlacar = jogo.golsCasa !== null && jogo.golsVisitante !== null;
  const placar = temPlacar ? `${jogo.golsCasa}x${jogo.golsVisitante}` : null;

  if (jogo.status === 'FINALIZADO' && placar) {
    const pen = jogo.decididoNosPenaltis ? ' _(nos pênaltis)_' : '';
    const totalPts = pontosObtidos + bonusObtido;
    const detalhe = bonusObtido > 0 ? `${pontosObtidos}+${bonusObtido} bônus = ${totalPts}` : `${pontosObtidos}`;
    return rodadaCalculada
      ? `oficial: *${placar}*${pen} ${resultadoEmoji(totalPts)} (${detalhe} pts)`
      : `oficial: *${placar}*${pen} — ⏳ _calculando pontos…_`;
  }

  if (jogo.status === 'ADIADO') return `_jogo adiado_`;
  if (jogo.status === 'CANCELADO') return `_jogo cancelado_`;

  // Rolando: status explícito OU kickoff já passou e ainda não finalizou.
  if (jogo.status === 'AO_VIVO' || jogoEstaRolandoPorHorario(jogo, agora)) {
    return placar
      ? `🔴 _ao vivo: parcial ${placar} — pontua no apito final_`
      : `🔴 _ao vivo — pontua no apito final_`;
  }

  return `_ainda não rolou (${formatarHoraBR(jogo.dataHora)})_`;
}
