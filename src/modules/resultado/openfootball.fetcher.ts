import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTeamName } from '../../utils/validators.js';
import { traduzirTime } from '../copa-2026/traduzir-time.js';

/**
 * v3.16.0 — Adapter para placares da Copa via openfootball/worldcup.json.
 *
 * Por que esse adapter existe (substituiu o FifaWorldCup2026Adapter como
 * fonte primária):
 *
 *  - O fetcher antigo dependia de `api.fifa.com` (não documentado,
 *    instável, exige FIFA_SEASON_ID que vinha VAZIO em produção
 *    → silêncio total: nada atualizava).
 *  - Mapeava times por nome SEM normalizar — "México" (PT, com acento)
 *    vs "Mexico" (EN) nunca casava. Mesmo com a API ok, jogo nunca
 *    seria atualizado.
 *  - `Score: null` em jogo FINALIZADO virava `0×0` → pontuação errada
 *    pra todos.
 *
 * Esta implementação:
 *
 *  - Usa `openfootball/worldcup.json` — mesma fonte do
 *    `sync-copa-2026.mjs`. Não precisa de API key nem ENV var.
 *  - Casamento por (timeCasa, timeVisitante) NORMALIZADO (acentos
 *    removidos, lowercase) + cache local do JSON pra evitar fetch
 *    desnecessário (cache 60s — placar muda devagar).
 *  - Score null em FINALIZADO → PULA o jogo (NÃO vira 0×0). Log
 *    estruturado pra admin investigar.
 *
 * Latência típica esperada: 30–60 min após o fim do jogo (depende dos
 * commits da comunidade openfootball). NÃO é "real time" — usar
 * apenas pra fase de grupos. Pra ao vivo lance-a-lance precisa de API
 * paga (api-futebol.com.br já tem adapter pronto: `ApiFutebolAdapter`).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface OpenFootballMatch {
  round?: string;
  date?: string;
  time?: string;
  team1?: string;
  team2?: string;
  group?: string;
  score?: {
    ft?: [number, number];
    ht?: [number, number];
  };
  status?: string; // varia: "complete", "scheduled", undefined
}

interface OpenFootballJson {
  matches: OpenFootballMatch[];
}

interface FixtureLocal {
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
}

let cacheJson: { data: OpenFootballJson; ts: number } | null = null;
let cacheFixtures: FixtureLocal[] | null = null;

const CACHE_TTL_MS = 60 * 1000; // 60s
const SOURCE_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

function loadFixturesLocal(): FixtureLocal[] {
  if (cacheFixtures) return cacheFixtures;
  const path = join(__dirname, '..', '..', 'data', 'fifa-2026-fixtures.json');
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw) as { jogos: FixtureLocal[] };
  cacheFixtures = parsed.jogos;
  return cacheFixtures;
}

async function fetchOpenFootball(): Promise<OpenFootballJson | null> {
  if (cacheJson && Date.now() - cacheJson.ts < CACHE_TTL_MS) {
    return cacheJson.data;
  }
  try {
    const res = await fetch(SOURCE_URL, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'var-do-bolao/3.16.0',
      },
    });
    if (!res.ok) {
      console.warn(`[openfootball] HTTP ${res.status} ao buscar placares`);
      return null;
    }
    const data = (await res.json()) as OpenFootballJson;
    cacheJson = { data, ts: Date.now() };
    return data;
  } catch (err) {
    console.warn('[openfootball] erro de rede:', (err as Error).message);
    return null;
  }
}

/**
 * Mapeia (team1, team2) do openfootball pro nosso `apiJogoId` local.
 *
 * Dois passos:
 *   1. Traduz EN→PT pela tabela canônica `PT_BR_TIMES`. Sem isso,
 *      `"Mexico"` vs `"México"` (no fixture) nunca casa.
 *   2. Normaliza (lowercase, acentos, trim) — defesa extra contra
 *      pequenas diferenças de formatação.
 */
function casarJogo(team1: string, team2: string): string | null {
  if (!team1 || !team2) return null;
  const t1pt = traduzirTime(team1);
  const t2pt = traduzirTime(team2);
  const n1 = normalizeTeamName(t1pt);
  const n2 = normalizeTeamName(t2pt);
  const fixtures = loadFixturesLocal();
  const found = fixtures.find(
    (j) =>
      normalizeTeamName(j.timeCasa) === n1 &&
      normalizeTeamName(j.timeVisitante) === n2,
  );
  return found?.apiJogoId ?? null;
}

/**
 * Mapeia status do openfootball pro nosso enum interno.
 * Defaults: sem campo `status` mas com `score.ft` → FINALIZADO.
 */
function mapStatus(m: OpenFootballMatch): 'AGENDADO' | 'AO_VIVO' | 'FINALIZADO' {
  const raw = m.status?.toLowerCase();
  if (raw === 'complete' || raw === 'finalizado') return 'FINALIZADO';
  if (raw === 'live' || raw === 'ao_vivo') return 'AO_VIVO';
  if (m.score?.ft && Array.isArray(m.score.ft)) return 'FINALIZADO';
  return 'AGENDADO';
}

export class OpenFootballAdapter implements FootballApiAdapter {
  /**
   * `buscarJogosRodada` usa o JSON local (`fifa-2026-fixtures.json`),
   * mesmo padrão do `FifaWorldCup2026Adapter`. O sync script gera o
   * fixture local; este método só lê.
   */
  async buscarJogosRodada(_campeonatoId: string, _rodada: number): Promise<JogoApi[]> {
    const path = join(__dirname, '..', '..', 'data', 'fifa-2026-fixtures.json');
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as {
      jogos: Array<{ apiJogoId: string; timeCasa: string; timeVisitante: string; dataHora: string }>;
    };
    return parsed.jogos.map((j) => ({
      apiJogoId: j.apiJogoId,
      timeCasa: j.timeCasa,
      timeVisitante: j.timeVisitante,
      dataHora: new Date(j.dataHora),
    }));
  }

  /**
   * Busca resultados ao vivo/finalizados do openfootball/worldcup.json.
   * Retorna SÓ jogos com placar válido (status AO_VIVO ou FINALIZADO
   * com Score não-nulo). Loga sucesso/falha pra observabilidade.
   */
  async buscarResultados(_campeonatoId: string, _rodada: number): Promise<ResultadoJogo[]> {
    const data = await fetchOpenFootball();
    if (!data || !Array.isArray(data.matches)) {
      console.warn('[openfootball] payload inválido ou indisponível');
      return [];
    }

    const results: ResultadoJogo[] = [];
    let scoreNullEmFinalizado = 0;
    let semMatch = 0;

    for (const m of data.matches) {
      if (!m.team1 || !m.team2) continue;
      const status = mapStatus(m);
      if (status === 'AGENDADO') continue;

      // Bug-guard: jogo "FINALIZADO" mas sem score → NÃO vira 0×0.
      // Loga e pula — admin pode investigar nos logs.
      if (!m.score?.ft || m.score.ft.length !== 2) {
        scoreNullEmFinalizado++;
        continue;
      }

      const apiJogoId = casarJogo(m.team1, m.team2);
      if (!apiJogoId) {
        semMatch++;
        continue;
      }

      results.push({
        apiJogoId,
        golsCasa: m.score.ft[0],
        golsVisitante: m.score.ft[1],
        status,
      });
    }

    console.log(
      `[openfootball] placares recebidos: sucesso=${results.length} sem_score=${scoreNullEmFinalizado} sem_match=${semMatch} total_no_json=${data.matches.length}`,
    );
    return results;
  }
}
