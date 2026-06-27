/**
 * Chave (bracket) do mata-mata da Copa do Mundo FIFA 2026 — CONFIG DETERMINÍSTICO.
 *
 * Este mapa NÃO muda com o andar do torneio: descreve, para cada jogo de
 * mata-mata, para onde vai o VENCEDOR (e, nas semis, para onde vai o PERDEDOR
 * → disputa de 3º lugar). Os times reais entram pelo seed (R32) e pelo
 * `advance-bracket.job` (oitavas em diante, auto-preenchido).
 *
 * Numeração oficial FIFA dos jogos:
 *   73–88  → 16-avos (R32)        apiJogoId: WC2026_R32_73 .. WC2026_R32_88
 *   89–96  → Oitavas              apiJogoId: WC2026_OIT_89 .. WC2026_OIT_96
 *   97–100 → Quartas              apiJogoId: WC2026_QUA_97 .. WC2026_QUA_100
 *   101–102 → Semifinais          apiJogoId: WC2026_SEMI_101 .. WC2026_SEMI_102
 *   103    → Disputa de 3º lugar  apiJogoId: WC2026_TER_103
 *   104    → Final                apiJogoId: WC2026_FIN_104
 *
 * R32→oitavas e oitavas (89–96) estão CONFIRMADOS (chave oficial). Quartas→final
 * (97–104) seguem o padrão esperado, marcado com `CONFERIR FIFA` — conferir
 * contra a chave oficial antes do fim das oitavas:
 *   https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026
 */
import type { FaseTorneio, LadoJogo } from '@prisma/client';

// --- IDs canônicos ---------------------------------------------------------

/** Prefixo de apiJogoId por fase, pra montar/inferir o ID a partir do número. */
const PREFIXO_POR_FASE: Record<Exclude<FaseTorneio, 'GRUPOS'>, string> = {
  R32: 'WC2026_R32_',
  OITAVAS: 'WC2026_OIT_',
  QUARTAS: 'WC2026_QUA_',
  SEMI: 'WC2026_SEMI_',
  TERCEIRO: 'WC2026_TER_',
  FINAL: 'WC2026_FIN_',
};

/** Fase (e label) de cada número de jogo do mata-mata. */
function faseDoNumero(numero: number): { fase: Exclude<FaseTorneio, 'GRUPOS'>; label: string } {
  if (numero >= 73 && numero <= 88) return { fase: 'R32', label: '16-avos de final' };
  if (numero >= 89 && numero <= 96) return { fase: 'OITAVAS', label: 'Oitavas de final' };
  if (numero >= 97 && numero <= 100) return { fase: 'QUARTAS', label: 'Quartas de final' };
  if (numero >= 101 && numero <= 102) return { fase: 'SEMI', label: 'Semifinal' };
  if (numero === 103) return { fase: 'TERCEIRO', label: 'Disputa de 3º lugar' };
  if (numero === 104) return { fase: 'FINAL', label: 'Final' };
  throw new Error(`Número de jogo de mata-mata inválido: ${numero} (esperado 73–104)`);
}

/** Monta o apiJogoId canônico a partir do número FIFA do jogo (73–104). */
export function apiIdMataMata(numero: number): string {
  const { fase } = faseDoNumero(numero);
  return `${PREFIXO_POR_FASE[fase]}${numero}`;
}

// --- Descritor por jogo ----------------------------------------------------

export interface DescritorJogoMataMata {
  numero: number; // número oficial FIFA (73–104)
  apiJogoId: string; // WC2026_R32_73, etc
  fase: Exclude<FaseTorneio, 'GRUPOS'>;
  faseLabel: string; // "16-avos de final", "Oitavas de final", ...
}

/** Os 32 jogos do mata-mata, em ordem (73 → 104). Fonte da verdade pro seed. */
export const JOGOS_MATA_MATA: DescritorJogoMataMata[] = Array.from({ length: 104 - 73 + 1 }, (_, i) => {
  const numero = 73 + i;
  const { fase, label } = faseDoNumero(numero);
  return { numero, apiJogoId: apiIdMataMata(numero), fase, faseLabel: label };
});

/** Os 6 grupos de fase (rodadas) que o seed cria por bolão, na ordem do torneio. */
export const FASES_MATA_MATA: Exclude<FaseTorneio, 'GRUPOS'>[] = [
  'R32',
  'OITAVAS',
  'QUARTAS',
  'SEMI',
  'TERCEIRO',
  'FINAL',
];

// --- Ligações da chave (avanço) -------------------------------------------

export interface LigacaoChave {
  proximoJogoApiId: string;
  proximoSlot: LadoJogo;
}

export interface AvancoJogo {
  /** Pra onde vai o VENCEDOR. Ausente no 3º lugar e na final. */
  vencedor?: LigacaoChave;
  /** Pra onde vai o PERDEDOR. Só nas semis (alimenta a disputa de 3º lugar). */
  perdedor?: LigacaoChave;
}

/** Atalho pra declarar uma ligação `numero → numeroDestino:slot`. */
function liga(numeroDestino: number, slot: LadoJogo): LigacaoChave {
  return { proximoJogoApiId: apiIdMataMata(numeroDestino), proximoSlot: slot };
}

/**
 * Mapa de avanço, keyed por número FIFA do jogo de origem.
 *
 * R32→oitavas (73–88) e oitavas→quartas (89–96): CONFIRMADOS.
 *   Oitavas: 89=V74×V77 90=V73×V75 91=V76×V78 92=V79×V80
 *            93=V83×V84 94=V81×V82 95=V86×V88 96=V85×V87
 * Quartas→final (97–104): padrão esperado — CONFERIR FIFA.
 *   97=V89×V90 98=V93×V94 99=V91×V92 100=V95×V96
 *   101=V97×V98 102=V99×V100  103=Perdedor101×Perdedor102  104=V101×V102
 */
const AVANCO_POR_NUMERO: Record<number, AvancoJogo> = {
  // ----- R32 → Oitavas (CONFIRMADO) -----
  73: { vencedor: liga(90, 'CASA') },
  74: { vencedor: liga(89, 'CASA') },
  75: { vencedor: liga(90, 'VISITANTE') },
  76: { vencedor: liga(91, 'CASA') },
  77: { vencedor: liga(89, 'VISITANTE') },
  78: { vencedor: liga(91, 'VISITANTE') },
  79: { vencedor: liga(92, 'CASA') },
  80: { vencedor: liga(92, 'VISITANTE') },
  81: { vencedor: liga(94, 'CASA') },
  82: { vencedor: liga(94, 'VISITANTE') },
  83: { vencedor: liga(93, 'CASA') },
  84: { vencedor: liga(93, 'VISITANTE') },
  85: { vencedor: liga(96, 'CASA') },
  86: { vencedor: liga(95, 'CASA') },
  87: { vencedor: liga(96, 'VISITANTE') },
  88: { vencedor: liga(95, 'VISITANTE') },

  // ----- Oitavas → Quartas (CONFERIR FIFA: 97=V89×V90, 98=V93×V94, 99=V91×V92, 100=V95×V96) -----
  89: { vencedor: liga(97, 'CASA') },
  90: { vencedor: liga(97, 'VISITANTE') },
  91: { vencedor: liga(99, 'CASA') },
  92: { vencedor: liga(99, 'VISITANTE') },
  93: { vencedor: liga(98, 'CASA') },
  94: { vencedor: liga(98, 'VISITANTE') },
  95: { vencedor: liga(100, 'CASA') },
  96: { vencedor: liga(100, 'VISITANTE') },

  // ----- Quartas → Semis (CONFERIR FIFA: 101=V97×V98, 102=V99×V100) -----
  97: { vencedor: liga(101, 'CASA') },
  98: { vencedor: liga(101, 'VISITANTE') },
  99: { vencedor: liga(102, 'CASA') },
  100: { vencedor: liga(102, 'VISITANTE') },

  // ----- Semis → Final (vencedor) + 3º lugar (perdedor) (CONFERIR FIFA) -----
  101: { vencedor: liga(104, 'CASA'), perdedor: liga(103, 'CASA') },
  102: { vencedor: liga(104, 'VISITANTE'), perdedor: liga(103, 'VISITANTE') },

  // ----- 103 (3º lugar) e 104 (final): terminais, sem avanço -----
  103: {},
  104: {},
};

/** Mapa de avanço keyed por apiJogoId (o que o seed/job consultam). */
export const BRACKET_2026: Record<string, AvancoJogo> = Object.fromEntries(
  Object.entries(AVANCO_POR_NUMERO).map(([numero, avanco]) => [apiIdMataMata(Number(numero)), avanco]),
);

// --- Sede → IANA timezone --------------------------------------------------
//
// A FIFA mostra horário LOCAL DA SEDE. Guardamos kickoff em UTC e exibimos em
// Brasília — pra converter local→UTC corretamente (com horário de verão) é
// OBRIGATÓRIO usar identificador IANA, NUNCA offset fixo. (O `fuso` de
// stadiums.json é "UTC-7" etc — offset fixo, não-DST — por isso NÃO é usado.)

/** Mapa canônico Sede → IANA timezone (12 sedes da Copa 2026). */
export const SEDE_PARA_IANA: Record<string, string> = {
  // Leste (America/New_York)
  atlanta: 'America/New_York',
  boston: 'America/New_York',
  foxborough: 'America/New_York',
  miami: 'America/New_York',
  'new york': 'America/New_York',
  'new jersey': 'America/New_York',
  'new york/new jersey': 'America/New_York',
  'east rutherford': 'America/New_York',
  philadelphia: 'America/New_York',
  toronto: 'America/New_York',
  // Central (America/Chicago)
  dallas: 'America/Chicago',
  arlington: 'America/Chicago',
  houston: 'America/Chicago',
  'kansas city': 'America/Chicago',
  // Pacífico (America/Los_Angeles)
  'los angeles': 'America/Los_Angeles',
  inglewood: 'America/Los_Angeles',
  'san francisco': 'America/Los_Angeles',
  'santa clara': 'America/Los_Angeles',
  'san francisco bay area': 'America/Los_Angeles',
  seattle: 'America/Los_Angeles',
  vancouver: 'America/Los_Angeles',
  // México
  guadalajara: 'America/Mexico_City',
  'mexico city': 'America/Mexico_City',
  'cidade do mexico': 'America/Mexico_City',
  monterrey: 'America/Monterrey',
};

/**
 * Resolve a IANA timezone de uma sede. Tolerante a acento/caixa e a sufixos
 * entre parênteses ("Los Angeles (Inglewood)" → America/Los_Angeles). Tenta a
 * string toda, depois o miolo antes do parêntese, depois o conteúdo do parêntese.
 * Retorna null se não reconhecer (o seed trata como erro de transcrição).
 */
export function ianaDaSede(sede: string): string | null {
  const norm = (s: string) =>
    s
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ');

  const candidatos: string[] = [];
  const inteiro = norm(sede);
  candidatos.push(inteiro);
  const m = sede.match(/^([^(]+)\(([^)]+)\)/);
  if (m) {
    candidatos.push(norm(m[1])); // antes do parêntese
    candidatos.push(norm(m[2])); // dentro do parêntese
  }

  for (const c of candidatos) {
    if (SEDE_PARA_IANA[c]) return SEDE_PARA_IANA[c];
  }
  return null;
}
