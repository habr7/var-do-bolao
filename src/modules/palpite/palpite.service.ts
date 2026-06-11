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
 * Resultado do registro/edição de palpite. `anterior` vem preenchido
 * quando o palpite JÁ existia e foi substituído (UPDATE no upsert) —
 * caller usa pra dar UX "era X, virou Y" em edições. Quando é palpite
 * novo (CREATE), `anterior` vem null.
 */
export interface RegistrarPalpiteResult {
  jogoId: string;
  rodadaId: string;
  jogoTimeCasa: string;
  jogoTimeVisitante: string;
  anterior: { golsCasa: number; golsVisitante: number } | null;
}

/**
 * Registra um palpite dentro de uma rodada ja conhecida (chamada pelo
 * fluxo PALPITANDO do router, onde a FSM guarda o rodadaId).
 *
 * v3.7.0: agora também rejeita palpite em jogo individual que já começou
 * ou já foi disputado — antes só checava a `rodada.dataFechamento`,
 * o que na Copa (rodada única com 72 jogos) deixava editar palpite
 * de jogo que já tinha rolado. E devolve o `anterior` (placar antigo
 * substituído) pra caller mostrar a substituição.
 */
export async function registrarPalpiteEmRodada(
  input: RegistrarPalpiteInput,
): Promise<RegistrarPalpiteResult> {
  const rodada = await prisma.rodada.findUnique({
    where: { id: input.rodadaId },
    include: { jogos: true, bolao: true },
  });
  if (!rodada) throw new Error('Rodada nao encontrada.');
  // v3.21.0 (bug R. 11/06 16:25 — Copa rolando): antes este check
  // bloqueava palpites quando `new Date() > rodada.dataFechamento`,
  // mas `dataFechamento` é setado em `rodada.service.ts:32` como o
  // kickoff do PRIMEIRO jogo da rodada. Pra Copa 2026 (1 rodada com
  // 72 jogos em 15 dias), isso travava TUDO após o 1º jogo —
  // inclusive os 71 jogos que ainda não começaram.
  //
  // A trava correta é POR JOGO INDIVIDUAL (linhas 63-68) que já existe
  // desde a v3.7.0. Aqui mantemos apenas defesa em profundidade contra
  // rodada FINALIZADA (todos os jogos terminaram — não faz sentido
  // aceitar palpite novo). `rodada.status` é setado pra FINALIZADA em
  // `rodada.repository.ts:finalizarRodada` quando o pipeline detecta
  // que todos os jogos viraram FINALIZADO/ADIADO/CANCELADO.
  if (rodada.status === 'FINALIZADA') {
    throw new Error('rodada finalizada');
  }

  // Verifica se usuario participa do bolao
  const participa = await prisma.participacao.findUnique({
    where: { usuarioId_bolaoId: { usuarioId: input.usuarioId, bolaoId: rodada.bolaoId } },
  });
  if (!participa) throw new Error('nao participa deste bolao');

  // Encontra o jogo por nome (fuzzy)
  const jogo = encontrarJogo(rodada.jogos, input.timeCasa, input.timeVisitante);
  if (!jogo) throw new Error(`jogo nao encontrado: ${input.timeCasa} x ${input.timeVisitante}`);

  // v3.7.0: trava palpite em jogo que já começou / acabou. Tolerância de
  // 0min — assim que o relógio bate o kickoff (jogo.dataHora), trava.
  // Status AGENDADO continua liberado; AO_VIVO/FINALIZADO/ADIADO/CANCELADO travam.
  if (jogo.status !== 'AGENDADO') {
    throw new Error(`jogo ${input.timeCasa} x ${input.timeVisitante} ja iniciou/terminou`);
  }
  if (new Date() >= jogo.dataHora) {
    throw new Error(`jogo ${input.timeCasa} x ${input.timeVisitante} ja comecou`);
  }

  // Busca palpite anterior PRA ESTE JOGO antes do upsert — pra devolver
  // ao caller (UX "era X, virou Y" em edições).
  const palpiteAtual = await palpiteRepo.buscarPalpitesUsuarioRodada(input.usuarioId, rodada.id);
  const palpiteJogoAnterior = palpiteAtual?.jogos.find((pj) => pj.jogoId === jogo.id) ?? null;

  const palpite = await palpiteRepo.getOrCreatePalpite(input.usuarioId, rodada.id);
  await palpiteRepo.registrarPalpiteJogo(palpite.id, jogo.id, input.golsCasa, input.golsVisitante);

  return {
    jogoId: jogo.id,
    rodadaId: rodada.id,
    jogoTimeCasa: jogo.timeCasa,
    jogoTimeVisitante: jogo.timeVisitante,
    anterior: palpiteJogoAnterior
      ? { golsCasa: palpiteJogoAnterior.golsCasa, golsVisitante: palpiteJogoAnterior.golsVisitante }
      : null,
  };
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

/**
 * v3.12.0 — variante PLURAL: registra uma LISTA de palpites em TODOS
 * os bolões abertos do user em que o jogo correspondente exista.
 *
 * Motivação real (Bruna 10/06): user participava de 2 bolões com mesma
 * rodada de amistosos e tinha que mandar a lista de 10 palpites 2x
 * (uma por bolão). 36 mensagens pra registrar 20 palpites — atrito
 * absurdo.
 *
 * Estratégia (robustez):
 * 1. Pra cada PALPITE, busca quais bolões abertos do user têm o jogo
 *    (`buscarBoloesComJogo` — já existe).
 * 2. Agrupa por bolão, pra reportar consolidado.
 * 3. Pra cada (bolão, palpite), tenta `registrarPalpiteEmRodada` que
 *    já é IDEMPOTENTE via UPSERT em `(palpiteId, jogoId)` no
 *    repository — reenvio = sobrescrita silenciosa, sem duplicar.
 * 4. Retry simples (1 tentativa extra com 200ms de backoff) se erro
 *    parecer transitório (conexão Prisma). Erros de domínio
 *    ("jogo ja comecou") NÃO são retentados.
 *
 * Retorna relatório por bolão com:
 * - `registrados`: quantos palpites do lote foram salvos
 * - `naoAplicaveis`: jogos do lote que não existem nesse bolão
 *   (NÃO é erro — é estado normal, ex: amistoso só num dos 2 bolões)
 * - `erros`: falhas que sobreviveram ao retry, com jogo e motivo
 */
export async function registrarPalpitesEmTodosBoloes(input: {
  usuarioId: string;
  palpites: Array<{
    timeCasa: string;
    timeVisitante: string;
    golsCasa: number;
    golsVisitante: number;
  }>;
}): Promise<{
  porBolao: Array<{
    bolaoId: string;
    bolaoNome: string;
    registrados: number;
    naoAplicaveis: number;
    erros: Array<{ jogo: string; motivo: string }>;
  }>;
  totalPalpitesDoLote: number;
}> {
  // 1) Pra cada palpite, descobre em quais bolões ele tem match
  const matchesPorPalpite: Array<{
    palpite: typeof input.palpites[number];
    matches: Awaited<ReturnType<typeof buscarBoloesComJogo>>;
  }> = [];
  for (const p of input.palpites) {
    const matches = await buscarBoloesComJogo(input.usuarioId, p.timeCasa, p.timeVisitante);
    matchesPorPalpite.push({ palpite: p, matches });
  }

  // 2) Inverte: agrupa por bolão (quais palpites desse lote vão pra cada bolão)
  type Agg = {
    bolaoNome: string;
    rodadaId: string;
    porPalpite: Array<{
      palpite: typeof input.palpites[number];
      jogoLabel: string;
    }>;
  };
  const porBolaoMap = new Map<string, Agg>();

  for (const { palpite, matches } of matchesPorPalpite) {
    for (const m of matches) {
      if (!porBolaoMap.has(m.bolaoId)) {
        porBolaoMap.set(m.bolaoId, {
          bolaoNome: m.bolaoNome,
          rodadaId: m.rodadaId,
          porPalpite: [],
        });
      }
      porBolaoMap.get(m.bolaoId)!.porPalpite.push({
        palpite,
        jogoLabel: `${palpite.timeCasa} x ${palpite.timeVisitante}`,
      });
    }
  }

  // 3) Registra em PARALELO por bolão (cada bolão é independente).
  //    Dentro de cada bolão, registra sequencial pra não competir transações.
  const totalPalpites = input.palpites.length;
  const resultados = await Promise.all(
    [...porBolaoMap.entries()].map(async ([bolaoId, agg]) => {
      const errosLocal: Array<{ jogo: string; motivo: string }> = [];
      let registrados = 0;
      for (const item of agg.porPalpite) {
        try {
          await registrarComRetry({
            usuarioId: input.usuarioId,
            rodadaId: agg.rodadaId,
            ...item.palpite,
          });
          registrados++;
        } catch (err) {
          errosLocal.push({ jogo: item.jogoLabel, motivo: (err as Error).message });
        }
      }
      return {
        bolaoId,
        bolaoNome: agg.bolaoNome,
        registrados,
        naoAplicaveis: totalPalpites - agg.porPalpite.length,
        erros: errosLocal,
      };
    }),
  );

  // Ordem estável: por nome de bolão
  resultados.sort((a, b) => a.bolaoNome.localeCompare(b.bolaoNome));

  return { porBolao: resultados, totalPalpitesDoLote: totalPalpites };
}

/**
 * v3.13.0 — corrige UM palpite (1 jogo) em TODOS os bolões abertos do
 * user que tenham esse jogo. Análogo a `registrarPalpiteEmTodosBoloes`,
 * mas semanticamente é uma CORREÇÃO de placar via UPSERT (mesmo padrão
 * idempotente do registro).
 *
 * Caso real: user em 2 bolões manda "corrigir Brasil 3x1 Marrocos" e
 * escolhe "TODOS" — bot atualiza o placar nos 2 bolões de uma vez.
 *
 * Retorno tem mesma forma do registrarPalpiteEmTodosBoloes pra
 * consistência de relatório.
 */
export async function corrigirPalpiteEmTodosBoloes(input: {
  usuarioId: string;
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number;
  golsVisitante: number;
}): Promise<{
  registrados: Array<{ bolaoNome: string }>;
  erros: Array<{ bolaoNome: string; motivo: string }>;
}> {
  // Reusa exatamente a mesma lógica do registro singular — UPSERT
  // garante que "registrar" e "corrigir" são operações idênticas no
  // banco (não há diferença semântica: o estado final é o mesmo).
  return registrarPalpiteEmTodosBoloes(input);
}

/**
 * v3.12.0 — wrapper de `registrarPalpiteEmRodada` com 1 retry de 200ms.
 * Só retenta se o erro parecer transitório (string não menciona
 * domínio "ja comecou" / "ja terminou" / "nao encontrado"). UPSERT
 * garante que o retry não duplica palpite.
 */
async function registrarComRetry(input: Parameters<typeof registrarPalpiteEmRodada>[0]): Promise<void> {
  try {
    await registrarPalpiteEmRodada(input);
    return;
  } catch (err) {
    const msg = (err as Error).message.toLowerCase();
    const ehDominio =
      msg.includes('ja comecou') ||
      msg.includes('ja terminou') ||
      msg.includes('nao encontrado') ||
      msg.includes('não encontrado') ||
      msg.includes('placar') ||
      msg.includes('rodada fechada') ||
      msg.includes('rodada finalizada') || // v3.21.0
      msg.includes('ja iniciou') ||
      msg.includes('ja terminou');
    if (ehDominio) throw err;
    // Erro transitório — 1 retry
    await new Promise((r) => setTimeout(r, 200));
    await registrarPalpiteEmRodada(input);
  }
}
