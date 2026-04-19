/**
 * Parser de mensagens em DM.
 *
 * Diferente da v1, em DM a maior parte do fluxo e guiada por estado (FSM) —
 * o usuario envia texto livre e o command.router decide o que fazer baseado
 * no estado atual. Este parser so identifica intencoes principais e palpites
 * inline.
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

const SAUDACOES = new Set(['oi', 'ola', 'olá', 'hey', 'e ai', 'eai', 'bom dia', 'boa tarde', 'boa noite']);
const MENU_WORDS = new Set(['menu', 'inicio', 'início', 'home', 'começar', 'comecar']);
const AJUDA_WORDS = new Set(['ajuda', 'help', '?', 'comandos']);
const CANCELAR_WORDS = new Set(['cancelar', 'cancela', 'sair', 'parar']);

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function parseIntencao(text: string): ParsedMessage {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Saudacoes / menu
  if (SAUDACOES.has(norm) || norm.startsWith('oi ')) {
    return { intencao: Intencao.SAUDACAO, raw, args: [] };
  }
  if (MENU_WORDS.has(norm)) {
    return { intencao: Intencao.MENU, raw, args: [] };
  }
  if (AJUDA_WORDS.has(norm) || norm === '!ajuda') {
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

  // Intencoes de alto nivel
  if (norm.startsWith('criar bolao') || norm === 'criar') {
    return { intencao: Intencao.CRIAR_BOLAO, raw, args: [] };
  }
  if (norm.startsWith('entrar em bolao') || norm.startsWith('entrar bolao') || norm === 'entrar') {
    return { intencao: Intencao.ENTRAR_BOLAO, raw, args: [] };
  }
  if (norm === 'meus boloes' || norm === 'meus bolões' || lower === 'meus bolões') {
    return { intencao: Intencao.MEUS_BOLOES, raw, args: [] };
  }
  if (norm.startsWith('ranking')) {
    const rest = raw.slice(7).trim();
    return {
      intencao: Intencao.RANKING,
      raw,
      args: rest ? [rest] : [],
    };
  }
  if (norm.startsWith('meus pontos')) {
    const rest = raw.slice(11).trim();
    return {
      intencao: Intencao.MEUS_PONTOS,
      raw,
      args: rest ? [rest] : [],
    };
  }
  if (norm.startsWith('jogos hoje') || norm === 'jogos' || norm.startsWith('hoje')) {
    const rest = raw.replace(/^jogos hoje|^jogos|^hoje/i, '').trim();
    return {
      intencao: Intencao.JOGOS_HOJE,
      raw,
      args: rest ? [rest] : [],
    };
  }
  if (norm.startsWith('meu palpite') || norm.startsWith('meus palpites')) {
    const rest = raw.replace(/^meu palpite|^meus palpites/i, '').trim();
    return {
      intencao: Intencao.MEU_PALPITE,
      raw,
      args: rest ? [rest] : [],
    };
  }

  // Palpite inline — "Flamengo 2x1 Palmeiras"
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
