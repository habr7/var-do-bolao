/**
 * Módulo de consulta dos dados oficiais da Copa do Mundo FIFA 2026.
 *
 * Lê os 4 JSONs gerados por `scripts/sync-copa-2026.mjs` a partir de
 * openfootball/worldcup.json (domínio público). Expõe API tipada pra
 * outras camadas do projeto (LLM grounding, comandos, etc).
 *
 * Toda função é determinística e síncrona — não chama API externa.
 * Os arquivos são lidos uma vez na primeira chamada (cache lazy).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Confederacao = 'UEFA' | 'CONMEBOL' | 'CAF' | 'AFC' | 'CONCACAF' | 'OFC';
export type LetraGrupo = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';
export type Fase =
  | 'FASE_GRUPOS'
  | 'ROUND_OF_32'
  | 'ROUND_OF_16'
  | 'QUARTAS'
  | 'SEMIS'
  | 'TERCEIRO'
  | 'FINAL';

export interface Time {
  nome: string;
  nomeIngles: string;
  fifaCode: string;
  grupo: LetraGrupo;
  confederacao: Confederacao;
  continente: string;
  bandeira: string;
}

export interface Estadio {
  nome: string;
  cidade: string;
  pais: string;
  paisCodigo: string;
  fuso: string;
  capacidade: number;
  coords: string;
}

export interface Jogo {
  id: string;
  fase: Fase;
  faseLabel: string;
  grupo: LetraGrupo | null;
  matchdayGrupo: number | null;
  matchdayGeral: number | null;
  rodadaLabel: string;
  timeCasa: string;
  timeVisitante: string;
  timeCasaDefinido: boolean;
  timeVisitanteDefinido: boolean;
  dataHora: string;
  estadio: string;
}

export interface Metadata {
  fonte: string;
  fonteUrl: string;
  atualizadoEm: string;
  arquivos: string[];
  observacao: string;
}

// ============================================================
// Carregamento lazy
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/modules/copa-2026/index.ts → src/data/copa-2026/
const DATA_DIR = join(__dirname, '..', '..', 'data', 'copa-2026');

let cacheTimes: Time[] | null = null;
let cacheJogos: Jogo[] | null = null;
let cacheEstadios: Estadio[] | null = null;
let cacheMetadata: Metadata | null = null;

function loadJson<T>(filename: string): T {
  const raw = readFileSync(join(DATA_DIR, filename), 'utf-8');
  return JSON.parse(raw) as T;
}

function getTimesRaw(): Time[] {
  if (!cacheTimes) {
    const d = loadJson<{ times: Time[] }>('teams.json');
    cacheTimes = d.times;
  }
  return cacheTimes;
}

function getJogosRaw(): Jogo[] {
  if (!cacheJogos) {
    const d = loadJson<{ jogos: Jogo[] }>('matches.json');
    cacheJogos = d.jogos;
  }
  return cacheJogos;
}

function getEstadiosRaw(): Estadio[] {
  if (!cacheEstadios) {
    const d = loadJson<{ estadios: Estadio[] }>('stadiums.json');
    cacheEstadios = d.estadios;
  }
  return cacheEstadios;
}

export function metadata(): Metadata {
  if (!cacheMetadata) {
    cacheMetadata = loadJson<Metadata>('metadata.json');
  }
  return cacheMetadata;
}

// ============================================================
// Normalização de nomes
// ============================================================

function semAcentos(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalizar(s: string): string {
  return semAcentos(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Apelidos/variações comuns em PT-BR que mapeiam pra nome canônico do JSON.
 * Mantém conservador: só sinônimos verificáveis, não giria duvidosa.
 */
const ALIASES: Record<string, string> = {
  // EUA
  eua: 'Estados Unidos',
  usa: 'Estados Unidos',
  estadosunidos: 'Estados Unidos',
  unitedstates: 'Estados Unidos',
  americanos: 'Estados Unidos',
  america: 'Estados Unidos',
  // Inglaterra
  england: 'Inglaterra',
  ingleses: 'Inglaterra',
  inglesa: 'Inglaterra',
  selecaoinglesa: 'Inglaterra',
  threelions: 'Inglaterra',
  // Brasil
  brazil: 'Brasil',
  brasileira: 'Brasil',
  selecaobrasileira: 'Brasil',
  selecao: 'Brasil',
  canarinha: 'Brasil',
  // Argentina
  albiceleste: 'Argentina',
  hermanos: 'Argentina',
  // Coreia do Sul (openfootball usa "South Korea", normalizado "Korea Republic")
  coreia: 'Coreia do Sul',
  southkorea: 'Coreia do Sul',
  koreadosul: 'Coreia do Sul',
  korea: 'Coreia do Sul',
  // República Tcheca
  tchequia: 'República Tcheca',
  czechia: 'República Tcheca',
  czechrepublic: 'República Tcheca',
  republicatcheca: 'República Tcheca',
  tcheca: 'República Tcheca',
  // Irã
  ira: 'Irã',
  iran: 'Irã',
  // Catar
  qatar: 'Catar',
  // Holanda
  netherlands: 'Holanda',
  paisesbaixos: 'Holanda',
  // Costa do Marfim
  ivorycoast: 'Costa do Marfim',
  marfim: 'Costa do Marfim',
  costademarfim: 'Costa do Marfim',
  // RD Congo
  drcongo: 'RD Congo',
  congo: 'RD Congo',
  rdcongo: 'RD Congo',
  // Cabo Verde
  capeverde: 'Cabo Verde',
  // Turquia
  turkey: 'Turquia',
  turkiye: 'Turquia',
  // Espanha
  spain: 'Espanha',
  espanhola: 'Espanha',
  laroja: 'Espanha',
  // França
  france: 'França',
  francesa: 'França',
  bleus: 'França',
  // Alemanha
  germany: 'Alemanha',
  alemaes: 'Alemanha',
  germans: 'Alemanha',
  // Portugal
  portugueses: 'Portugal',
  // Itália (não vai disputar a Copa 2026 — alias mantido pra evitar match silencioso)
  // Outros nomes 1:1 são resolvidos por substring + normalização.
};

/**
 * Resolve `input` (qualquer string do usuário) pro nome canônico em PT-BR
 * de uma seleção da Copa 2026, ou null se não der match confiável.
 */
export function normalizarNomeTime(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const norm = normalizar(input);
  if (!norm) return null;

  // 1) Alias direto
  if (ALIASES[norm]) return ALIASES[norm];

  // 2) Match exato pelo nome canônico (PT ou EN) ou código FIFA
  const times = getTimesRaw();
  for (const t of times) {
    if (normalizar(t.nome) === norm) return t.nome;
    if (normalizar(t.nomeIngles) === norm) return t.nome;
    if (t.fifaCode.toLowerCase() === norm) return t.nome;
  }

  // 3) Substring: usuário escreveu "selecao da inglaterra" ou "jogo da Espanha"
  //    Match o nome MAIS LONGO pra evitar "Coreia" colidir com "Coreia do Sul".
  let best: Time | null = null;
  for (const t of times) {
    const nNome = normalizar(t.nome);
    const nIng = normalizar(t.nomeIngles);
    if (norm.includes(nNome) || norm.includes(nIng)) {
      if (!best || normalizar(t.nome).length > normalizar(best.nome).length) {
        best = t;
      }
    }
  }
  if (best) return best.nome;

  return null;
}

// ============================================================
// Consultas
// ============================================================

export function getTimes(): Time[] {
  return [...getTimesRaw()];
}

export function getTime(busca: string): Time | null {
  const nome = normalizarNomeTime(busca);
  if (!nome) return null;
  return getTimesRaw().find((t) => t.nome === nome) ?? null;
}

export function getGrupoDoTime(busca: string): LetraGrupo | null {
  return getTime(busca)?.grupo ?? null;
}

export function getComposicaoGrupo(letra: string): Time[] {
  const L = letra.toUpperCase();
  return getTimesRaw().filter((t) => t.grupo === L);
}

export function getJogosDoGrupo(letra: string): Jogo[] {
  const L = letra.toUpperCase();
  return getJogosRaw()
    .filter((j) => j.grupo === L)
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}

/**
 * Todos os jogos confirmados (com nome de time, não placeholder) do time
 * informado. Inclui mata-mata só se já tiver chaveamento decidido.
 */
export function getJogosDoTime(busca: string): Jogo[] {
  const nome = normalizarNomeTime(busca);
  if (!nome) return [];
  return getJogosRaw()
    .filter(
      (j) =>
        (j.timeCasaDefinido && j.timeCasa === nome) ||
        (j.timeVisitanteDefinido && j.timeVisitante === nome),
    )
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}

/**
 * Próximos N jogos do time a partir da data de referência (default: agora).
 * `agora` aceita Date ou string ISO — facilita teste determinístico.
 */
export function getProximosJogosDoTime(busca: string, n = 3, agora: Date | string = new Date()): Jogo[] {
  const ref = typeof agora === 'string' ? new Date(agora) : agora;
  const refMs = ref.getTime();
  return getJogosDoTime(busca)
    .filter((j) => new Date(j.dataHora).getTime() >= refMs)
    .slice(0, n);
}

export function getJogosNaData(dataYYYYMMDD: string): Jogo[] {
  return getJogosRaw()
    .filter((j) => j.dataHora.slice(0, 10) === dataYYYYMMDD)
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}

export function getMataMata(): Jogo[] {
  return getJogosRaw()
    .filter((j) => j.fase !== 'FASE_GRUPOS')
    .sort((a, b) => a.dataHora.localeCompare(b.dataHora));
}

export function getEstadios(): Estadio[] {
  return [...getEstadiosRaw()];
}

/** Acha estádio por nome ou cidade (case/acentos-insensitive). */
export function getEstadio(busca: string): Estadio | null {
  const norm = normalizar(busca);
  return (
    getEstadiosRaw().find(
      (e) => normalizar(e.nome).includes(norm) || normalizar(e.cidade).includes(norm),
    ) ?? null
  );
}

/** Lista de cidades-sede agrupadas por país (Canadá/EUA/México). */
export function getSedes(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of getEstadiosRaw()) {
    if (!out[e.pais]) out[e.pais] = [];
    if (!out[e.pais].includes(e.cidade)) out[e.pais].push(e.cidade);
  }
  return out;
}

/** Data ISO do 1º jogo (abertura). */
export function getDataInicio(): string {
  return getJogosRaw().reduce(
    (min, j) => (j.dataHora < min ? j.dataHora : min),
    getJogosRaw()[0].dataHora,
  );
}

/** Data ISO da final. */
export function getDataFinal(): string {
  const final = getJogosRaw().find((j) => j.fase === 'FINAL');
  return final?.dataHora ?? getJogosRaw()[getJogosRaw().length - 1].dataHora;
}
