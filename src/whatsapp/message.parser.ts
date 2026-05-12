/**
 * Parser de mensagens em DM.
 *
 * Diferente da v1, em DM a maior parte do fluxo e guiada por estado (FSM) —
 * o usuario envia texto livre e o command.router decide o que fazer baseado
 * no estado atual. Este parser so identifica intencoes principais e palpites
 * inline.
 *
 * Camada 1 (regex/keywords): rapida, gratis, cobre ~80% das mensagens
 * comuns. Definida aqui.
 *
 * Camada 2 (LLM intent.classifier): fallback quando regex falha. Captura
 * variantes coloquiais que nao caberiam em regex razoavel.
 */

export enum Intencao {
  // Intencoes em IDLE
  SAUDACAO = 'SAUDACAO',
  MENU = 'MENU',
  CRIAR_BOLAO = 'CRIAR_BOLAO',
  ENTRAR_BOLAO = 'ENTRAR_BOLAO',
  MEUS_BOLOES = 'MEUS_BOLOES',
  RANKING = 'RANKING',
  MEUS_PONTOS = 'MEUS_PONTOS',
  JOGOS_HOJE = 'JOGOS_HOJE',
  PROXIMOS_JOGOS = 'PROXIMOS_JOGOS', // jogos que ainda nao rolaram + status de palpite
  MEU_PALPITE = 'MEU_PALPITE',
  AJUDA = 'AJUDA',
  CANCELAR = 'CANCELAR',

  // Intencoes de admin
  APROVAR = 'APROVAR',
  RECUSAR = 'RECUSAR',
  PENDENTES = 'PENDENTES',

  // Fora da FSM
  PALPITE_INLINE = 'PALPITE_INLINE',
  TEXTO_LIVRE = 'TEXTO_LIVRE',
}

export interface ParsedMessage {
  intencao: Intencao;
  raw: string;
  args: string[];
  palpite?: PalpiteInline;
}

export interface PalpiteInline {
  timeCasa: string;
  golsCasa: number;
  golsVisitante: number;
  timeVisitante: string;
}

const PALPITE_REGEX = /^(.+?)\s+(\d+)\s*[xX]\s*(\d+)\s+(.+)$/;

const SAUDACOES = new Set([
  'oi', 'ola', 'hey', 'e ai', 'eai', 'bom dia', 'boa tarde', 'boa noite',
  'salve', 'fala', 'eaee', 'eae', 'iae', 'iaee', 'opa', 'oiee', 'oie',
]);
const MENU_WORDS = new Set([
  'menu', 'inicio', 'home', 'comecar', 'voltar', 'principal', 'start',
]);
const AJUDA_WORDS = new Set([
  'ajuda', 'help', '?', 'comandos', 'duvida', 'duvidas',
]);
const CANCELAR_WORDS = new Set([
  'cancelar', 'cancela', 'sair', 'parar', 'esquece', 'deixa', 'deixa pra la',
  'pode parar', 'chega', 'desiste',
]);

/**
 * Padroes de linguagem natural por intencao. Cada padrao eh testado no
 * texto NORMALIZADO (lowercase + sem acentos). Idea: absorver o maximo
 * de variantes naturais sem precisar do LLM no caminho comum. Ordem
 * importa: matches mais especificos primeiro.
 */
type IntentRules = { intencao: Intencao; padroes: RegExp[] };

// "Meus palpites / quais palpitei / o que palpitei"
const MEU_PALPITE_PATTERNS: RegExp[] = [
  /^meus? palpites?\b/,
  /\bquais (?:sao )?(?:os )?meus palpites?\b/,
  /\b(?:o )?que (?:eu )?(?:palpitei|chutei|apostei)\b/,
  /\bmeus chutes?\b/,
  /\bpalpites? que (?:eu )?(?:dei|fiz|registrei)\b/,
  /\bver meus palpites?\b/,
];

// "Proximos jogos / quais jogos faltam / o que ainda nao palpitei"
const PROXIMOS_JOGOS_PATTERNS: RegExp[] = [
  /\bproximos? jogos?\b/,
  /\bquais (?:os )?proximos? jogos?\b/,
  /\bjogos? que (?:ainda )?(?:nao palpitei|faltam|tem)\b/,
  /\bo que (?:ainda )?(?:nao palpitei|falta palpitar)\b/,
  /\bquais (?:eu )?(?:ainda )?(?:nao palpitei|preciso palpitar)\b/,
  /\bjogos? pendentes?\b/,
  /\bfaltam quais? jogos?\b/,
  /\bquero palpitar\b/,
  /\bbora palpitar\b/,
];

// "Jogos hoje / agenda"
const JOGOS_HOJE_PATTERNS: RegExp[] = [
  /\bjogos? (?:de )?hoje\b/,
  /\btem jogo (?:hoje|agora)\b/,
  /\bagenda\b/,
  /\bquais jogos? (?:vao|tao|tem) (?:hoje|rolando|acontecendo)\b/,
  /\bo que tem hoje\b/,
];

// "Meus pontos / quanto fiz"
const MEUS_PONTOS_PATTERNS: RegExp[] = [
  /^meus? pontos?\b/,
  /\bquantos? ponto/,
  /\bquanto (?:eu )?fiz\b/,
  /\bminha pontuacao\b/,
  /\bmeu placar\b/,
  /\bestou (?:em )?qual (?:posicao|lugar)\b/,
  /\bem que (?:posicao|lugar) (?:eu )?(?:estou|to)\b/,
];

// "Meus boloes / onde participo"
const MEUS_BOLOES_PATTERNS: RegExp[] = [
  /^meus? bol(?:o|a)es\b/,
  /\bquais (?:sao )?(?:os )?meus bol(?:o|a)es\b/,
  /\bquais bol(?:o|a)es\b/,
  /\bonde (?:eu )?(?:participo|jogo|to)\b/,
  /\bbol(?:o|a)es que (?:eu )?(?:participo|to)\b/,
];

// "Criar bolao / abrir / montar / fazer novo"
const CRIAR_BOLAO_PATTERNS: RegExp[] = [
  /^criar (?:um )?bol(?:a|o)o\b/,
  /^criar$/,
  /\b(?:quero|bora|vamos|gostaria de) (?:criar|abrir|montar|fazer)(?: um)? bol(?:a|o)o\b/,
  /\b(?:abrir|montar|fazer)(?: um)? bol(?:a|o)o (?:novo|new)\b/,
  /\bnovo bol(?:a|o)o\b/,
];

// "Entrar em bolao / participar"
const ENTRAR_BOLAO_PATTERNS: RegExp[] = [
  /^entrar(?: em| no)?(?: bol(?:a|o)o)?$/,
  /\b(?:quero|gostaria de|posso) entrar (?:em|no)?\s*bol/,
  /\bentrar (?:em|num|no) bol(?:a|o)o\b/,
  /\bme add (?:em|num|no) bol/,
  /\bquero participar\b/,
  /\bjuntar (?:no|num|em) bol/,
  /\bquero jogar\b/,
];

// "Ranking / classificacao"
const RANKING_PATTERNS: RegExp[] = [
  /^ranking\b/,
  /\bclassificacao\b/,
  /\bquem (?:ta|esta) na frente\b/,
  /\bquem (?:ta|esta) ganhando\b/,
  /\btabela do bol/,
];

const INTENT_RULES: IntentRules[] = [
  // Ordem: mais especificos antes (palpite tem prioridade)
  { intencao: Intencao.MEU_PALPITE, padroes: MEU_PALPITE_PATTERNS },
  { intencao: Intencao.PROXIMOS_JOGOS, padroes: PROXIMOS_JOGOS_PATTERNS },
  { intencao: Intencao.MEUS_PONTOS, padroes: MEUS_PONTOS_PATTERNS },
  { intencao: Intencao.MEUS_BOLOES, padroes: MEUS_BOLOES_PATTERNS },
  { intencao: Intencao.JOGOS_HOJE, padroes: JOGOS_HOJE_PATTERNS },
  { intencao: Intencao.CRIAR_BOLAO, padroes: CRIAR_BOLAO_PATTERNS },
  { intencao: Intencao.ENTRAR_BOLAO, padroes: ENTRAR_BOLAO_PATTERNS },
  { intencao: Intencao.RANKING, padroes: RANKING_PATTERNS },
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function matchIntent(norm: string): Intencao | null {
  for (const { intencao, padroes } of INTENT_RULES) {
    if (padroes.some((p) => p.test(norm))) {
      return intencao;
    }
  }
  return null;
}

export function parseIntencao(text: string): ParsedMessage {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Saudacoes / menu (matching exato em palavras curtas)
  if (SAUDACOES.has(norm) || norm.startsWith('oi ') || norm.startsWith('bom dia ') || norm.startsWith('boa tarde ') || norm.startsWith('boa noite ')) {
    return { intencao: Intencao.SAUDACAO, raw, args: [] };
  }
  if (MENU_WORDS.has(norm)) {
    return { intencao: Intencao.MENU, raw, args: [] };
  }
  if (AJUDA_WORDS.has(norm) || norm === '!ajuda' || norm.startsWith('como funciona') || norm.startsWith('o que (?:vc|voce) faz')) {
    return { intencao: Intencao.AJUDA, raw, args: [] };
  }
  if (CANCELAR_WORDS.has(norm)) {
    return { intencao: Intencao.CANCELAR, raw, args: [] };
  }

  // Comandos explicitos de admin
  if (norm.startsWith('!aprovar ')) {
    return {
      intencao: Intencao.APROVAR,
      raw,
      args: [raw.slice('!aprovar'.length).trim()],
    };
  }
  if (norm.startsWith('!recusar ')) {
    return {
      intencao: Intencao.RECUSAR,
      raw,
      args: [raw.slice('!recusar'.length).trim()],
    };
  }
  if (norm === '!pendentes' || norm === 'pendentes') {
    return { intencao: Intencao.PENDENTES, raw, args: [] };
  }

  // Padroes de linguagem natural (intent rules) — cobre maioria das
  // variantes coloquiais. Roda antes do palpite-inline pra que "quero
  // palpitar" nao caia em PALPITE_INLINE.
  const intentPorPadrao = matchIntent(norm);
  if (intentPorPadrao) {
    // Pra ranking, extrai possivel argumento ("ranking firma fc")
    if (intentPorPadrao === Intencao.RANKING) {
      const rest = raw.replace(/^ranking\s*/i, '').trim();
      return {
        intencao: Intencao.RANKING,
        raw,
        args: rest ? [rest] : [],
      };
    }
    // Pra MEUS_PONTOS, extrai possivel argumento ("meus pontos firma fc")
    if (intentPorPadrao === Intencao.MEUS_PONTOS && /^meus? pontos?/.test(norm)) {
      const rest = raw.replace(/^meus? pontos?\s*/i, '').trim();
      return {
        intencao: Intencao.MEUS_PONTOS,
        raw,
        args: rest ? [rest] : [],
      };
    }
    // Pra MEU_PALPITE, extrai possivel argumento ("meus palpites firma fc")
    if (intentPorPadrao === Intencao.MEU_PALPITE && /^meus? palpites?/.test(norm)) {
      const rest = raw.replace(/^meu palpite|^meus palpites/i, '').trim();
      return {
        intencao: Intencao.MEU_PALPITE,
        raw,
        args: rest ? [rest] : [],
      };
    }
    return { intencao: intentPorPadrao, raw, args: [] };
  }

  // Palpite inline — "Flamengo 2x1 Palmeiras"
  // (depois das intent rules, pra "quero palpitar" nao virar palpite_inline)
  const palpiteMatch = raw.match(PALPITE_REGEX);
  if (palpiteMatch) {
    return {
      intencao: Intencao.PALPITE_INLINE,
      raw,
      args: [],
      palpite: {
        timeCasa: palpiteMatch[1].trim(),
        golsCasa: parseInt(palpiteMatch[2], 10),
        golsVisitante: parseInt(palpiteMatch[3], 10),
        timeVisitante: palpiteMatch[4].trim(),
      },
    };
  }

  // unused helper kept available in API surface
  void lower;

  return { intencao: Intencao.TEXTO_LIVRE, raw, args: [] };
}

/**
 * Parseia mensagens com varias linhas de palpite (ex: 5 palpites de uma rodada).
 * Ignora linhas invalidas.
 */
export function parseMultiplePalpites(text: string): PalpiteInline[] {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const palpites: PalpiteInline[] = [];
  for (const line of lines) {
    const m = line.match(PALPITE_REGEX);
    if (m) {
      palpites.push({
        timeCasa: m[1].trim(),
        golsCasa: parseInt(m[2], 10),
        golsVisitante: parseInt(m[3], 10),
        timeVisitante: m[4].trim(),
      });
    }
  }
  return palpites;
}
