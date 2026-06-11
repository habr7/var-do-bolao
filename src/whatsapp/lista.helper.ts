/**
 * Helpers pra renderizar e parsear listas numeradas de bolaes.
 *
 * Antes desta versao, quando o bot pedia "qual bolao?" e mostrava uma
 * lista, o usuario tinha que digitar o nome (fuzzy). Agora:
 *
 *   *Bolao da Jeni*       (codigo: #K3MZ8P)
 *   1. Bolao da Jeni
 *   2. Bolao do Joao
 *
 * E o usuario pode responder "1", "Bolao da Jeni" ou "#K3MZ8P".
 *
 * O `parseEscolhaBolao` resolve a escolha tentando, em ordem:
 *   1. Indice numerico (1-based)
 *   2. Codigo curto (#ABCD12)
 *   3. Nome via match fuzzy (substring case+acento-insensitivo)
 *
 * Quando ambiguo ou nao bateu, retorna null. O caller faz fallback LLM
 * (em bolao.matcher.ts).
 */

export interface BolaoListaItem {
  id: string;
  nome: string;
  codigo?: string;
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .trim();
}

/**
 * Renderiza lista numerada (1-based) pra mensagem do bot.
 *   `1. Bolao da Jeni` (`#K3MZ8P`)
 */
export function formatarBoloesNumerados(boloes: BolaoListaItem[]): string {
  if (boloes.length === 0) return '_(nenhum bolao)_';
  return boloes
    .map((b, i) => {
      const codigo = b.codigo ? ` (\`#${b.codigo}\`)` : '';
      return `${i + 1}. *${b.nome}*${codigo}`;
    })
    .join('\n');
}

/**
 * Dica padrao que o bot adiciona apos listas com numeracao, pra
 * reforcar que o usuario pode responder so com o numero.
 */
export const DICA_RESPOSTA_NUMERICA =
  '_Pode responder com o número correspondente que é mais fácil pra você._';

/**
 * Helper que monta a mensagem inteira: pergunta + lista numerada + dica.
 *
 * Uso:
 *   const texto = montarPerguntaListaBoloes(
 *     'De qual bolão você quer ver os participantes?',
 *     boloes,
 *   );
 */
export function montarPerguntaListaBoloes(
  pergunta: string,
  boloes: BolaoListaItem[],
): string {
  return `${pergunta}\n\n${formatarBoloesNumerados(boloes)}\n\n${DICA_RESPOSTA_NUMERICA}`;
}

/**
 * Tenta resolver a escolha do usuario contra uma lista numerada.
 * Retorna o item escolhido ou null se nao bateu.
 *
 * Estrategias em ordem:
 *   1. Indice numerico: "1", " 2 ", "1." → boloes[index-1].
 *      Aceita prefixo numerico ate o primeiro caractere nao-digito.
 *      Ex: "1 quero esse" tambem casa, mas "10x" cai pra index=10
 *      (out of range → null, sem invadir).
 *   2. Codigo: "#K3MZ8P" ou "K3MZ8P" → boloes[?].codigo == "K3MZ8P".
 *   3. Nome fuzzy: substring bidirecional case+acento-insensitivo.
 */
/**
 * v3.12.0 — detecta se o user respondeu "todos" / "ambos" / "tudo" /
 * "all" (em variantes comuns), indicando que quer aplicar a operação
 * em TODOS os bolões da lista, não escolher um.
 *
 * Caso real (Bruna 10/06): user em 2 bolões teve que mandar a lista
 * de 10 palpites 2x, 36 mensagens total. Solução: quando houver >1
 * bolões na lista, oferecemos uma opção EXTRA "TODOS" — se user
 * responder essa palavra (ou o índice N+1), aplica em todos.
 *
 * Aceita:
 *   - "todos" / "todas" / "todos os bolões"
 *   - "ambos" (quando lista tem exatamente 2)
 *   - "tudo" / "ambas"
 *   - "all" (gringuês)
 *   - Índice N+1 (o item EXTRA depois da lista de bolões)
 */
export function ehEscolhaTodos(texto: string, totalBoloesNaLista: number): boolean {
  const t = normalize(texto);
  // Palavra-chave
  if (/^(todos|todas|tudo|ambos|ambas|all)(\s+(?:os|as)?\s*(?:bol[ãa]o|bol[oõ]es))?\s*$/.test(t)) {
    return true;
  }
  // Índice N+1 (a opção EXTRA renderizada depois dos bolões)
  const matchIdx = texto.trim().match(/^(\d{1,2})\b/);
  if (matchIdx) {
    const idx = parseInt(matchIdx[1], 10);
    if (idx === totalBoloesNaLista + 1) return true;
  }
  return false;
}

export function parseEscolhaBolao(
  texto: string,
  boloes: BolaoListaItem[],
): BolaoListaItem | null {
  if (boloes.length === 0) return null;
  const trimmed = texto.trim();
  if (!trimmed) return null;

  // 1) Indice numerico no inicio
  const matchIdx = trimmed.match(/^(\d{1,2})\b/);
  if (matchIdx) {
    const idx = parseInt(matchIdx[1], 10);
    if (idx >= 1 && idx <= boloes.length) {
      return boloes[idx - 1];
    }
    // numero fora do range: nao quer dizer que falhou tudo
    // (segue pra outras estrategias — talvez o nome do bolao
    // comece com um numero "1986")
  }

  // 2) Codigo curto
  const matchCodigo = trimmed.match(/^#?([A-Z0-9]{4,8})$/i);
  if (matchCodigo) {
    const c = matchCodigo[1].toUpperCase();
    const porCodigo = boloes.find((b) => b.codigo && b.codigo.toUpperCase() === c);
    if (porCodigo) return porCodigo;
  }

  // 3) Match exato (case+acento-insensitivo)
  const alvo = normalize(trimmed);
  const exato = boloes.find((b) => normalize(b.nome) === alvo);
  if (exato) return exato;

  // 4) Nome fuzzy — substring bidirecional. Mais longo ganha.
  const matches = boloes.filter((b) => {
    const norm = normalize(b.nome);
    return norm.includes(alvo) || alvo.includes(norm);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    matches.sort((a, b) => b.nome.length - a.nome.length);
    return matches[0];
  }

  return null;
}
