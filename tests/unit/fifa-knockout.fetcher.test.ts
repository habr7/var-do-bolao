import { describe, it, expect } from 'vitest';
import { parseFixturesMataMata } from '../../src/modules/resultado/fifa.fetcher.js';

/**
 * Parser dos fixtures de mata-mata a partir do payload real da api.fifa.com
 * (calendar/matches). Shape confirmado em 2026-06-27: StageName/Stadium/TeamName
 * são arrays localizados; Winner é o IdTeam do vencedor.
 */
const stage = (d: string) => [{ Locale: 'en-GB', Description: d }];

describe('parseFixturesMataMata', () => {
  it('ignora jogos da fase de grupos ("First Stage")', () => {
    const r = parseFixturesMataMata([
      { MatchNumber: 1, StageName: stage('First Stage'), Date: '2026-06-11T16:00:00Z', MatchStatus: 0,
        Home: { IdCountry: 'MEX', Score: 2 }, Away: { IdCountry: 'RSA', Score: 0 } },
    ] as any);
    expect(r).toHaveLength(0);
  });

  it('mapeia número→apiJogoId, fase e kickoff UTC; R32 com times reais', () => {
    const r = parseFixturesMataMata([
      { MatchNumber: 73, StageName: stage('Round of 32'), Date: '2026-06-28T19:00:00Z', MatchStatus: 1,
        Home: { IdCountry: 'RSA', IdTeam: 'h1' }, Away: { IdCountry: 'CAN', IdTeam: 'a1' } },
    ] as any);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      numero: 73,
      apiJogoId: 'WC2026_R32_73',
      fase: 'R32',
      status: 'AGENDADO',
      timeCasa: 'África do Sul',
      timeVisitante: 'Canadá',
      classificadoLado: null,
    });
    expect(r[0].dataHoraUtc.toISOString()).toBe('2026-06-28T19:00:00.000Z');
  });

  it('jogo ainda sem times → timeCasa/timeVisitante null (placeholder)', () => {
    const r = parseFixturesMataMata([
      { MatchNumber: 90, StageName: stage('Round of 16'), Date: '2026-07-04T17:00:00Z', MatchStatus: 1,
        Home: null, Away: null },
    ] as any);
    expect(r[0]).toMatchObject({ numero: 90, fase: 'OITAVAS', timeCasa: null, timeVisitante: null });
  });

  it('FINALIZADO decisivo: classificado do Winner (IdTeam), sem pênaltis', () => {
    const r = parseFixturesMataMata([
      { MatchNumber: 76, StageName: stage('Round of 32'), Date: '2026-06-29T17:00:00Z', MatchStatus: 0,
        Home: { IdCountry: 'BRA', IdTeam: 'bra', Score: 2 }, Away: { IdCountry: 'JPN', IdTeam: 'jpn', Score: 0 },
        HomeTeamScore: 2, AwayTeamScore: 0, Winner: 'bra' },
    ] as any);
    expect(r[0]).toMatchObject({
      status: 'FINALIZADO', golsCasa: 2, golsVisitante: 0,
      classificadoLado: 'CASA', decididoNosPenaltis: false,
    });
  });

  it('FINALIZADO nos pênaltis: empate no placar + Winner define o lado; decididoNosPenaltis=true', () => {
    const r = parseFixturesMataMata([
      { MatchNumber: 77, StageName: stage('Round of 32'), Date: '2026-06-30T21:00:00Z', MatchStatus: 0,
        Home: { IdCountry: 'FRA', IdTeam: 'fra', Score: 1 }, Away: { IdCountry: 'SWE', IdTeam: 'swe', Score: 1 },
        HomeTeamScore: 1, AwayTeamScore: 1, Winner: 'swe',
        HomeTeamPenaltyScore: 3, AwayTeamPenaltyScore: 4 },
    ] as any);
    expect(r[0]).toMatchObject({
      golsCasa: 1, golsVisitante: 1, // placar segue 90'+prorrogação
      classificadoLado: 'VISITANTE', decididoNosPenaltis: true,
    });
  });

  it('mapeia todas as fases (quartas/semi/3º/final)', () => {
    const mk = (n: number, s: string) => ({ MatchNumber: n, StageName: stage(s), Date: '2026-07-10T20:00:00Z', MatchStatus: 1 });
    const r = parseFixturesMataMata([
      mk(97, 'Quarter-final'), mk(101, 'Semi-final'),
      mk(103, 'Play-off for third place'), mk(104, 'Final'),
    ] as any);
    expect(r.map((x) => x.fase)).toEqual(['QUARTAS', 'SEMI', 'TERCEIRO', 'FINAL']);
    expect(r.map((x) => x.apiJogoId)).toEqual(['WC2026_QUA_97', 'WC2026_SEMI_101', 'WC2026_TER_103', 'WC2026_FIN_104']);
  });
});
