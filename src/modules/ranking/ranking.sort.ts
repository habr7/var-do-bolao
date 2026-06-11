/**
 * Ordenação determinística do ranking pro DISPLAY (sob demanda).
 *
 * Bug (caso real 11/06): em empate de pontos, a lista vinha do banco
 * ordenada só por `pontuacaoTotal DESC` (ordem arbitrária no empate),
 * mas o NÚMERO exibido vinha de `posicaoAtual` (calculado com o desempate
 * em cascata). As duas ordens divergiam → "1,2,3,5,4".
 *
 * Solução: ordenar a lista pela MESMA cascata que gera `posicaoAtual` e
 * derivar a posição exibida do índice (i+1), garantindo que o número
 * SEMPRE bate com a ordem da lista.
 *
 * Cascata (igual a recalcularRanking / regras.text.ts):
 *   1. pontuacaoTotal DESC
 *   2. posicaoAtual ASC  — encoda o desempate canônico já calculado
 *                          (pontos → nº de palpites → entrada). 0 = nunca
 *                          recalculado, joga pro fim do grupo empatado.
 *   3. entradaEm ASC     — último critério estável (entrou primeiro vence).
 */
export interface ParticipacaoOrdenavel {
  pontuacaoTotal: number;
  posicaoAtual: number;
  entradaEm: Date;
}

export function ordenarParticipacoesRanking<T extends ParticipacaoOrdenavel>(
  parts: readonly T[],
): T[] {
  return [...parts].sort((a, b) => {
    if (b.pontuacaoTotal !== a.pontuacaoTotal) return b.pontuacaoTotal - a.pontuacaoTotal;
    const pa = a.posicaoAtual > 0 ? a.posicaoAtual : Number.MAX_SAFE_INTEGER;
    const pb = b.posicaoAtual > 0 ? b.posicaoAtual : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.entradaEm.getTime() - b.entradaEm.getTime();
  });
}
