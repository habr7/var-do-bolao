/**
 * Converte o JSON do openfootball/worldcup.json (Copa 2026) para o formato
 * que o VAR do Bolão usa em src/data/fifa-2026-fixtures.json.
 *
 * Roda apenas a fase de grupos (12 grupos x 6 jogos = 72 partidas).
 * Times sao traduzidos para PT-BR. Datas sao convertidas para horario de
 * Brasilia (-03:00).
 *
 * Uso:
 *   curl -fsSL https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json -o openfootball-2026.json
 *   node scripts/generate-fifa-fixtures.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const SRC = join(root, 'openfootball-2026.json');
const DST = join(root, 'src', 'data', 'fifa-2026-fixtures.json');

// Traducoes de times (somente o subset que aparece na fase de grupos do openfootball).
// Para nomes nao listados aqui, mantem o nome original.
const PT_BR = {
  'Algeria': 'Argélia',
  'Argentina': 'Argentina',
  'Australia': 'Austrália',
  'Austria': 'Áustria',
  'Belgium': 'Bélgica',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina',
  'Brazil': 'Brasil',
  'Canada': 'Canadá',
  'Cape Verde': 'Cabo Verde',
  'Colombia': 'Colômbia',
  'Croatia': 'Croácia',
  'Curaçao': 'Curaçao',
  'Czech Republic': 'República Tcheca',
  'DR Congo': 'RD Congo',
  'Ecuador': 'Equador',
  'Egypt': 'Egito',
  'England': 'Inglaterra',
  'France': 'França',
  'Germany': 'Alemanha',
  'Ghana': 'Gana',
  'Haiti': 'Haiti',
  'Iran': 'Irã',
  'Iraq': 'Iraque',
  'Ivory Coast': 'Costa do Marfim',
  'Japan': 'Japão',
  'Jordan': 'Jordânia',
  'Mexico': 'México',
  'Morocco': 'Marrocos',
  'Netherlands': 'Holanda',
  'New Zealand': 'Nova Zelândia',
  'Norway': 'Noruega',
  'Panama': 'Panamá',
  'Paraguay': 'Paraguai',
  'Portugal': 'Portugal',
  'Qatar': 'Catar',
  'Saudi Arabia': 'Arábia Saudita',
  'Scotland': 'Escócia',
  'Senegal': 'Senegal',
  'South Africa': 'África do Sul',
  'South Korea': 'Coreia do Sul',
  'Spain': 'Espanha',
  'Sweden': 'Suécia',
  'Switzerland': 'Suíça',
  'Tunisia': 'Tunísia',
  'Turkey': 'Turquia',
  'USA': 'Estados Unidos',
  'Uruguay': 'Uruguai',
  'Uzbekistan': 'Uzbequistão',
};

function traduz(name) {
  return PT_BR[name] ?? name;
}

/**
 * Converte "13:00 UTC-6" + "2026-06-11" para ISO em horario de Brasilia (-03:00).
 * UTC-6 significa que 13:00 local = 19:00 UTC. Em -03:00, eh 16:00.
 */
function toBrasiliaIso(dateStr, timeStr) {
  // timeStr: "13:00 UTC-6" — ou as vezes UTC-7, UTC-4, UTC-5, etc (sedes diferentes)
  const m = /^(\d{2}):(\d{2})\s+UTC([+-]\d+)$/.exec(timeStr.trim());
  if (!m) {
    throw new Error(`time invalido: "${timeStr}"`);
  }
  const [, hh, mm, offsetStr] = m;
  const offset = parseInt(offsetStr, 10); // ex: -6
  // Constroi como UTC subtraindo o offset (UTC-6 → adicionar 6h pra UTC)
  const localDate = new Date(`${dateStr}T${hh}:${mm}:00Z`);
  // localDate eh UTC. Queremos converter para UTC real adicionando -offset horas.
  const utcMillis = localDate.getTime() - offset * 3600 * 1000;
  // Em horario de Brasilia: UTC-3 → subtrai 3h
  const brasiliaMillis = utcMillis - 3 * 3600 * 1000;
  const d = new Date(brasiliaMillis);
  // Formata como YYYY-MM-DDTHH:MM:00-03:00
  const yyyy = d.getUTCFullYear();
  const MM = String(d.getUTCMonth() + 1).padStart(2, '0');
  const DD = String(d.getUTCDate()).padStart(2, '0');
  const HH = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${MM}-${DD}T${HH}:${mi}:00-03:00`;
}

const data = JSON.parse(readFileSync(SRC, 'utf-8'));

// Filtra apenas fase de grupos
const groupMatches = data.matches.filter((m) => /^Group [A-L]$/.test(m.group));

// Agrupa por grupo, ordena por data, e atribui matchday relativo (1, 2 ou 3 dentro do grupo)
const byGroup = new Map();
for (const m of groupMatches) {
  const g = m.group.replace('Group ', '');
  if (!byGroup.has(g)) byGroup.set(g, []);
  byGroup.get(g).push(m);
}

const jogos = [];
for (const [grupo, matches] of [...byGroup.entries()].sort()) {
  matches.sort((a, b) => a.date.localeCompare(b.date));
  // 6 partidas por grupo: ordenadas, dois a dois sao matchday 1, 2, 3
  matches.forEach((m, idx) => {
    const matchday = Math.floor(idx / 2) + 1;
    const numeroDentroGrupo = idx + 1;
    jogos.push({
      apiJogoId: `WC2026_${grupo}_${numeroDentroGrupo}`,
      grupo,
      matchday,
      timeCasa: traduz(m.team1),
      timeVisitante: traduz(m.team2),
      dataHora: toBrasiliaIso(m.date, m.time),
      estadio: m.ground,
    });
  });
}

// Ordena globalmente por dataHora pra ficar legivel quando inspeciona o JSON
jogos.sort((a, b) => a.dataHora.localeCompare(b.dataHora));

const out = {
  campeonatoId: 'copa-2026-fase-grupos',
  campeonatoNome: 'Copa do Mundo FIFA 2026 - Fase de Grupos',
  fonte: 'openfootball/worldcup.json (https://github.com/openfootball/worldcup.json/blob/master/2026/worldcup.json)',
  atualizadoEm: new Date().toISOString().slice(0, 10),
  totalJogos: jogos.length,
  jogos,
};

writeFileSync(DST, JSON.stringify(out, null, 2) + '\n', 'utf-8');
console.log(`✅ ${jogos.length} jogos da fase de grupos convertidos.`);
console.log(`✅ Escrito em: ${DST}`);
