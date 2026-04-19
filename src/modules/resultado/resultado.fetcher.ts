import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';

/**
 * Mock adapter para desenvolvimento.
 * Substitua pela implementacao real quando tiver uma API key.
 */
export class MockFootballApi implements FootballApiAdapter {
  async buscarResultados(campeonatoId: string, rodada: number): Promise<ResultadoJogo[]> {
    console.log(`[MOCK] Buscando resultados: ${campeonatoId}, rodada ${rodada}`);

    // Retorna resultados mockados para testes
    return [
      { apiJogoId: `mock-${rodada}-1`, golsCasa: 2, golsVisitante: 1, status: 'FINALIZADO' },
      { apiJogoId: `mock-${rodada}-2`, golsCasa: 0, golsVisitante: 0, status: 'FINALIZADO' },
      { apiJogoId: `mock-${rodada}-3`, golsCasa: 1, golsVisitante: 3, status: 'FINALIZADO' },
    ];
  }

  async buscarJogosRodada(campeonatoId: string, rodada: number): Promise<JogoApi[]> {
    console.log(`[MOCK] Buscando jogos: ${campeonatoId}, rodada ${rodada}`);

    const dataBase = new Date();
    dataBase.setDate(dataBase.getDate() + 7);

    return [
      {
        apiJogoId: `mock-${rodada}-1`,
        timeCasa: 'Flamengo',
        timeVisitante: 'Palmeiras',
        dataHora: dataBase,
      },
      {
        apiJogoId: `mock-${rodada}-2`,
        timeCasa: 'Corinthians',
        timeVisitante: 'São Paulo',
        dataHora: dataBase,
      },
      {
        apiJogoId: `mock-${rodada}-3`,
        timeCasa: 'Grêmio',
        timeVisitante: 'Internacional',
        dataHora: dataBase,
      },
    ];
  }
}

/**
 * Adapter para api-futebol.com.br (implementar quando tiver API key)
 */
export class ApiFutebolAdapter implements FootballApiAdapter {
  constructor(
    private apiUrl: string,
    private apiKey: string,
  ) {}

  async buscarResultados(campeonatoId: string, rodada: number): Promise<ResultadoJogo[]> {
    const response = await fetch(
      `${this.apiUrl}/campeonatos/${campeonatoId}/rodadas/${rodada}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`API de futebol retornou ${response.status}`);
    }

    const data = await response.json() as any;

    return (data.partidas ?? []).map((p: any) => ({
      apiJogoId: String(p.partida_id),
      golsCasa: p.placar_mandante ?? 0,
      golsVisitante: p.placar_visitante ?? 0,
      status: mapStatus(p.status),
    }));
  }

  async buscarJogosRodada(campeonatoId: string, rodada: number): Promise<JogoApi[]> {
    const response = await fetch(
      `${this.apiUrl}/campeonatos/${campeonatoId}/rodadas/${rodada}`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`API de futebol retornou ${response.status}`);
    }

    const data = await response.json() as any;

    return (data.partidas ?? []).map((p: any) => ({
      apiJogoId: String(p.partida_id),
      timeCasa: p.mandante?.nome_popular ?? p.mandante?.sigla ?? 'TBD',
      timeVisitante: p.visitante?.nome_popular ?? p.visitante?.sigla ?? 'TBD',
      dataHora: new Date(p.data_realizacao),
    }));
  }
}

function mapStatus(status: string): 'AO_VIVO' | 'FINALIZADO' | 'ADIADO' | 'CANCELADO' {
  switch (status?.toLowerCase()) {
    case 'finalizado':
    case 'encerrado':
      return 'FINALIZADO';
    case 'ao vivo':
    case 'em andamento':
      return 'AO_VIVO';
    case 'adiado':
      return 'ADIADO';
    case 'cancelado':
      return 'CANCELADO';
    default:
      return 'FINALIZADO';
  }
}
