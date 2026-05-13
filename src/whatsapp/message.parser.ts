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
  ABRIR_RODADA = 'ABRIR_RODADA',     // admin querendo abrir/iniciar rodada
  COMO_CONVIDAR = 'COMO_CONVIDAR',   // como compartilhar bolao com convidados
  SAIR_BOLAO = 'SAIR_BOLAO',         // sair de um bolao
  QUEM_PARTICIPA = 'QUEM_PARTICIPA', // listar participantes
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

// Aceita varios separadores entre os placares: x/X, " a ", " - ", " por ".
// "x"/"X"/"-" podem vir colados ou com espacos; "a"/"por" exigem espacos
// em volta pra nao casar com palavras (tipo "Acre"). Suporta:
//   "Brasil 2x1 Marrocos"
//   "Brasil 2 X 1 Marrocos"
//   "Brasil 2-1 Marrocos"
//   "Brasil 2 a 1 Marrocos"
//   "Brasil 2 por 1 Marrocos"
const PALPITE_REGEX = /^(.+?)\s+(\d+)\s*(?:[xX-]|\s+(?:a|por)\s+)\s*(\d+)\s+(.+)$/;

// Mapa de numeros por extenso → digito. So 0-10 — placar maior que 10 eh
// raro o suficiente pra forcar o usuario a digitar.
const NUMEROS_EXTENSO: Record<string, string> = {
  zero: '0',
  um: '1', uma: '1',
  dois: '2', duas: '2',
  tres: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  sete: '7',
  oito: '8',
  nove: '9',
  dez: '10',
};

/**
 * Substitui numeros por extenso por digitos. So toca palavras inteiras
 * (\b...\b). Aplicado no texto NORMALIZADO (sem acento), entao trata
 * "três" e "tres" igual.
 */
function substituirNumerosExtenso(textoNormalizado: string): string {
  let resultado = textoNormalizado;
  for (const [palavra, digito] of Object.entries(NUMEROS_EXTENSO)) {
    const re = new RegExp(`\\b${palavra}\\b`, 'g');
    resultado = resultado.replace(re, digito);
  }
  return resultado;
}

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
// Cobre tambem inversao "jogos proximos" e variantes com "qual/quais".
const PROXIMOS_JOGOS_PATTERNS: RegExp[] = [
  /\bproximos? jogos?\b/,
  /\bjogos? proximos?\b/, // ordem invertida — Bug 4
  /\bquais (?:os )?proximos? jogos?\b/,
  /\bquais (?:os )?jogos? proximos?\b/,
  /\bjogos? que (?:ainda )?(?:nao palpitei|faltam|tem)\b/,
  /\bo que (?:ainda )?(?:nao palpitei|falta palpitar)\b/,
  /\bquais (?:eu )?(?:ainda )?(?:nao palpitei|preciso palpitar)\b/,
  /\bjogos? pendentes?\b/,
  /\bfaltam quais? jogos?\b/,
  /\bquero palpitar\b/,
  /\bbora palpitar\b/,
  /\blista (?:de )?jogos?\b/,
  /\bme mostra os jogos?\b/,
  /\bmostra(?:r)? os jogos?\b/,
  /\bver os jogos?\b/,
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

// "Abrir rodada / iniciar / começar bolao"
const ABRIR_RODADA_PATTERNS: RegExp[] = [
  /\babrir rodada\b/,
  /\biniciar rodada\b/,
  /\bcomec[aá]r rodada\b/,
  /\bcomec[aá]r o bol(?:a|o)o\b/,
  /\babre (?:os )?palpites?\b/,
  /\babrir (?:os )?palpites?\b/,
  /\biniciar (?:os )?palpites?\b/,
  /\bcomo (?:eu )?(?:abro|inicio|comeco)( a)? rodada\b/,
];

// "Como convidar / compartilhar / chamar gente"
const COMO_CONVIDAR_PATTERNS: RegExp[] = [
  /\bcomo (?:eu )?(?:convido|compartilho|chamo)\b/,
  /\bcomo (?:fac[oç]o pra )?(?:convidar|chamar)\b/,
  /\bmandar (?:o )?convite\b/,
  /\bpegar (?:o )?(?:convite|link|id)( do bol)?/,
  /\bconvidar (?:pessoas?|gente|amigos?|galera)\b/,
  /\bcomo (?:eu )?(?:adiciono|add) (?:gente|amigos?|pessoas?)\b/,
  /\bquero (?:convidar|chamar) (?:gente|amigos?|pessoas?|galera)\b/,
  /\bmensagem de convite\b/,
];

// "Sair do bolao / quero sair"
const SAIR_BOLAO_PATTERNS: RegExp[] = [
  /\bsair (?:de|do)? bol(?:a|o)o\b/,
  /\bquero sair\b/,
  /\bme (?:tira|remove)\b/,
  /\bnao quero mais (?:jogar|participar)\b/,
  /\bdesistir do bol(?:a|o)o\b/,
];

// "Quem participa / quem esta no bolao / lista do bolao"
const QUEM_PARTICIPA_PATTERNS: RegExp[] = [
  /\bquem (?:ta|esta) no bol(?:a|o)o\b/,
  /\bquem participa\b/,
  /\bquem (?:joga|esta jogando) no bol/,
  /\blista (?:de )?(?:participantes?|gente|jogadores?)\b/,
  /\bparticipantes do bol/,
];

// "Pendentes / tem solicitacao / tem pedido pra aprovar"
// (admin perguntando sobre solicitacoes pendentes — mais permissivo
// pra nao cair em APROVAR_NOMEADO com nome=\"tem pedido\")
const PENDENTES_PATTERNS: RegExp[] = [
  /\btem (?:algum |alguma )?(?:pedido|solicita[cç][aã]o|aprova[cç][aã]o|gente|pessoa) (?:pra|para) aprovar\b/,
  /\btem (?:algum |alguma )?(?:pedido|solicita[cç][aã]o)s? pendentes?\b/,
  /\b(?:quais )?aprovac[oõ]es pendentes\b/,
  /\b(?:quais )?pedidos? pendentes?\b/,
  /\bquem (?:esta|ta) (?:esperando|aguardando) (?:aprova[cç][aã]o|pra entrar)\b/,
  /\balguem (?:querendo|pedindo)(?: (?:pra|para))? entrar\b/,
];

const INTENT_RULES: IntentRules[] = [
  // Ordem: mais especificos antes
  { intencao: Intencao.PENDENTES, padroes: PENDENTES_PATTERNS },
  { intencao: Intencao.COMO_CONVIDAR, padroes: COMO_CONVIDAR_PATTERNS },
  { intencao: Intencao.ABRIR_RODADA, padroes: ABRIR_RODADA_PATTERNS },
  { intencao: Intencao.SAIR_BOLAO, padroes: SAIR_BOLAO_PATTERNS },
  { intencao: Intencao.QUEM_PARTICIPA, padroes: QUEM_PARTICIPA_PATTERNS },
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

/**
 * Remove saudações no início da mensagem ("oi bot, quais os próximos jogos?")
 * pra desbloquear o matching das intents reais. Idempotente, não destrutivo:
 * se após o strip sobrar string vazia, devolve o original.
 */
function stripSaudacao(textoNormalizado: string): string {
  const SAUDACAO_PREFIX_REGEX =
    /^(?:oi+e?\b|ola\b|hey\b|opa+\b|salve\b|fala\b|eaee?\b|bom dia\b|boa tarde\b|boa noite\b|iae?\b|opa bol(?:a|o)o\b|opa bot\b)\b[\s,!.;:]*/;
  let resultado = textoNormalizado;
  // pode ter encadeado: "oi, opa, fala" — aplica ate 3x
  for (let i = 0; i < 3; i++) {
    const novo = resultado.replace(SAUDACAO_PREFIX_REGEX, '').trim();
    if (novo === resultado) break;
    resultado = novo;
  }
  return resultado.length > 0 ? resultado : textoNormalizado;
}

export function parseIntencao(text: string): ParsedMessage {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Saudacao "sozinha" — matching exato
  if (SAUDACOES.has(norm)) {
    return { intencao: Intencao.SAUDACAO, raw, args: [] };
  }

  // Saudacao SEGUIDA de outra intent ("oi, ranking", "opa bolao quais
  // proximos jogos"): faz strip da saudacao e tenta matchIntent no resto.
  const semSaudacao = stripSaudacao(norm);
  if (semSaudacao !== norm && semSaudacao.length >= 3) {
    const intentEmbutida = matchIntent(semSaudacao);
    if (intentEmbutida) {
      return { intencao: intentEmbutida, raw, args: [] };
    }
    // Se o resto nao casou intent conhecida, considera SAUDACAO pura
    // pra manter UX amigavel (o classifier LLM ainda pode pegar depois
    // se a frase for natural complexa).
    if (norm.length <= semSaudacao.length + 10) {
      // saudacao curta + texto curto sem match → SAUDACAO + texto pro user
      return { intencao: Intencao.SAUDACAO, raw, args: [] };
    }
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

  // Palpite inline — "Flamengo 2x1 Palmeiras", "Brasil 2 a 1 Marrocos",
  // "Brasil dois a um Marrocos", etc.
  // (depois das intent rules, pra "quero palpitar" nao virar palpite_inline)
  //
  // Tenta 1) string toda; 2) se houver multiplas linhas, primeira linha
  // que casa palpite (pra cobrir multi-palpite em IDLE — handler depois
  // re-parseia com parseMultiplePalpites).
  let palpite = tentarParsearPalpiteInline(raw);
  if (!palpite && raw.includes('\n')) {
    for (const linha of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const p = tentarParsearPalpiteInline(linha);
      if (p) {
        palpite = p;
        break;
      }
    }
  }
  if (palpite) {
    return {
      intencao: Intencao.PALPITE_INLINE,
      raw,
      args: [],
      palpite,
    };
  }

  // unused helper kept available in API surface
  void lower;

  return { intencao: Intencao.TEXTO_LIVRE, raw, args: [] };
}

/**
 * Tenta extrair palpite inline de uma linha. Estrategia:
 *   1. Aplica regex no texto bruto (formato digitos).
 *   2. Se falhar, pre-processa numeros por extenso ("dois a um" → "2 a 1")
 *      e tenta de novo.
 *
 * Retorna `null` se nada bateu.
 */
function tentarParsearPalpiteInline(linha: string): PalpiteInline | null {
  const direto = linha.match(PALPITE_REGEX);
  if (direto) {
    return {
      timeCasa: direto[1].trim(),
      golsCasa: parseInt(direto[2], 10),
      golsVisitante: parseInt(direto[3], 10),
      timeVisitante: direto[4].trim(),
    };
  }

  // Substitui extenso no texto original (preserva case dos times)
  // mas operando palavra a palavra de forma case-insensitive
  const comDigitos = linha.replace(
    /\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/gi,
    (m) => NUMEROS_EXTENSO[m.toLowerCase()] ?? m,
  );
  if (comDigitos !== linha) {
    const segunda = comDigitos.match(PALPITE_REGEX);
    if (segunda) {
      return {
        timeCasa: segunda[1].trim(),
        golsCasa: parseInt(segunda[2], 10),
        golsVisitante: parseInt(segunda[3], 10),
        timeVisitante: segunda[4].trim(),
      };
    }
  }

  return null;
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
    const p = tentarParsearPalpiteInline(line);
    if (p) palpites.push(p);
  }
  return palpites;
}

// Suprime "imports usados apenas pelo regex"
void substituirNumerosExtenso;
