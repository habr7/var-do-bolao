import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.22.0 — trava de pontuação: com o provider `hybrid`, a FIFA grava
 * placar PARCIAL ao vivo (status=AO_VIVO). `calcularPontuacaoRodada` deve
 * pontuar SÓ jogo FINALIZADO — jogo AO_VIVO/AGENDADO conta 0 até o apito,
 * pra os pontos não oscilarem durante a partida.
 */

const buscarPalpitesDaRodada = vi.fn();
const atualizarPontuacaoPalpiteJogo = vi.fn();
const atualizarPontuacaoPalpite = vi.fn();

// Evita carregar config/database.js → env.ts (que exige DATABASE_URL e
// chama process.exit). calcularPontuacaoRodada não usa prisma direto.
vi.mock('../../src/config/database.js', () => ({ prisma: {} }));

vi.mock('../../src/modules/palpite/palpite.repository.js', () => ({
  buscarPalpitesDaRodada: (...a: unknown[]) => buscarPalpitesDaRodada(...a),
  atualizarPontuacaoPalpiteJogo: (...a: unknown[]) => atualizarPontuacaoPalpiteJogo(...a),
  atualizarPontuacaoPalpite: (...a: unknown[]) => atualizarPontuacaoPalpite(...a),
}));

import { calcularPontuacaoRodada } from '../../src/modules/ranking/ranking.service.js';

beforeEach(() => {
  buscarPalpitesDaRodada.mockReset();
  atualizarPontuacaoPalpiteJogo.mockReset();
  atualizarPontuacaoPalpite.mockReset();
});

describe('calcularPontuacaoRodada — trava de FINALIZADO', () => {
  it('jogo AO_VIVO (placar parcial) NÃO pontua; FINALIZADO pontua', async () => {
    // Palpite com 2 jogos: um FINALIZADO (placar exato → 10) e um AO_VIVO
    // cujo palpite "bateria" o placar parcial (não pode pontuar ainda).
    buscarPalpitesDaRodada.mockResolvedValue([
      {
        id: 'palpite-1',
        jogos: [
          {
            id: 'pj-final',
            golsCasa: 2,
            golsVisitante: 1,
            jogo: { status: 'FINALIZADO', golsCasa: 2, golsVisitante: 1 },
          },
          {
            id: 'pj-aovivo',
            golsCasa: 1,
            golsVisitante: 0,
            jogo: { status: 'AO_VIVO', golsCasa: 1, golsVisitante: 0 },
          },
        ],
      },
    ]);

    await calcularPontuacaoRodada('rodada-1');

    // pj-final → 10 pts; pj-aovivo → 0 (não finalizado)
    expect(atualizarPontuacaoPalpiteJogo).toHaveBeenCalledWith('pj-final', 10);
    expect(atualizarPontuacaoPalpiteJogo).toHaveBeenCalledWith('pj-aovivo', 0);
    // total do palpite = só o jogo finalizado
    expect(atualizarPontuacaoPalpite).toHaveBeenCalledWith('palpite-1', 10);
  });

  it('jogo AGENDADO conta 0', async () => {
    buscarPalpitesDaRodada.mockResolvedValue([
      {
        id: 'p2',
        jogos: [
          {
            id: 'pj-agendado',
            golsCasa: 3,
            golsVisitante: 0,
            jogo: { status: 'AGENDADO', golsCasa: null, golsVisitante: null },
          },
        ],
      },
    ]);

    await calcularPontuacaoRodada('rodada-1');

    expect(atualizarPontuacaoPalpiteJogo).toHaveBeenCalledWith('pj-agendado', 0);
    expect(atualizarPontuacaoPalpite).toHaveBeenCalledWith('p2', 0);
  });
});
