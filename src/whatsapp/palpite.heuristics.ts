/**
 * Heurísticas para detecção de intenção de palpite em textos que NÃO
 * passaram pelos parsers canônico/invertido/tokenizer (v3.10.0).
 *
 * Usado pra bloquear o smart-fallback LLM quando a mensagem
 * obviamente é palpite, evitando o bug Valéria 22/05 11:23 onde o
 * LLM respondeu "Entendi! Seus palpites foram registrados" sem
 * registrar nada.
 */

/**
 * Retorna `true` se o texto contém 2+ padrões de placar (NxN, N-N,
 * N a N, N por N) — forte sinal de lote de palpites que algum
 * parser deveria ter extraído. Quando true, o caller deve responder
 * com instrução de formato em vez de chamar LLM (que tende a
 * inventar confirmação de registro).
 */
export function parecePalpiteMasNaoEntendi(texto: string): boolean {
  const matches = texto.match(/\d+\s*(?:[xX-]|\s+(?:a|por)\s+)\s*\d+/g);
  return (matches?.length ?? 0) >= 2;
}
