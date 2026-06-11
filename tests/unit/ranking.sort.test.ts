import { describe, it, expect } from 'vitest';
import { ordenarParticipacoesRanking } from '../../src/modules/ranking/ranking.sort.js';

const d = (iso: string) => new Date(iso);

describe('ordenarParticipacoesRanking — ordem do ranking (bug 1,2,3,5,4)', () => {
  it('reproduz o caso real: empate entre R e T sai em ordem (4 antes de 5)', () => {
    // X>Y>Z distintos; R e T empatados em 10 pts. posicaoAtual canônica:
    // T=4 (entrou antes / mais palpites), R=5. A lista vinha do banco com R
    // antes de T → exibia "5 - R, 4 - T". Após o fix, T (pos 4) vem antes.
    const parts = [
      { nome: 'X', pontuacaoTotal: 30, posicaoAtual: 1, entradaEm: d('2026-06-01') },
      { nome: 'Y', pontuacaoTotal: 20, posicaoAtual: 2, entradaEm: d('2026-06-01') },
      { nome: 'Z', pontuacaoTotal: 15, posicaoAtual: 3, entradaEm: d('2026-06-01') },
      { nome: 'R', pontuacaoTotal: 10, posicaoAtual: 5, entradaEm: d('2026-06-03') },
      { nome: 'T', pontuacaoTotal: 10, posicaoAtual: 4, entradaEm: d('2026-06-02') },
    ];
    const ordenado = ordenarParticipacoesRanking(parts);
    expect(ordenado.map((p) => p.nome)).toEqual(['X', 'Y', 'Z', 'T', 'R']);
    // posição derivada do índice → estritamente crescente, batendo com a lista
    expect(ordenado.map((_, i) => i + 1)).toEqual([1, 2, 3, 4, 5]);
  });

  it('pontuacaoTotal é o critério primário (desc)', () => {
    const parts = [
      { nome: 'A', pontuacaoTotal: 5, posicaoAtual: 9, entradaEm: d('2026-06-01') },
      { nome: 'B', pontuacaoTotal: 12, posicaoAtual: 9, entradaEm: d('2026-06-01') },
    ];
    expect(ordenarParticipacoesRanking(parts).map((p) => p.nome)).toEqual(['B', 'A']);
  });

  it('empate de pontos sem posicaoAtual (0) cai pra entradaEm (entrou primeiro vence)', () => {
    const parts = [
      { nome: 'Tarde', pontuacaoTotal: 7, posicaoAtual: 0, entradaEm: d('2026-06-05') },
      { nome: 'Cedo', pontuacaoTotal: 7, posicaoAtual: 0, entradaEm: d('2026-06-02') },
    ];
    expect(ordenarParticipacoesRanking(parts).map((p) => p.nome)).toEqual(['Cedo', 'Tarde']);
  });

  it('quem tem posicaoAtual setada vence quem ainda está com 0 (mesmos pontos)', () => {
    const parts = [
      { nome: 'NovoSemRank', pontuacaoTotal: 8, posicaoAtual: 0, entradaEm: d('2026-06-01') },
      { nome: 'JaRankeado', pontuacaoTotal: 8, posicaoAtual: 6, entradaEm: d('2026-06-09') },
    ];
    expect(ordenarParticipacoesRanking(parts).map((p) => p.nome)).toEqual(['JaRankeado', 'NovoSemRank']);
  });

  it('não muta o array de entrada', () => {
    const parts = [
      { nome: 'A', pontuacaoTotal: 1, posicaoAtual: 2, entradaEm: d('2026-06-01') },
      { nome: 'B', pontuacaoTotal: 9, posicaoAtual: 1, entradaEm: d('2026-06-01') },
    ];
    const antes = parts.map((p) => p.nome);
    ordenarParticipacoesRanking(parts);
    expect(parts.map((p) => p.nome)).toEqual(antes);
  });
});
