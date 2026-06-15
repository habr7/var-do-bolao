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
  const matches = texto.match(/\d+\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*\d+/g);
  return (matches?.length ?? 0) >= 2;
}

/**
 * v3.37.0 — Detecta palpite INCOMPLETO: tem UM time + placar, mas falta o
 * adversário. Caso real ("Espanha 4x1"): o usuário manda só um lado e o bot
 * caía em "não entendi". Aqui devolvemos o time + placar pra o caller pedir
 * o adversário (não dá pra adivinhar — o time joga vários jogos na fase).
 *
 * Casa "Espanha 4x1", "Brasil 2 a 1", "Holanda 2 × 0" (um time antes, placar,
 * nada depois). Exige começar com letra (nome de time) pra não pegar
 * "4x1" puro. Retorna null se não bate.
 */
export function parecePalpiteIncompleto(texto: string): { time: string; placar: string } | null {
  const t = texto.trim();
  // 1+ placar no texto inteiro? se tiver 2+, é lote (outro fluxo cuida).
  const anchors = t.match(/\d+\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*\d+/g) ?? [];
  if (anchors.length !== 1) return null;
  // "<time> N sep N" e NADA relevante depois (fim, ou só pontuação).
  const m = t.match(
    /^([a-zà-ú][a-zà-ú\s.'-]*?)\s+(\d+)\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*(\d+)\s*[.!?]*$/i,
  );
  if (!m) return null;
  const time = m[1].trim();
  if (time.length < 2) return null;
  return { time, placar: `${m[2]}x${m[3]}` };
}
