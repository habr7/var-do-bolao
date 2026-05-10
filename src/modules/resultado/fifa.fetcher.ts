import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';

/**
 * Adapter para a Copa do Mundo FIFA 2026 (fase de grupos).
 *
 * Estrategia:
 *  - Lista de jogos vem do JSON local em src/data/fifa-2026-fixtures.json.
 *    Voce edita o JSON com os times reais apos o sorteio. Sem dependencia
 *    de API paga, sem chave.
 *  - Placares ao vivo: tenta puxar do endpoint publico da FIFA usado pelo
 *    proprio site oficial (api.fifa.com). Se mudar/cair, retorna [] e
 *    voce pode atualizar manualmente via prisma studio (ou implementar
 *    scraping com Playwright).
 *
 * Importante:
 *  - O `apiJogoId` no JSON tem que casar com o `apiJogoId` que vier do
 *    fetch ao vivo. O matcher `mapFifaApiIdToOurId` faz essa traducao.
 */

interface FifaFixturesJson {
  campeonatoId: string;
  campeonatoNome: string;
  jogos: Array<{
    apiJogoId: string;
    grupo: string;
    matchday: number;
    timeCasa: string;
    timeVisitante: string;
    dataHora: string; // ISO-8601
  }>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedFixtures: FifaFixturesJson | null = null;

function loadFixtures(): FifaFixturesJson {
  if (cachedFixtures) return cachedFixtures;
  // src/modules/resultado/ → src/data/fifa-2026-fixtures.json
  const path = join(__dirname, '..', '..', 'data', 'fifa-2026-fixtures.json');
  const raw = readFileSync(path, 'utf-8');
  cachedFixtures = JSON.parse(raw) as FifaFixturesJson;
  return cachedFixtures;
}

export class FifaWorldCup2026Adapter implements FootballApiAdapter {
  /**
   * Retorna todos os jogos da fase de grupos (72 partidas) — usado pra seed.
   * O parametro `rodada` é ignorado: na nossa modelagem temos UMA Rodada
   * "Fase de Grupos" com todos os jogos dentro.
   */
  async buscarJogosRodada(_campeonatoId: string, _rodada: number): Promise<JogoApi[]> {
    const fixtures = loadFixtures();
    return fixtures.jogos.map((j) => ({
      apiJogoId: j.apiJogoId,
      timeCasa: j.timeCasa,
      timeVisitante: j.timeVisitante,
      dataHora: new Date(j.dataHora),
    }));
  }

  /**
   * Tenta puxar placares ao vivo. Se nao conseguir, retorna [].
   *
   * Endpoint da FIFA usado pelo proprio site:
   *   https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=...&count=300&language=en
   *
   * Como a Season ID muda a cada Copa, deixamos configuravel via env
   * (FIFA_SEASON_ID). Se nao estiver setado, retorna [] — o admin pode
   * atualizar resultado manualmente.
   */
  async buscarResultados(_campeonatoId: string, _rodada: number): Promise<ResultadoJogo[]> {
    const seasonId = process.env.FIFA_SEASON_ID;
    if (!seasonId) {
      return [];
    }

    try {
      const url = `https://api.fifa.com/api/v3/calendar/matches?idCompetition=17&idSeason=${encodeURIComponent(seasonId)}&count=300&language=en`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        console.warn(`[fifa.fetcher] api.fifa.com retornou ${response.status}`);
        return [];
      }

      const data = (await response.json()) as { Results?: Array<FifaApiMatch> };
      const results: ResultadoJogo[] = [];

      for (const m of data.Results ?? []) {
        const ourId = mapFifaApiIdToOurId(m);
        if (!ourId) continue;

        // Status 0=upcoming, 1=live, 3=finished (mapping aproximado — varia)
        const status = mapFifaStatus(m.MatchStatus);
        if (status === 'AGENDADO') continue; // sem placar ainda

        results.push({
          apiJogoId: ourId,
          golsCasa: m.HomeTeam?.Score ?? 0,
          golsVisitante: m.AwayTeam?.Score ?? 0,
          status,
        });
      }

      return results;
    } catch (error) {
      console.warn('[fifa.fetcher] erro consultando api.fifa.com:', (error as Error).message);
      return [];
    }
  }
}

/**
 * Tenta mapear um match retornado pela API da FIFA para o nosso apiJogoId
 * local (WC2026_X_N). Esse mapping é feito por nomes dos times +
 * matchday — ajuste conforme o formato real do payload.
 */
interface FifaApiMatch {
  IdMatch?: string;
  MatchStatus?: number;
  GroupName?: Array<{ Description?: string }>;
  MatchDay?: string;
  HomeTeam?: { TeamName?: Array<{ Description?: string }>; Score?: number };
  AwayTeam?: { TeamName?: Array<{ Description?: string }>; Score?: number };
}

function mapFifaApiIdToOurId(match: FifaApiMatch): string | null {
  // Estrategia simples: casa o nome do timeCasa+timeVisitante com nosso JSON.
  // Implementacao mais robusta exige tabela de aliases — deixar como TODO.
  const fixtures = loadFixtures();
  const homeName = match.HomeTeam?.TeamName?.[0]?.Description?.toLowerCase()?.trim();
  const awayName = match.AwayTeam?.TeamName?.[0]?.Description?.toLowerCase()?.trim();
  if (!homeName || !awayName) return null;

  const found = fixtures.jogos.find(
    (j) =>
      j.timeCasa.toLowerCase().trim() === homeName &&
      j.timeVisitante.toLowerCase().trim() === awayName,
  );
  return found?.apiJogoId ?? null;
}

function mapFifaStatus(status: number | undefined): 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO' | 'AGENDADO' {
  switch (status) {
    case 1:
      return 'AO_VIVO';
    case 3:
      return 'FINALIZADO';
    case 4:
      return 'ADIADO';
    case 5:
      return 'CANCELADO';
    default:
      return 'AGENDADO';
  }
}
