/**
 * Parser de acoes do admin para aprovar/recusar solicitacoes em
 * linguagem natural — sem precisar dos comandos `!aprovar nome`.
 *
 * Eh chamado APENAS quando:
 *   1. O usuario eh admin de algum bolao
 *   2. Existe ao menos uma solicitacao PENDENTE pra ele
 *   3. O estado da FSM esta em IDLE (nao interrompe outros fluxos)
 *
 * Devolve uma intencao estruturada que o router usa pra decidir o
 * proximo passo. Se nada bateu, devolve null e o router segue o
 * caminho normal (parser principal + LLM fallback).
 */

export type AdminAcao =
  | { tipo: 'APROVAR_TODOS' }
  | { tipo: 'RECUSAR_TODOS' }
  | { tipo: 'APROVAR_NOMEADO'; nome: string }
  | { tipo: 'RECUSAR_NOMEADO'; nome: string }
  // "Afirmativo/Negativo generico" — admin respondeu sem dizer nome.
  // Caller resolve: se ha 1 pendente, aplica nele; se ha varios, pergunta qual.
  | { tipo: 'AFIRMATIVO_GENERICO' }
  | { tipo: 'NEGATIVO_GENERICO' };

// Sinonimos de "aprovar" — em ordem de prioridade pra extracao do nome.
// (palavras-frase tipo "ta dentro" precisam vir antes pra nao fragmentar)
const APROVAR_FRASES: string[] = [
  'aprovar todos', 'aprovado todos', 'aprovado tudo', 'aprovar todas',
  'libera geral', 'libera todos', 'libera todas', 'libera todo mundo',
  'aceito todos', 'aceito geral', 'pode todos', 'todos aprovados',
  'aprovar geral', 'aprovado geral', 'aprovo geral', 'ok geral',
  'ok pra todos', 'ok pra todo mundo', 'ok pra geral',
];

const RECUSAR_FRASES: string[] = [
  'recusar todos', 'recusar todas', 'recusado todos', 'recusa geral',
  'rejeitar todos', 'rejeitar todas', 'rejeitado todos', 'rejeitar geral',
  'recusar geral', 'nao aprovo ninguem', 'nao aprovo nenhum', 'fora todos',
];

const APROVAR_KEYWORDS: string[] = [
  'aprovado', 'aprovar', 'aprovo', 'aprova',
  'autorizado', 'autorizar', 'autorizo', 'autoriza',
  'aceito', 'aceita', 'aceitar', 'aceitou',
  'liberado', 'liberar', 'libera', 'libero',
  'pode entrar', 'ta dentro', 'esta dentro', 'ta liberado', 'esta liberado',
  'manda ver', 'fechado', 'positivo', 'beleza',
  'pode', 'ok', 'sim', 'show', 'tranquilo',
  'pode sim', 'ta certo', 'ta tranquilo', 'bora',
];

const RECUSAR_KEYWORDS: string[] = [
  'recusado', 'recusar', 'recuso', 'recusa',
  'rejeitado', 'rejeitar', 'rejeito', 'rejeita',
  'negado', 'negar', 'nega',
  'bloquear', 'bloqueia', 'banido', 'banir',
  'nao aprovo', 'nao autorizo', 'nao aceito', 'nao deixa', 'nao pode',
  'fora', 'jamais', 'negativo',
  'nao', 'naum',
];

// Palavras que marcam "todos" / coletivo
const TODOS_REGEX = /\b(?:todos|todas|tudo|geral|geralzao|todo mundo|galera toda)\b/;

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[!?,.;:]/g, ' ')
    .replace(/\s+/g, ' ');
}

function temKeyword(norm: string, keywords: string[]): string | null {
  // Procura primeiro frases compostas (sao mais especificas) depois palavras
  for (const k of keywords) {
    if (k.includes(' ')) {
      if (norm.includes(k)) return k;
    }
  }
  for (const k of keywords) {
    if (!k.includes(' ')) {
      const re = new RegExp(`\\b${k}\\b`);
      if (re.test(norm)) return k;
    }
  }
  return null;
}

function temFrase(norm: string, frases: string[]): boolean {
  return frases.some((f) => norm.includes(f));
}

/**
 * Tenta extrair um candidato a nome do solicitante. Estrategia: pega o
 * texto, remove acentos, remove a primeira keyword encontrada e tambem
 * palavras de "todos/recusa/aprovacao" pra sobrar so o nome.
 *
 * Retorna o nome trimmado em titulo, ou null se nao sobrou nada util.
 */
function extrairNomeAposKeyword(textoOriginal: string, keywords: string[]): string | null {
  let texto = textoOriginal.trim();
  // remove pontuacao + colapsa espacos
  texto = texto.replace(/[!?,.;:]/g, ' ').replace(/\s+/g, ' ');

  // Identifica posicao da keyword no texto NORMALIZADO mas remove na
  // string original pra preservar capitalizacao do nome
  const textoLower = texto.toLowerCase();
  const norm = normalize(texto);

  // Procura a keyword mais longa primeiro (mais especifica)
  const ordenadas = [...keywords].sort((a, b) => b.length - a.length);
  let removeu = false;
  for (const k of ordenadas) {
    const re = new RegExp(`\\b${k.replace(/\s/g, '\\s+')}\\b`, 'i');
    if (re.test(norm) && re.test(textoLower)) {
      texto = texto.replace(re, ' ');
      removeu = true;
      break;
    }
  }
  if (!removeu) return null;

  // Remove palavras conectoras + "todos". IMPORTANTE: usar tokenizacao
  // por whitespace em vez de \b\w\b porque palavras com acento (Joao =>
  // J-o-a-tilde-o em NFD) sao split-adas em "letras + nao-letras", e o
  // regex \bo\b acabaria deletando o "o" final/inicial de nomes como
  // "Joao". Mais robusto: filtrar por token completo.
  const stopwords = new Set([
    'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'de',
    'pro', 'pra', 'para', 'esse', 'essa', 'este', 'esta',
    'todos', 'todas', 'tudo', 'geral', 'geralzao',
  ]);
  texto = texto
    .split(/\s+/)
    .filter((tok) => tok.length > 0 && !stopwords.has(normalize(tok)))
    .join(' ')
    .trim();

  if (texto.length < 2) return null;
  // Nao queremos "todos" ou puro stopword como nome
  if (TODOS_REGEX.test(normalize(texto))) return null;
  return texto;
}

export function detectarAcaoAdmin(textoOriginal: string): AdminAcao | null {
  if (!textoOriginal || !textoOriginal.trim()) return null;

  const norm = normalize(textoOriginal);

  // Etapa 1: frases compostas explicitas de "todos"
  if (temFrase(norm, APROVAR_FRASES)) return { tipo: 'APROVAR_TODOS' };
  if (temFrase(norm, RECUSAR_FRASES)) return { tipo: 'RECUSAR_TODOS' };

  const aprovarKw = temKeyword(norm, APROVAR_KEYWORDS);
  const recusarKw = temKeyword(norm, RECUSAR_KEYWORDS);
  const temTodos = TODOS_REGEX.test(norm);

  // Etapa 2: keyword + "todos" → acao em lote
  if (aprovarKw && temTodos) return { tipo: 'APROVAR_TODOS' };
  if (recusarKw && temTodos) return { tipo: 'RECUSAR_TODOS' };

  // Etapa 3: keyword + provavel nome → acao nomeada
  if (recusarKw) {
    const nome = extrairNomeAposKeyword(textoOriginal, RECUSAR_KEYWORDS);
    if (nome) return { tipo: 'RECUSAR_NOMEADO', nome };
    return { tipo: 'NEGATIVO_GENERICO' };
  }

  if (aprovarKw) {
    const nome = extrairNomeAposKeyword(textoOriginal, APROVAR_KEYWORDS);
    if (nome) return { tipo: 'APROVAR_NOMEADO', nome };
    return { tipo: 'AFIRMATIVO_GENERICO' };
  }

  return null;
}
