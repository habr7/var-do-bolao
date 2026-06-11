import type { FootballApiAdapter, ResultadoJogo, JogoApi } from './resultado.types.js';
import { FifaWorldCup2026Adapter } from './fifa.fetcher.js';
import { OpenFootballAdapter } from './openfootball.fetcher.js';

/**
 * Adapter HÍBRIDO de placares (provider default em produção, v3.22.0).
 *
 *   1ª fonte  → api.fifa.com (FIFA)  — AO VIVO, latência de segundos.
 *   fallback  → openfootball         — latência 30-60min, mas estável e
 *                                       sem dependência de endpoint não
 *                                       documentado.
 *
 * Estratégia em `buscarResultados`:
 *   - Tenta a FIFA primeiro.
 *   - Se a FIFA LANÇAR (rede/HTTP fora, payload quebrado), loga e cai pro
 *     openfootball — garante que placares continuam chegando mesmo com a
 *     FIFA fora do ar.
 *   - Se a FIFA responder OK (mesmo com lista vazia — ex.: nenhum jogo
 *     rolando ainda), usa o resultado dela. Lista vazia é legítima e o
 *     openfootball também estaria vazio nesse momento.
 *
 * `buscarJogosRodada` lê do fixture local (idêntico nos dois adapters),
 * então delega direto pro openfootball.
 */
export class HybridFootballAdapter implements FootballApiAdapter {
  private fifa = new FifaWorldCup2026Adapter();
  private openfootball = new OpenFootballAdapter();

  async buscarResultados(campeonatoId: string, rodada: number): Promise<ResultadoJogo[]> {
    try {
      const resultados = await this.fifa.buscarResultados(campeonatoId, rodada);
      return resultados;
    } catch (err) {
      console.warn(
        `[hybrid] FIFA indisponível (${(err as Error).message}) — caindo pro openfootball`,
      );
      return this.openfootball.buscarResultados(campeonatoId, rodada);
    }
  }

  async buscarJogosRodada(campeonatoId: string, rodada: number): Promise<JogoApi[]> {
    return this.openfootball.buscarJogosRodada(campeonatoId, rodada);
  }
}
