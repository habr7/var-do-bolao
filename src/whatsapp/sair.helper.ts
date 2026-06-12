/**
 * v3.30.0 — Extrai o nome de bolão citado inline num comando de "sair".
 *
 * Caso real (Mauricio 11/06): usuário com 2 bolões (admin de um,
 * participante do outro) tentou "sair do bolao 2" pra escolher, mas o
 * número era ignorado. Agora "sair do bolão da firma" leva direto pra
 * confirmação daquele bolão.
 *
 * Captura o texto APÓS a palavra "bolão"/"bolao". Retorna null quando:
 *   - não há nada depois ("sair do bolão");
 *   - o resto é só número/pontuação ("sair do bolão 2") — ambíguo sem a
 *     lista numerada na tela, então cai no fluxo de pergunta;
 *   - o resto é curto demais pra ser um nome.
 *
 * O caller resolve o nome contra a lista real (matcher) e confirma — nunca
 * registra/remove nada sem o "sim".
 */
export function extrairNomeBolaoInlineSair(text: string): string | null {
  const m = (text ?? '').match(/\bbol[ãa]o\s+(.+)$/i);
  if (!m) return null;

  let resto = m[1].trim();
  // precisa ter ao menos uma letra (descarta "2", "10", pontuação)
  if (!/[a-zà-ú]/i.test(resto)) return null;
  // remove artigo/preposição inicial ("do/da/de/o/a")
  resto = resto.replace(/^(?:do|da|de|o|a)\s+/i, '').trim();
  if (resto.length < 2) return null;
  // descarta resíduo que é só artigo/preposição ("sair do bolão do")
  if (/^(?:do|da|de|os|as|no|na|dos|das)$/i.test(resto)) return null;

  return resto;
}
