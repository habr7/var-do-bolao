#!/usr/bin/env node
/**
 * Sincroniza os dados oficiais da Copa do Mundo 2026 a partir do repositório
 * público openfootball/worldcup.json e gera os 4 arquivos canônicos que o
 * módulo `src/modules/copa-2026` consome.
 *
 * Fonte: https://github.com/openfootball/worldcup.json/tree/master/2026
 * Licença: Creative Commons (domínio público) — sem API key.
 *
 * Gera em src/data/copa-2026/:
 *   - matches.json     (104 jogos: grupos + mata-mata até a final)
 *   - teams.json       (48 seleções: nome, código FIFA, grupo, confederação, bandeira)
 *   - stadiums.json    (16 estádios: nome, cidade, país, fuso, capacidade)
 *   - metadata.json    (fonte e timestamp do snapshot)
 *
 * Também regenera src/data/fifa-2026-fixtures.json (legacy, usado por
 * src/modules/resultado/fifa.fetcher.ts) pra ficar em sincronia.
 *
 * Uso:
 *   npm run sync:copa-2026
 *   # ou manualmente:
 *   node scripts/sync-copa-2026.mjs
 *
 * Re-rodar quando o openfootball publicar atualização (datas/estádios/times
 * de mata-mata após sorteio das chaves, etc).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'src', 'data', 'copa-2026');
mkdirSync(dataDir, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026';
const SOURCES = {
  worldcup: `${BASE}/worldcup.json`,
  teams: `${BASE}/worldcup.teams.json`,
  stadiums: `${BASE}/worldcup.stadiums.json`,
  qualiPlayoffs: `${BASE}/worldcup.quali_playoffs.json`,
  // v3.11.0 — squads vêm do repo `openfootball/worldcup` (texto plain),
  // não do worldcup.json (estruturado). Formato simples documentado em
  // parseSquadsTxt() abaixo.
  squadsTxt: 'https://raw.githubusercontent.com/openfootball/worldcup/master/more/2026_squads.txt',
};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'var-do-bolao/sync-copa-2026' } });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'var-do-bolao/sync-copa-2026' } });
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  return res.text();
}

/**
 * Parseia o formato `2026_squads.txt` do openfootball:
 *
 *   = World Cup 2026     # 48 Teams
 *
 *   == Czech Republic     # 26 Players
 *
 *      1, Matěj KOVÁŘ                      GK,  b. 2000/05/17
 *     16, Jindřich STANĚK                  GK,  b. 1996/04/27
 *      ...
 *
 *   == Mexico     # 26 Players
 *      ...
 *
 * Retorna `[{ timeIngles, time, totalJogadores, jogadores: [{numero, nome, posicao, nascimento}] }]`.
 */
function parseSquadsTxt(texto) {
  const linhas = texto.split('\n');
  const squads = [];
  let atual = null;
  for (const linhaCru of linhas) {
    const linha = linhaCru.trimEnd();
    if (!linha) continue;
    // Cabeçalho de seleção: "== Country Name     # 26 Players"
    const mTime = /^==\s+(.+?)(?:\s+#.*)?$/.exec(linha);
    if (mTime) {
      const timeIngles = mTime[1].trim();
      atual = { timeIngles, time: traduzTime(timeIngles), totalJogadores: 0, jogadores: [] };
      squads.push(atual);
      continue;
    }
    // Linha de jogador: " N, Nome SOBRENOME    POS, b. YYYY/MM/DD"
    const mJog = /^\s*(\d+),\s+(.+?)\s{2,}(GK|DF|MF|FW),\s+b\.\s+(\d{4}\/\d{2}\/\d{2})\s*$/.exec(linha);
    if (mJog && atual) {
      const [, num, nome, pos, nasc] = mJog;
      atual.jogadores.push({
        numero: parseInt(num, 10),
        nome: nome.trim(),
        posicao: pos,
        nascimento: nasc.replace(/\//g, '-'),
      });
      atual.totalJogadores = atual.jogadores.length;
      continue;
    }
    // Cabeçalho do torneio ou comentário — ignora
  }
  return squads;
}

// Dicionário PT-BR. Único lugar de tradução de seleção no projeto.
// Cobre todas as 48 finalistas + nomes alternativos que aparecem em playoffs
// intercontinentais (DR Congo, Bolivia, Suriname, etc).
const PT_BR = {
  Algeria: 'Argélia',
  Argentina: 'Argentina',
  Australia: 'Austrália',
  Austria: 'Áustria',
  Belgium: 'Bélgica',
  Bolivia: 'Bolívia',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina',
  Brazil: 'Brasil',
  Canada: 'Canadá',
  'Cape Verde': 'Cabo Verde',
  Colombia: 'Colômbia',
  Croatia: 'Croácia',
  Curaçao: 'Curaçao',
  Czechia: 'República Tcheca',
  'Czech Republic': 'República Tcheca',
  'DR Congo': 'RD Congo',
  Ecuador: 'Equador',
  Egypt: 'Egito',
  England: 'Inglaterra',
  France: 'França',
  Germany: 'Alemanha',
  Ghana: 'Gana',
  Haiti: 'Haiti',
  Iran: 'Irã',
  Iraq: 'Iraque',
  Italy: 'Itália',
  'Ivory Coast': 'Costa do Marfim',
  Jamaica: 'Jamaica',
  Japan: 'Japão',
  Jordan: 'Jordânia',
  'Korea Republic': 'Coreia do Sul',
  Mexico: 'México',
  Morocco: 'Marrocos',
  Netherlands: 'Holanda',
  'New Caledonia': 'Nova Caledônia',
  'New Zealand': 'Nova Zelândia',
  Norway: 'Noruega',
  Panama: 'Panamá',
  Paraguay: 'Paraguai',
  Portugal: 'Portugal',
  Qatar: 'Catar',
  'Republic of Ireland': 'Irlanda',
  Ireland: 'Irlanda',
  'Saudi Arabia': 'Arábia Saudita',
  Scotland: 'Escócia',
  Senegal: 'Senegal',
  'South Africa': 'África do Sul',
  'South Korea': 'Coreia do Sul',
  Spain: 'Espanha',
  Suriname: 'Suriname',
  Sweden: 'Suécia',
  Switzerland: 'Suíça',
  Tunisia: 'Tunísia',
  Turkey: 'Turquia',
  Türkiye: 'Turquia',
  USA: 'Estados Unidos',
  'United States': 'Estados Unidos',
  Uruguay: 'Uruguai',
  Uzbekistan: 'Uzbequistão',
  Wales: 'País de Gales',
};

function traduzTime(nome) {
  if (!nome) return nome;
  return PT_BR[nome] ?? nome;
}

const CONTINENTE_PT = {
  Africa: 'África',
  Asia: 'Ásia',
  Europe: 'Europa',
  'North America': 'América do Norte',
  'South America': 'América do Sul',
  Oceania: 'Oceania',
};

const PAIS_SEDE = { ca: 'Canadá', us: 'Estados Unidos', mx: 'México' };

/** "13:00 UTC-6" + "2026-06-11" → ISO em horário de Brasília (-03:00). */
function toBrasiliaIso(dateStr, timeStr) {
  const m = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/.exec(timeStr.trim());
  if (!m) throw new Error(`time inválido: "${timeStr}"`);
  const [, hh, mm, offsetStr] = m;
  const offset = parseInt(offsetStr, 10);
  const local = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  const utcMillis = local.getTime() - offset * 3600 * 1000;
  const brasiliaMillis = utcMillis - 3 * 3600 * 1000;
  const d = new Date(brasiliaMillis);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00-03:00`
  );
}

// Mapeia "Group A" → "A", "Round of 32" → "ROUND_OF_32", etc.
const FASE_MAP = {
  'Round of 32': { fase: 'ROUND_OF_32', label: 'Trigésimas-de-final' },
  'Round of 16': { fase: 'ROUND_OF_16', label: 'Oitavas de final' },
  'Quarter-final': { fase: 'QUARTAS', label: 'Quartas de final' },
  'Semi-final': { fase: 'SEMIS', label: 'Semifinal' },
  'Match for third place': { fase: 'TERCEIRO', label: 'Disputa de 3º lugar' },
  Final: { fase: 'FINAL', label: 'Final' },
};

function classificarFase(raw) {
  if (/^Group [A-L]$/.test(raw.group ?? '')) {
    return { fase: 'FASE_GRUPOS', label: 'Fase de Grupos', grupo: raw.group.replace('Group ', '') };
  }
  const entry = FASE_MAP[raw.group] ?? FASE_MAP[raw.round];
  if (entry) return { ...entry, grupo: null };
  return { fase: 'OUTRO', label: raw.group ?? raw.round ?? '?', grupo: null };
}

function parseMatchday(round) {
  const m = /^Matchday (\d+)$/.exec(round ?? '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Mata-mata usa placeholders como "1A" (1º do grupo A) ou "W101" (vencedor
 * do jogo 101). Mantemos o token, mas damos um nome legível em PT-BR.
 */
function traduzPlaceholder(tok) {
  if (typeof tok !== 'string') return tok;
  // Token "1A" / "2B" / "3C": coloca como "1º do Grupo A"
  const grp = /^([123])([A-L])$/.exec(tok);
  if (grp) {
    const pos = { 1: '1º', 2: '2º', 3: '3º' }[grp[1]];
    return `${pos} do Grupo ${grp[2]}`;
  }
  // Token "W101" / "W102": vencedor do jogo X
  const w = /^W(\d+)$/.exec(tok);
  if (w) return `Vencedor do Jogo ${w[1]}`;
  return tok;
}

function ehPlaceholder(tok) {
  return typeof tok === 'string' && /^[123][A-L]$|^W\d+$/.test(tok);
}

// ============================================================
// MAIN
// ============================================================

console.log('🌐 Baixando dados do openfootball/worldcup.json (2026)...');
const [worldcup, teamsRaw, stadiumsRaw, squadsTxt] = await Promise.all([
  fetchJson(SOURCES.worldcup),
  fetchJson(SOURCES.teams),
  fetchJson(SOURCES.stadiums),
  fetchText(SOURCES.squadsTxt),
]);

const atualizadoEm = new Date().toISOString();

// --- teams.json ---
const times = teamsRaw.map((t) => {
  const nome = traduzTime(t.name_normalised ?? t.name);
  return {
    nome,
    nomeIngles: t.name,
    fifaCode: t.fifa_code,
    grupo: t.group,
    confederacao: t.confed,
    continente: CONTINENTE_PT[t.continent] ?? t.continent,
    bandeira: t.flag_icon,
  };
});

writeFileSync(
  join(dataDir, 'teams.json'),
  JSON.stringify(
    {
      fonte: 'openfootball/worldcup.json',
      fonteUrl: SOURCES.teams,
      atualizadoEm,
      totalTimes: times.length,
      times,
    },
    null,
    2,
  ) + '\n',
);
console.log(`✅ teams.json — ${times.length} seleções`);

// --- stadiums.json ---
const estadios = stadiumsRaw.stadiums.map((s) => ({
  nome: s.name,
  cidade: s.city,
  pais: PAIS_SEDE[s.cc] ?? s.cc,
  paisCodigo: s.cc,
  fuso: s.timezone,
  capacidade: s.capacity,
  coords: s.coords,
}));

writeFileSync(
  join(dataDir, 'stadiums.json'),
  JSON.stringify(
    {
      fonte: 'openfootball/worldcup.json',
      fonteUrl: SOURCES.stadiums,
      atualizadoEm,
      totalEstadios: estadios.length,
      estadios,
    },
    null,
    2,
  ) + '\n',
);
console.log(`✅ stadiums.json — ${estadios.length} estádios`);

// --- matches.json (104 jogos) ---
// matchdayGeral: 1-17 do openfootball (round global do torneio).
// matchdayGrupo: 1-3 relativo ao grupo (rodada da fase de grupos). Calculado
// abaixo agrupando por grupo e ordenando por data — 2 jogos por matchday.
const jogos = [];
const counterGrupo = new Map();
let counterMataMata = 0;

// Pre-calcula matchdayGrupo (1, 2 ou 3) por jogo da fase de grupos
const matchdayGrupoPorJogo = new Map();
{
  const porGrupo = new Map();
  for (const m of worldcup.matches) {
    if (!/^Group [A-L]$/.test(m.group ?? '')) continue;
    const g = m.group.replace('Group ', '');
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(m);
  }
  for (const arr of porGrupo.values()) {
    arr.sort((a, b) => a.date.localeCompare(b.date));
    arr.forEach((m, idx) => {
      matchdayGrupoPorJogo.set(m, Math.floor(idx / 2) + 1);
    });
  }
}

for (const m of worldcup.matches) {
  const cls = classificarFase(m);
  const matchdayGeral = parseMatchday(m.round);
  const matchdayGrupo = matchdayGrupoPorJogo.get(m) ?? null;

  let id;
  if (cls.fase === 'FASE_GRUPOS') {
    const n = (counterGrupo.get(cls.grupo) ?? 0) + 1;
    counterGrupo.set(cls.grupo, n);
    id = `WC2026_${cls.grupo}_${n}`;
  } else {
    counterMataMata++;
    id = `WC2026_KO_${cls.fase}_${counterMataMata}`;
  }

  const timeCasa = ehPlaceholder(m.team1) ? traduzPlaceholder(m.team1) : traduzTime(m.team1);
  const timeVis = ehPlaceholder(m.team2) ? traduzPlaceholder(m.team2) : traduzTime(m.team2);

  jogos.push({
    id,
    fase: cls.fase,
    faseLabel: cls.label,
    grupo: cls.grupo,
    matchdayGrupo,
    matchdayGeral,
    rodadaLabel: m.round,
    timeCasa,
    timeVisitante: timeVis,
    timeCasaDefinido: !ehPlaceholder(m.team1),
    timeVisitanteDefinido: !ehPlaceholder(m.team2),
    dataHora: toBrasiliaIso(m.date, m.time),
    estadio: m.ground,
  });
}

jogos.sort((a, b) => a.dataHora.localeCompare(b.dataHora));

writeFileSync(
  join(dataDir, 'matches.json'),
  JSON.stringify(
    {
      fonte: 'openfootball/worldcup.json',
      fonteUrl: SOURCES.worldcup,
      atualizadoEm,
      totalJogos: jogos.length,
      jogos,
    },
    null,
    2,
  ) + '\n',
);
console.log(`✅ matches.json — ${jogos.length} jogos`);

// --- squads.json (v3.11.0 — convocados) ---
const squads = parseSquadsTxt(squadsTxt);
writeFileSync(
  join(dataDir, 'squads.json'),
  JSON.stringify(
    {
      fonte: 'openfootball/worldcup',
      fonteUrl: SOURCES.squadsTxt,
      atualizadoEm,
      totalTimes: squads.length,
      totalJogadores: squads.reduce((acc, s) => acc + s.jogadores.length, 0),
      squads,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `✅ squads.json — ${squads.length} seleções, ${squads.reduce((a, s) => a + s.jogadores.length, 0)} jogadores`,
);

// --- metadata.json ---
writeFileSync(
  join(dataDir, 'metadata.json'),
  JSON.stringify(
    {
      fonte: 'openfootball/worldcup.json + openfootball/worldcup',
      fonteUrl: 'https://github.com/openfootball/worldcup.json/tree/master/2026',
      atualizadoEm,
      arquivos: ['matches.json', 'teams.json', 'stadiums.json', 'squads.json'],
      observacao:
        'Snapshot baixado via npm run sync:copa-2026. Re-rode quando o openfootball publicar mudanças (mata-mata, datas, convocações).',
    },
    null,
    2,
  ) + '\n',
);
console.log('✅ metadata.json');

// --- legacy: src/data/fifa-2026-fixtures.json (formato que fifa.fetcher.ts consome) ---
// matchday legacy = matchdayGrupo (1-3 relativo ao grupo).
const jogosGrupos = jogos
  .filter((j) => j.fase === 'FASE_GRUPOS')
  .map((j) => ({
    apiJogoId: j.id,
    grupo: j.grupo,
    matchday: j.matchdayGrupo,
    timeCasa: j.timeCasa,
    timeVisitante: j.timeVisitante,
    dataHora: j.dataHora,
    estadio: j.estadio,
  }));

writeFileSync(
  join(root, 'src', 'data', 'fifa-2026-fixtures.json'),
  JSON.stringify(
    {
      campeonatoId: 'copa-2026-fase-grupos',
      campeonatoNome: 'Copa do Mundo FIFA 2026 - Fase de Grupos',
      fonte: 'openfootball/worldcup.json (https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json)',
      atualizadoEm: atualizadoEm.slice(0, 10),
      totalJogos: jogosGrupos.length,
      jogos: jogosGrupos,
    },
    null,
    2,
  ) + '\n',
);
console.log(`✅ src/data/fifa-2026-fixtures.json (legacy) — ${jogosGrupos.length} jogos da fase de grupos`);

console.log('\n🎉 Sincronização concluída.');
