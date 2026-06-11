import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';
import { normalizeTeamName } from '../../utils/validators.js';

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

interface FifaMatch {
  IdMatch?: string;
  MatchStatus?: number;
  Home?: FifaTeam | null;
  Away?: FifaTeam | null;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
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

      results.push({ apiJogoId, golsCasa, golsVisitante, status });
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
