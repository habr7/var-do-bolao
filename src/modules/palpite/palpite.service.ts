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

/**
 * Busca em quais bolaes do usuario existe rodada ABERTA com o jogo
 * informado (matching tolerante a acento/case/parcial). Retorna lista
 * com bolaoId, rodadaId, jogoId, nomeBolao, nomeBolaoCodigo pra UI
 * decidir o que fazer (auto-registrar se 1 so, perguntar se varios).
 *
 * Usado pelo fluxo de palpite inline em IDLE: usuario manda
 * "Brasil 2x1 Marrocos" e queremos achar onde registrar.
 */
export async function buscarBoloesComJogo(
  usuarioId: string,
  timeCasa: string,
  timeVisitante: string,
): Promise<Array<{
  bolaoId: string;
  bolaoNome: string;
  bolaoCodigo: string;
  rodadaId: string;
  rodadaNumero: number;
  jogoId: string;
  jogoTimeCasa: string;
  jogoTimeVisitante: string;
}>> {
  // Pega bolaes em que usuario participa (admin OU participante)
  const participacoes = await prisma.participacao.findMany({
    where: { usuarioId },
    select: { bolaoId: true },
  });
  const adminados = await prisma.bolao.findMany({
    where: { adminId: usuarioId, status: 'ATIVO' },
    select: { id: true },
  });

  const bolaoIds = new Set<string>([
    ...participacoes.map((p) => p.bolaoId),
    ...adminados.map((a) => a.id),
  ]);
  if (bolaoIds.size === 0) return [];

  // Rodadas ABERTAS desses bolaes, com jogos AGENDADO/AO_VIVO
  const rodadas = await prisma.rodada.findMany({
    where: {
      bolaoId: { in: [...bolaoIds] },
      status: 'ABERTA',
    },
    include: {
      bolao: true,
      jogos: {
        where: { status: { in: ['AGENDADO', 'AO_VIVO'] } },
      },
    },
  });

  const resultado: Array<ReturnType<typeof buildItem>> = [];
  for (const rodada of rodadas) {
    const jogo = encontrarJogo(rodada.jogos, timeCasa, timeVisitante);
    if (jogo) {
      resultado.push(buildItem(rodada, jogo));
    }
  }
  return resultado;
}

function buildItem(
  rodada: { id: string; numero: number; bolao: { id: string; nome: string; codigo: string } },
  jogo: { id: string; timeCasa: string; timeVisitante: string },
) {
  return {
    bolaoId: rodada.bolao.id,
    bolaoNome: rodada.bolao.nome,
    bolaoCodigo: rodada.bolao.codigo,
    rodadaId: rodada.id,
    rodadaNumero: rodada.numero,
    jogoId: jogo.id,
    jogoTimeCasa: jogo.timeCasa,
    jogoTimeVisitante: jogo.timeVisitante,
  };
}

// ============================================================
// ISSUE-012: apagar palpite individual
// ============================================================

/**
 * Apaga um palpite especifico (PalpiteJogo) pelo id. Valida:
 *   - palpite pertence ao usuarioId (seguranca)
 *   - jogo ainda nao iniciou (status AGENDADO)
 *
 * Se o palpite-mae (Palpite) ficar vazio depois da delecao, tambem
 * remove ele.
 */
export async function apagarPalpiteJogo(palpiteJogoId: string, usuarioId: string) {
  const pj = await prisma.palpiteJogo.findUnique({
    where: { id: palpiteJogoId },
    include: { palpite: true, jogo: true },
  });
  if (!pj) throw new Error('Palpite nao encontrado.');
  if (pj.palpite.usuarioId !== usuarioId) {
    throw new Error('Esse palpite nao eh seu.');
  }
  if (pj.jogo.status !== 'AGENDADO') {
    throw new Error('Esse jogo ja comecou — nao da pra apagar mais.');
  }

  await prisma.palpiteJogo.delete({ where: { id: palpiteJogoId } });

  // Se o palpite-mae ficou vazio, remove ele tambem (limpa registro orfao)
  const restantes = await prisma.palpiteJogo.count({ where: { palpiteId: pj.palpiteId } });
  if (restantes === 0) {
    await prisma.palpite.delete({ where: { id: pj.palpiteId } });
  }
  return { ok: true };
}

// ============================================================
// ISSUE-015: registrar palpite em TODOS os boloes com mesmo jogo aberto
// ============================================================

/**
 * Variante do registrarPalpiteEmRodada que, dado timeCasa+timeVisitante,
 * encontra TODAS as rodadas abertas em todos os boloes do usuario que
 * tenham esse jogo e registra em todas (uma transacao por bolao —
 * best-effort).
 *
 * Retorna lista de boloes onde registrou + lista de erros (se algum
 * bolao falhou). Caller decide como reportar.
 */
export async function registrarPalpiteEmTodosBoloes(input: {
  usuarioId: string;
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number;
  golsVisitante: number;
}): Promise<{
  registrados: Array<{ bolaoNome: string }>;
  erros: Array<{ bolaoNome: string; motivo: string }>;
}> {
  const matches = await buscarBoloesComJogo(input.usuarioId, input.timeCasa, input.timeVisitante);
  const registrados: Array<{ bolaoNome: string }> = [];
  const erros: Array<{ bolaoNome: string; motivo: string }> = [];

  for (const m of matches) {
    try {
      await registrarPalpiteEmRodada({
        usuarioId: input.usuarioId,
        rodadaId: m.rodadaId,
        timeCasa: input.timeCasa,
        timeVisitante: input.timeVisitante,
        golsCasa: input.golsCasa,
        golsVisitante: input.golsVisitante,
      });
      registrados.push({ bolaoNome: m.bolaoNome });
    } catch (err) {
      erros.push({ bolaoNome: m.bolaoNome, motivo: (err as Error).message });
    }
  }

  return { registrados, erros };
}
