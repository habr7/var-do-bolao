export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 99;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function isUserJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net');
}

export function extractPhoneFromJid(jid: string): string {
  return jid.split('@')[0];
}

/**
 * Normaliza o nome de um time pra matching tolerante:
 *   - remove acentos, deixa lowercase
 *   - remove preposi\u00e7\u00f5es/artigos prefixados que o usuario coloca em
 *     linguagem natural ("na \u00c1frica", "do Brasil", "pro Marrocos")
 *
 * Sem esse stripping, o matcher de jogo em palpite.service.ts falha
 * porque `"na africa".includes("africa do sul")` retorna false, e o
 * usuario reporta "jogo nao encontrado" mesmo escrevendo certo.
 *
 * Strips s\u00f3 os tokens INICIAIS, recursivamente. "do Brasil" \u2192 "brasil";
 * "no Catar" \u2192 "catar"; "Estados Unidos" continua intacto (Estados n\u00e3o
 * est\u00e1 na lista de stopwords).
 */
const STOPWORDS_PREFIXO = new Set([
  'a', 'o', 'as', 'os',           // artigos
  'na', 'no', 'nas', 'nos',       // em + artigos
  'da', 'do', 'das', 'dos',       // de + artigos
  'pra', 'pro', 'pras', 'pros',   // pra + artigos (coloquial)
  'para',                          // forma plena
  'de', 'em',                      // preposicoes nuas
  'contra', 'vs',                  // marcadores de oposicao
]);

export function normalizeTeamName(name: string): string {
  let n = name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  // Strip iterativo de preposicoes/artigos no inicio
  // ("pra na africa" \u2192 "na africa" \u2192 "africa")
  while (true) {
    const tokens = n.split(/\s+/);
    if (tokens.length <= 1) break;
    if (STOPWORDS_PREFIXO.has(tokens[0])) {
      n = tokens.slice(1).join(' ');
    } else {
      break;
    }
  }
  return n;
}

export function parseScore(text: string): { golsCasa: number; golsVisitante: number } | null {
  const match = text.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (!match) return null;

  const golsCasa = parseInt(match[1], 10);
  const golsVisitante = parseInt(match[2], 10);

  if (!isValidScore(golsCasa) || !isValidScore(golsVisitante)) return null;

  return { golsCasa, golsVisitante };
}

/**
 * ISSUE-013: avalia se o placar eh "absurdo" e pede confirmacao.
 *
 * Regras:
 *   - >15 gols em qualquer lado: absurdo (futebol pro de verdade nunca passou
 *     de 9 em decadas — 15 cobre folga pra goleadas em copas pequenas)
 *   - total >20: absurdo (mesmo se cada lado <=15)
 *   - <0 ou nao inteiro: invalido (ja coberto por isValidScore, mas reportado
 *     aqui pra unificacao)
 *
 * Retorno { ok: false, motivo, sugerirConfirmacao } — caller pode mostrar
 * "tem certeza que eh 18x0?" antes de registrar.
 */
export type ResultadoValidacaoPlacar =
  | { ok: true }
  | { ok: false; motivo: 'invalido' | 'absurdo'; sugerirConfirmacao: boolean; descricao: string };

export function validarPlacar(golsCasa: number, golsVisitante: number): ResultadoValidacaoPlacar {
  if (!isValidScore(golsCasa) || !isValidScore(golsVisitante)) {
    return {
      ok: false,
      motivo: 'invalido',
      sugerirConfirmacao: false,
      descricao: 'Placar invalido — gols devem ser numeros inteiros entre 0 e 99.',
    };
  }
  if (golsCasa > 15 || golsVisitante > 15) {
    return {
      ok: false,
      motivo: 'absurdo',
      sugerirConfirmacao: true,
      descricao: `Placar incomum (${golsCasa}x${golsVisitante}). Tem certeza?`,
    };
  }
  if (golsCasa + golsVisitante > 20) {
    return {
      ok: false,
      motivo: 'absurdo',
      sugerirConfirmacao: true,
      descricao: `Total de gols alto (${golsCasa + golsVisitante}). Tem certeza?`,
    };
  }
  return { ok: true };
}
