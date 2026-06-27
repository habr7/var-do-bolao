import type { PrismaClient, FaseTorneio } from '@prisma/client';
import {
  FASES_MATA_MATA,
  BRACKET_2026,
  rotuloAlimentador,
  ehTimePlaceholder,
} from '../../data/bracket-2026.js';
import type { FixtureMataMata } from './fifa.fetcher.js';

/**
 * Sincroniza os jogos de mata-mata de TODOS os bolões ativos a partir dos
 * fixtures da FIFA (api.fifa.com). Fonte da verdade dos confrontos: times,
 * datas (UTC), placar (90'+prorrogação) e classificado (do Winner, inclusive
 * pênaltis). Substitui o seed manual + destrava o avanço da chave sozinho.
 *
 * Regras (decididas com o dono):
 *   - TIMES: enquanto a rodada está FECHADA, preenche/corrige pela FIFA; quando
 *     a rodada ABRE, trava o time real (não sobrescreve mais — protege palpites).
 *     Nunca rebaixa um time real pra placeholder.
 *   - DATA: sempre espelha a FIFA (kickoff pode mudar até o jogo).
 *   - RESULTADO/CLASSIFICADO: sempre espelha; ao mudar, reseta `Palpite.calculado`
 *     pra forçar recálculo (placar + bônus).
 *   - ABRE a rodada quando ela tem ≥1 jogo com os dois times reais.
 *
 * Idempotente: só escreve quando algo muda. Roda dentro do tick do fetch-results.
 */

const PLACEHOLDER_FALLBACK = 'A definir';

function ehPlaceholderLocal(nome: string): boolean {
  const n = (nome ?? '').trim();
  return n === '' || /^a definir$/i.test(n) || ehTimePlaceholder(n);
}

/** Resolve o nome do time respeitando a trava (rodada aberta) e sem rebaixar real→placeholder. */
function resolverTime(current: string, fixtureReal: string | null, placeholder: string, travado: boolean): string {
  const currentPlaceholder = ehPlaceholderLocal(current);
  if (fixtureReal) {
    if (travado && !currentPlaceholder) return current; // real travado → mantém
    return fixtureReal; // preenche ou corrige
  }
  if (!currentPlaceholder) return current; // mantém real já gravado (ex.: advance)
  return placeholder;
}

export interface ResultadoSyncMataMata {
  bolaoIds: string[]; // bolões com mudança de resultado/classificado (pra recalcular ranking)
  rodadaIds: string[]; // rodadas com resultado mudado (pra recalcular pontuação)
  rodadasAbertas: number;
  jogosAtualizados: number;
}

interface RodadaInfo {
  id: string;
  status: string;
}

/** Garante as 6 rodadas de mata-mata do bolão (cria FECHADA se faltar). */
async function garantirRodadas(db: PrismaClient, bolaoId: string): Promise<Map<FaseTorneio, RodadaInfo>> {
  const existentes = await db.rodada.findMany({ where: { bolaoId } });
  let proximoNumero = existentes.reduce((max, r) => Math.max(max, r.numero), 0) + 1;
  const mapa = new Map<FaseTorneio, RodadaInfo>();
  for (const r of existentes) mapa.set(r.fase, { id: r.id, status: r.status });

  for (const fase of FASES_MATA_MATA) {
    if (mapa.has(fase)) continue;
    const nova = await db.rodada.create({
      data: {
        bolaoId,
        numero: proximoNumero++,
        fase,
        status: 'FECHADA', // abre quando os times reais chegam
        dataAbertura: new Date(0),
        dataFechamento: new Date(0),
      },
      select: { id: true, status: true, fase: true },
    });
    mapa.set(nova.fase, { id: nova.id, status: nova.status });
  }
  return mapa;
}

/** Upsert de um jogo a partir do fixture da FIFA. Retorna se atualizou e se o resultado mudou. */
async function upsertJogo(
  db: PrismaClient,
  rodada: RodadaInfo,
  f: FixtureMataMata,
): Promise<{ atualizou: boolean; mudouResultado: boolean }> {
  const travado = rodada.status === 'ABERTA';
  const phCasa = rotuloAlimentador(f.apiJogoId, 'CASA') ?? PLACEHOLDER_FALLBACK;
  const phVis = rotuloAlimentador(f.apiJogoId, 'VISITANTE') ?? PLACEHOLDER_FALLBACK;
  const avanco = BRACKET_2026[f.apiJogoId]?.vencedor;

  const existente = await db.jogo.findUnique({
    where: { rodadaId_apiJogoId: { rodadaId: rodada.id, apiJogoId: f.apiJogoId } },
  });

  if (!existente) {
    await db.jogo.create({
      data: {
        rodadaId: rodada.id,
        apiJogoId: f.apiJogoId,
        fase: f.fase,
        timeCasa: f.timeCasa ?? phCasa,
        timeVisitante: f.timeVisitante ?? phVis,
        dataHora: f.dataHoraUtc,
        status: f.status,
        golsCasa: f.golsCasa,
        golsVisitante: f.golsVisitante,
        classificadoLado: f.classificadoLado,
        decididoNosPenaltis: f.decididoNosPenaltis,
        proximoJogoApiId: avanco?.proximoJogoApiId ?? null,
        proximoSlot: avanco?.proximoSlot ?? null,
      },
    });
    return { atualizou: true, mudouResultado: f.status === 'FINALIZADO' };
  }

  const novoCasa = resolverTime(existente.timeCasa, f.timeCasa, phCasa, travado);
  const novoVis = resolverTime(existente.timeVisitante, f.timeVisitante, phVis, travado);
  const mudouPlacar =
    existente.golsCasa !== f.golsCasa ||
    existente.golsVisitante !== f.golsVisitante ||
    existente.classificadoLado !== f.classificadoLado;
  const mudouAlgo =
    novoCasa !== existente.timeCasa ||
    novoVis !== existente.timeVisitante ||
    existente.dataHora.getTime() !== f.dataHoraUtc.getTime() ||
    existente.status !== f.status ||
    mudouPlacar ||
    existente.decididoNosPenaltis !== f.decididoNosPenaltis;

  if (!mudouAlgo) return { atualizou: false, mudouResultado: false };

  await db.jogo.update({
    where: { id: existente.id },
    data: {
      timeCasa: novoCasa,
      timeVisitante: novoVis,
      dataHora: f.dataHoraUtc,
      status: f.status,
      golsCasa: f.golsCasa,
      golsVisitante: f.golsVisitante,
      classificadoLado: f.classificadoLado,
      decididoNosPenaltis: f.decididoNosPenaltis,
      // garante as ligações da chave (idempotente)
      proximoJogoApiId: avanco?.proximoJogoApiId ?? existente.proximoJogoApiId,
      proximoSlot: avanco?.proximoSlot ?? existente.proximoSlot,
    },
  });

  // Resultado/classificado mudou em jogo FINALIZADO → recalcular pontos/bônus.
  const mudouResultado = f.status === 'FINALIZADO' && mudouPlacar;
  if (mudouResultado) {
    await db.palpite.updateMany({
      where: { calculado: true, jogos: { some: { jogoId: existente.id } } },
      data: { calculado: false },
    });
  }
  return { atualizou: true, mudouResultado };
}

/** Abre rodadas FECHADAS que já têm ≥1 jogo com os dois times reais. Retorna quantas abriu. */
async function abrirRodadasProntas(db: PrismaClient, mapa: Map<FaseTorneio, RodadaInfo>): Promise<number> {
  let abertas = 0;
  for (const rodada of mapa.values()) {
    if (rodada.status !== 'FECHADA') continue;
    const jogos = await db.jogo.findMany({
      where: { rodadaId: rodada.id },
      select: { timeCasa: true, timeVisitante: true },
    });
    const temJogoReal = jogos.some((j) => !ehPlaceholderLocal(j.timeCasa) && !ehPlaceholderLocal(j.timeVisitante));
    if (!temJogoReal) continue;
    await db.rodada.update({ where: { id: rodada.id }, data: { status: 'ABERTA' } });
    rodada.status = 'ABERTA';
    abertas++;
    console.log(`[mata-mata-sync] rodada ${rodada.id} ABERTA`);
  }
  return abertas;
}

export async function sincronizarMataMata(
  db: PrismaClient,
  fixtures: FixtureMataMata[],
): Promise<ResultadoSyncMataMata> {
  if (fixtures.length === 0) return { bolaoIds: [], rodadaIds: [], rodadasAbertas: 0, jogosAtualizados: 0 };

  const boloes = await db.bolao.findMany({ where: { status: 'ATIVO' }, select: { id: true } });
  const bolaoComMudanca = new Set<string>();
  const rodadaComMudanca = new Set<string>();
  let rodadasAbertas = 0;
  let jogosAtualizados = 0;

  for (const b of boloes) {
    const mapa = await garantirRodadas(db, b.id);
    for (const f of fixtures) {
      const rodada = mapa.get(f.fase);
      if (!rodada) continue;
      const r = await upsertJogo(db, rodada, f);
      if (r.atualizou) jogosAtualizados++;
      if (r.mudouResultado) {
        bolaoComMudanca.add(b.id);
        rodadaComMudanca.add(rodada.id);
      }
    }
    rodadasAbertas += await abrirRodadasProntas(db, mapa);
  }

  return {
    bolaoIds: [...bolaoComMudanca],
    rodadaIds: [...rodadaComMudanca],
    rodadasAbertas,
    jogosAtualizados,
  };
}
