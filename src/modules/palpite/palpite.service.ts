import { prisma } from '../../config/database.js';
import * as palpiteRepo from './palpite.repository.js';
import { normalizeTeamName } from '../../utils/validators.js';

interface RegistrarPalpiteInput {
  usuarioId: string;
  rodadaId: string;
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number;
  golsVisitante: number;
}

/**
 * Registra um palpite dentro de uma rodada ja conhecida (chamada pelo
 * fluxo PALPITANDO do router, onde a FSM guarda o rodadaId).
 */
export async function registrarPalpiteEmRodada(input: RegistrarPalpiteInput) {
  const rodada = await prisma.rodada.findUnique({
    where: { id: input.rodadaId },
    include: { jogos: true, bolao: true },
  });
  if (!rodada) throw new Error('Rodada nao encontrada.');
  if (new Date() > rodada.dataFechamento) {
    throw new Error('rodada fechada');
  }

  // Verifica se usuario participa do bolao
  const participa = await prisma.participacao.findUnique({
    where: { usuarioId_bolaoId: { usuarioId: input.usuarioId, bolaoId: rodada.bolaoId } },
  });
  if (!participa) throw new Error('nao participa deste bolao');

  // Encontra o jogo por nome (fuzzy)
  const jogo = encontrarJogo(rodada.jogos, input.timeCasa, input.timeVisitante);
  if (!jogo) throw new Error(`jogo nao encontrado: ${input.timeCasa} x ${input.timeVisitante}`);

  const palpite = await palpiteRepo.getOrCreatePalpite(input.usuarioId, rodada.id);
  await palpiteRepo.registrarPalpiteJogo(palpite.id, jogo.id, input.golsCasa, input.golsVisitante);

  return { jogoId: jogo.id, rodadaId: rodada.id };
}

export async function statusPalpitesRodada(usuarioId: string, rodadaId: string) {
  const rodada = await prisma.rodada.findUnique({ where: { id: rodadaId }, include: { jogos: true } });
  if (!rodada) return { total: 0, palpitados: 0, faltam: 0, completo: true };

  const palpite = await palpiteRepo.buscarPalpitesUsuarioRodada(usuarioId, rodadaId);
  const palpitados = palpite?.jogos.length ?? 0;
  const total = rodada.jogos.length;
  const faltam = Math.max(0, total - palpitados);

  return { total, palpitados, faltam, completo: faltam === 0 };
}

export async function buscarMeusPalpitesRodadaMaisRecente(usuarioId: string, bolaoId: string) {
  const rodada = await prisma.rodada.findFirst({
    where: { bolaoId },
    orderBy: { numero: 'desc' },
  });
  if (!rodada) return null;

  return palpiteRepo.buscarPalpitesUsuarioRodada(usuarioId, rodada.id);
}

function encontrarJogo<T extends { timeCasa: string; timeVisitante: string }>(
  jogos: T[],
  timeCasa: string,
  timeVisitante: string,
): T | undefined {
  const normCasa = normalizeTeamName(timeCasa);
  const normVis = normalizeTeamName(timeVisitante);

  return jogos.find((j) => {
    const jc = normalizeTeamName(j.timeCasa);
    const jv = normalizeTeamName(j.timeVisitante);
    return (jc.includes(normCasa) || normCasa.includes(jc)) && (jv.includes(normVis) || normVis.includes(jv));
  });
}
