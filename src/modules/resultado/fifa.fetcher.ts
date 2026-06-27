import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FaseTorneio } from '@prisma/client';
import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';
import { normalizeTeamName } from '../../utils/validators.js';
import { apiIdMataMata } from '../../data/bracket-2026.js';

/**
 * Adapter de placares AO VIVO da Copa do Mundo FIFA 2026 via o endpoint
 * público (não documentado) que o próprio site fifa.com consome:
 *
 *   https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=285023&count=200&language=en
 *
 * Sem API key, sem header de auth — é um GET público. Diferente do
 * openfootball (latência 30-60min), a FIFA traz placar AO VIVO em segundos,
 * incluindo `status=AO_VIVO` com placar parcial e correções pós-VAR.
 *
 * ───────────────────────────────────────────────────────────────────────
 * Histórico — este arquivo foi REESCRITO. A versão legada nunca funcionou
 * por 3 bugs (todos corrigidos aqui e cobertos por teste):
 *
 *   B1. FIFA_SEASON_ID vinha VAZIO em produção → retornava [] em silêncio.
 *       Agora há default `285023` (descoberto via /seasons?idCompetition=17,
 *       confirmado ao vivo no dia da abertura). Override via env.
 *   B2. Lia `m.HomeTeam.Score` — campo que NÃO existe. Os campos reais são
 *       `m.Home.Score` / `m.Away.Score` (e `HomeTeamScore`/`AwayTeamScore`
 *       no topo). Sempre dava undefined → 0×0.
 *   B3. Códigos de status INVERTIDOS. Confirmado empiricamente batendo na
 *       API (2026 ao vivo + 2022 finalizada):
 *         0 = FINALIZADO   (64/64 jogos de 2022)
 *         1 = AGENDADO     (jogos futuros, sem placar/tempo)
 *         3 = AO_VIVO      (jogo rolando, MatchTime "49'")
 *       A versão legada mapeava 1→AO_VIVO, 3→FINALIZADO e jogava
 *       FINALIZADO(0) no default→AGENDADO → resultado nunca era gravado.
 *   B4. Match por nome SEM normalizar ("Mexico" ≠ "México"). Agora casa por
 *       PAR DE CÓDIGO FIFA (Home.IdCountry/Away.IdCountry → teams.json
 *       fifaCode → nome PT → fixture). Cobertura 100% das 48 seleções.
 *
 * Em falha de rede/HTTP, este adapter LANÇA (não engole) — assim o
 * HybridFootballAdapter detecta e cai pro openfootball. Use o provider
 * `hybrid` em produção; `fifa-2026` puro é pra debug/controle.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const FIFA_COMPETITION_ID = '17';
// FIFA World Cup 2026™ — IdSeason confirmado em /api/v3/seasons?idCompetition=17.
const DEFAULT_SEASON_ID = '285023';
const CACHE_TTL_MS = 30 * 1000; // 30s — placar ao vivo muda rápido, mas não a cada request

interface FifaTeam {
  Score?: number | null;
  IdCountry?: string | null;
  IdTeam?: string | null;
}

type FifaLocalized = Array<{ Locale?: string; Description?: string }> | string | null;

interface FifaMatch {
  IdMatch?: string;
  MatchStatus?: number;
  Home?: FifaTeam | null;
  Away?: FifaTeam | null;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
  HomeTeamPenaltyScore?: number | null;
  AwayTeamPenaltyScore?: number | null;
  // Mata-mata (sync de fixtures): número oficial (73–104), fase, kickoff UTC e o
  // IdTeam do vencedor (resolve o classificado, inclusive pênaltis).
  MatchNumber?: number | null;
  StageName?: FifaLocalized;
  Date?: string | null;
  Winner?: string | null;
}

interface FifaCalendarResponse {
  Results?: FifaMatch[];
}

interface FixtureLocal {
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
  dataHora: string;
}

// ── caches estáticos ──────────────────────────────────────────────────
let cacheFixtures: FixtureLocal[] | null = null;
let cacheFifaCodeToNome: Map<string, string> | null = null;
let cacheFixtureByCodes: Map<string, string> | null = null;
let cacheCalendar: { data: FifaCalendarResponse; ts: number } | null = null;

function loadFixtures(): FixtureLocal[] {
  if (cacheFixtures) return cacheFixtures;
  const path = join(__dirname, '..', '..', 'data', 'fifa-2026-fixtures.json');
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { jogos: FixtureLocal[] };
  cacheFixtures = parsed.jogos;
  return cacheFixtures;
}

/** Mapa `fifaCode (MEX) → nome PT normalizado (mexico)` a partir do teams.json. */
function loadFifaCodeToNome(): Map<string, string> {
  if (cacheFifaCodeToNome) return cacheFifaCodeToNome;
  const path = join(__dirname, '..', '..', 'data', 'copa-2026', 'teams.json');
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as {
    times: Array<{ fifaCode: string; nome: string }>;
  };
  const map = new Map<string, string>();
  for (const t of parsed.times) {
    if (t.fifaCode) map.set(t.fifaCode.toUpperCase(), normalizeTeamName(t.nome));
  }
  cacheFifaCodeToNome = map;
  return map;
}

/** Extrai a string de um campo localizado da FIFA (array `[{Locale,Description}]` ou string). */
function descFifa(x: FifaLocalized | undefined): string | null {
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) {
    for (const e of x) if (e?.Description) return e.Description;
  }
  return null;
}

/** StageName da FIFA → FaseTorneio. Retorna null pra "First Stage" (grupos) e desconhecidos. */
const STAGE_TO_FASE: Record<string, Exclude<FaseTorneio, 'GRUPOS'>> = {
  'Round of 32': 'R32',
  'Round of 16': 'OITAVAS',
  'Quarter-final': 'QUARTAS',
  'Quarter-finals': 'QUARTAS',
  'Semi-final': 'SEMI',
  'Semi-finals': 'SEMI',
  'Play-off for third place': 'TERCEIRO',
  Final: 'FINAL',
};

let cacheFifaCodeToNomeDisplay: Map<string, string> | null = null;
/** Mapa `fifaCode (RSA) → nome de EXIBIÇÃO PT ("África do Sul")` (sem normalizar). */
function loadFifaCodeToNomeDisplay(): Map<string, string> {
  if (cacheFifaCodeToNomeDisplay) return cacheFifaCodeToNomeDisplay;
  const path = join(__dirname, '..', '..', 'data', 'copa-2026', 'teams.json');
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { times: Array<{ fifaCode: string; nome: string }> };
  const map = new Map<string, string>();
  for (const t of parsed.times) if (t.fifaCode) map.set(t.fifaCode.toUpperCase(), t.nome);
  cacheFifaCodeToNomeDisplay = map;
  return map;
}

/** Mapa `homeNorm_awayNorm → apiJogoId` dos fixtures locais. */
function loadFixtureByCodes(): Map<string, string> {
  if (cacheFixtureByCodes) return cacheFixtureByCodes;
  const map = new Map<string, string>();
  for (const j of loadFixtures()) {
    const k = `${normalizeTeamName(j.timeCasa)}_${normalizeTeamName(j.timeVisitante)}`;
    map.set(k, j.apiJogoId);
  }
  cacheFixtureByCodes = map;
  return map;
}

/**
 * Casa um jogo da FIFA pelo PAR de códigos de país (Home/Away IdCountry)
 * com o `apiJogoId` local. Robusto contra acento/tradução. Mata-mata só
 * casa depois que as seleções estão definidas (códigos preenchidos).
 */
function casarPorCodigoFifa(homeCode?: string | null, awayCode?: string | null): string | null {
  if (!homeCode || !awayCode) return null;
  const codeToNome = loadFifaCodeToNome();
  const homeNorm = codeToNome.get(homeCode.toUpperCase());
  const awayNorm = codeToNome.get(awayCode.toUpperCase());
  if (!homeNorm || !awayNorm) return null;
  return loadFixtureByCodes().get(`${homeNorm}_${awayNorm}`) ?? null;
}

/**
 * Códigos de MatchStatus da api.fifa.com v3 (confirmados empiricamente).
 * Retorna null pra status que não geram placar (AGENDADO/desconhecido).
 */
function mapFifaStatus(
  status: number | undefined,
): 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO' | null {
  switch (status) {
    case 0:
      return 'FINALIZADO';
    case 3:
      return 'AO_VIVO';
    case 4:
      return 'ADIADO';
    case 5:
      return 'CANCELADO';
    case 1: // AGENDADO — ainda sem placar
    default:
      return null;
  }
}

function lerPlacar(team: FifaTeam | null | undefined, fallback: number | null | undefined): number | null {
  const v = team?.Score ?? fallback;
  return typeof v === 'number' ? v : null;
}

async function fetchCalendar(): Promise<FifaCalendarResponse> {
  if (cacheCalendar && Date.now() - cacheCalendar.ts < CACHE_TTL_MS) {
    return cacheCalendar.data;
  }
  const seasonId = process.env.FIFA_SEASON_ID || DEFAULT_SEASON_ID;
  const url =
    `https://api.fifa.com/api/v3/calendar/matches` +
    `?idCompetition=${FIFA_COMPETITION_ID}&idSeason=${encodeURIComponent(seasonId)}` +
    `&count=200&language=en`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'var-do-bolao/fifa-fetcher' },
  });
  if (!res.ok) {
    // LANÇA — o HybridFootballAdapter cai pro openfootball.
    throw new Error(`api.fifa.com HTTP ${res.status}`);
  }
  const data = (await res.json()) as FifaCalendarResponse;
  cacheCalendar = { data, ts: Date.now() };
  return data;
}

// ── Sync de fixtures do MATA-MATA (a partir do mesmo calendar) ────────────

/** Status de fixture (inclui AGENDADO, diferente do mapFifaStatus de resultado). */
function mapFifaStatusFixture(status: number | undefined): 'AGENDADO' | 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO' {
  switch (status) {
    case 0:
      return 'FINALIZADO';
    case 3:
      return 'AO_VIVO';
    case 4:
      return 'ADIADO';
    case 5:
      return 'CANCELADO';
    default:
      return 'AGENDADO';
  }
}

export interface FixtureMataMata {
  numero: number; // MatchNumber FIFA (73–104)
  apiJogoId: string; // WC2026_R32_73 etc
  fase: Exclude<FaseTorneio, 'GRUPOS'>;
  dataHoraUtc: Date;
  timeCasa: string | null; // nome PT (null = ainda não definido)
  timeVisitante: string | null;
  status: 'AGENDADO' | 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO';
  golsCasa: number | null; // 90'+prorrogação (sem pênaltis)
  golsVisitante: number | null;
  classificadoLado: 'CASA' | 'VISITANTE' | null; // do Winner (IdTeam)
  decididoNosPenaltis: boolean | null;
}

/**
 * Parseia o payload do calendar e retorna SÓ os jogos de mata-mata (StageName
 * mapeável), prontos pro sync: número/fase/kickoff-UTC/times (ou null)/placar/
 * classificado (do Winner = IdTeam do vencedor, resolve inclusive pênaltis).
 * Função PURA — testável com um payload de exemplo.
 */
export function parseFixturesMataMata(matches: FifaMatch[]): FixtureMataMata[] {
  const codeToNome = loadFifaCodeToNomeDisplay();
  const out: FixtureMataMata[] = [];

  for (const m of matches) {
    const stage = descFifa(m.StageName);
    const fase = stage ? STAGE_TO_FASE[stage] : undefined;
    if (!fase) continue; // grupos / desconhecido
    const numero = typeof m.MatchNumber === 'number' ? m.MatchNumber : null;
    if (numero === null || !m.Date) continue;

    const status = mapFifaStatusFixture(m.MatchStatus);
    const nome = (t: FifaTeam | null | undefined): string | null =>
      t?.IdCountry ? codeToNome.get(t.IdCountry.toUpperCase()) ?? null : null;
    const timeCasa = nome(m.Home);
    const timeVisitante = nome(m.Away);

    const golsCasa = status === 'FINALIZADO' || status === 'AO_VIVO' ? lerPlacar(m.Home, m.HomeTeamScore) : null;
    const golsVisitante = status === 'FINALIZADO' || status === 'AO_VIVO' ? lerPlacar(m.Away, m.AwayTeamScore) : null;

    // Classificado pelo Winner (IdTeam do vencedor). Resolve decisivo E pênaltis.
    let classificadoLado: 'CASA' | 'VISITANTE' | null = null;
    if (m.Winner && status === 'FINALIZADO') {
      if (m.Home?.IdTeam && m.Winner === m.Home.IdTeam) classificadoLado = 'CASA';
      else if (m.Away?.IdTeam && m.Winner === m.Away.IdTeam) classificadoLado = 'VISITANTE';
    }
    // Pênaltis: placar (90'+prorrog) empatado mas há vencedor, OU placar de pênaltis informado.
    let decididoNosPenaltis: boolean | null = null;
    if (status === 'FINALIZADO') {
      const penInfo = m.HomeTeamPenaltyScore != null && m.AwayTeamPenaltyScore != null;
      if (golsCasa != null && golsVisitante != null && golsCasa === golsVisitante && (classificadoLado || penInfo)) {
        decididoNosPenaltis = true;
      } else if (golsCasa != null && golsVisitante != null && golsCasa !== golsVisitante) {
        decididoNosPenaltis = false;
      }
    }

    out.push({
      numero,
      apiJogoId: apiIdMataMata(numero),
      fase,
      dataHoraUtc: new Date(m.Date),
      timeCasa,
      timeVisitante,
      status,
      golsCasa,
      golsVisitante,
      classificadoLado,
      decididoNosPenaltis,
    });
  }
  return out.sort((a, b) => a.numero - b.numero);
}

/** Busca os fixtures de mata-mata da FIFA (reusa o cache do calendar). LANÇA em falha de rede. */
export async function buscarFixturesMataMata(): Promise<FixtureMataMata[]> {
  const data = await fetchCalendar();
  return parseFixturesMataMata(data.Results ?? []);
}

export class FifaWorldCup2026Adapter implements FootballApiAdapter {
  /**
   * Lista de jogos da fase de grupos — lê do JSON local (mesmo padrão do
   * OpenFootballAdapter). O sync gera o fixture; aqui só lemos.
   */
  async buscarJogosRodada(_campeonatoId: string, _rodada: number): Promise<JogoApi[]> {
    return loadFixtures().map((j) => ({
      apiJogoId: j.apiJogoId,
      timeCasa: j.timeCasa,
      timeVisitante: j.timeVisitante,
      dataHora: new Date(j.dataHora),
    }));
  }

  /**
   * Placares AO VIVO/FINALIZADOS da api.fifa.com. Retorna só jogos com
   * status mapeável (AO_VIVO/FINALIZADO/ADIADO/CANCELADO) e placar válido.
   * LANÇA em falha de rede/HTTP — deixe o Hybrid tratar o fallback.
   */
  async buscarResultados(_campeonatoId: string, _rodada: number): Promise<ResultadoJogo[]> {
    const data = await fetchCalendar();
    const matches = data.Results ?? [];

    const results: ResultadoJogo[] = [];
    let semMatch = 0;
    let semPlacar = 0;

    for (const m of matches) {
      const status = mapFifaStatus(m.MatchStatus);
      if (!status) continue; // AGENDADO/desconhecido

      const apiJogoId = casarPorCodigoFifa(m.Home?.IdCountry, m.Away?.IdCountry);
      if (!apiJogoId) {
        semMatch++;
        continue;
      }

      const golsCasa = lerPlacar(m.Home, m.HomeTeamScore);
      const golsVisitante = lerPlacar(m.Away, m.AwayTeamScore);
      // Bug-guard (B4 do openfootball): jogo com status mas sem placar
      // numérico NÃO vira 0×0 — pula. (AO_VIVO sempre tem placar; se vier
      // null é payload incompleto.)
      if (golsCasa === null || golsVisitante === null) {
        semPlacar++;
        continue;
      }

      // Mata-mata decidido nos pênaltis: se o placar empata e o payload trouxe
      // o placar de pênaltis, infere quem avançou (o placar gravado segue sendo
      // 90'+prorrogação — pênalti não entra). Grupos nunca têm isto. Só anexa os
      // campos quando detecta — jogos normais mantêm o shape mínimo.
      const penCasa = m.HomeTeamPenaltyScore;
      const penVis = m.AwayTeamPenaltyScore;
      const ehPenaltis =
        status === 'FINALIZADO' &&
        golsCasa === golsVisitante &&
        penCasa != null &&
        penVis != null &&
        penCasa !== penVis;

      if (ehPenaltis) {
        results.push({
          apiJogoId,
          golsCasa,
          golsVisitante,
          status,
          classificadoLado: (penCasa as number) > (penVis as number) ? 'CASA' : 'VISITANTE',
          decididoNosPenaltis: true,
        });
      } else {
        results.push({ apiJogoId, golsCasa, golsVisitante, status });
      }
    }

    console.log(
      `[fifa] placares recebidos: sucesso=${results.length} sem_match=${semMatch} ` +
        `sem_placar=${semPlacar} total_no_payload=${matches.length}`,
    );
    return results;
  }
}

// Exposto pra teste — permite resetar os caches estáticos entre cenários.
export function __resetFifaCachesParaTeste(): void {
  cacheFixtures = null;
  cacheFifaCodeToNome = null;
  cacheFixtureByCodes = null;
  cacheCalendar = null;
}
