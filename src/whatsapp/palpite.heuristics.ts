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

const ANCHOR_REGEX = /\d+\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*\d+/g;

/**
 * v3.40.0 — Detecta um PLACAR PURO, sem time nenhum ("3x0", "2 a 1", "3 x 0!").
 * Caso real ("3x0"): o usuário manda só o placar e o bot não sabe de qual
 * jogo. 1 âncora NxN e, removida a âncora, NÃO sobra letra (nome de time).
 * "Brasil 3x0" → null (isso é `parecePalpiteIncompleto`). Devolve o placar
 * normalizado ("3x0") pra o caller pedir o jogo.
 */
export function parecePalpiteSoPlacar(texto: string): { placar: string } | null {
  const t = texto.trim();
  const anchors = t.match(ANCHOR_REGEX) ?? [];
  if (anchors.length !== 1) return null;
  // Tira a âncora; se sobrar qualquer letra, tem nome de time → não é "puro".
  const resto = t.replace(ANCHOR_REGEX, ' ').replace(/[\s.!?]/g, '');
  if (/[a-zà-ú]/i.test(resto)) return null;
  // Normaliza o placar ("2 a 1" → "2x1").
  const m = anchors[0].match(/(\d+)\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*(\d+)/);
  if (!m) return null;
  return { placar: `${m[1]}x${m[2]}` };
}

/**
 * v3.40.0 — Detecta uma LISTA de confrontos SEM placar (caso real: o usuário
 * mandou "Noruega x França\nSenegal x Iraque\n…" — 6 jogos, nenhum placar).
 * Sinal forte de intenção de palpitar sem os números. Exige ZERO âncoras NxN
 * (se houvesse dígito, outro fluxo cuida) e ≥2 linhas "Time (x|vs|contra|-)
 * Time". Uma linha só ("Noruega x França?") NÃO dispara — pode ser pergunta.
 * Devolve os confrontos detectados (pra ecoar um exemplo).
 */
export function pareceListaDeConfrontosSemPlacar(texto: string): { confrontos: string[] } | null {
  if ((texto.match(ANCHOR_REGEX) ?? []).length > 0) return null;
  const linhas = texto
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (linhas.length < 2) return null;
  const CONFRONTO = /^[a-zà-ú][a-zà-ú\s.'-]{1,28}?\s+(?:[xX×]|vs\.?|contra|-)\s+[a-zà-ú][a-zà-ú\s.'-]{1,28}?$/i;
  const confrontos = linhas.filter((l) => CONFRONTO.test(l));
  // A grande maioria das linhas tem que ser confronto (tolera 1 fora, tipo
  // uma saudação) e precisa de pelo menos 2 confrontos.
  if (confrontos.length >= 2 && confrontos.length >= linhas.length - 1) {
    return { confrontos };
  }
  return null;
}
