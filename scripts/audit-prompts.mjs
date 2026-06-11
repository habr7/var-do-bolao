#!/usr/bin/env node
/**
 * v3.13.0 — auditoria cross-reference das 3 fontes de "verdade" do bot:
 *
 *   1. src/whatsapp/regras.text.ts  (texto canônico mostrado ao user)
 *   2. src/llm/knowledge.produto.ts (knowledge da LLM)
 *   3. src/llm/system-prompts.ts    (BASE_CONTEXT compartilhado)
 *
 * Falha se houver discrepância nos fatos críticos. CI deve rodar este
 * script (`npm run audit:prompts`) e quebrar build se houver warning.
 *
 * Fatos auditados:
 *   - Pontuação 10/7/5/3/0
 *   - Prazo: "kickoff de cada jogo" (não "primeiro jogo da rodada")
 *   - Admin NÃO vê palpites individuais
 *   - Fuso de Brasília mencionado
 *   - Multi-bolão TODOS (v3.12.0)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const arquivos = {
  regras: join(root, 'src/whatsapp/regras.text.ts'),
  knowledge: join(root, 'src/llm/knowledge.produto.ts'),
  prompts: join(root, 'src/llm/system-prompts.ts'),
};

const conteudo = {
  regras: readFileSync(arquivos.regras, 'utf-8').toLowerCase(),
  knowledge: readFileSync(arquivos.knowledge, 'utf-8').toLowerCase(),
  prompts: readFileSync(arquivos.prompts, 'utf-8').toLowerCase(),
};

const checks = [
  {
    nome: 'Pontuação correta (10 pts placar exato)',
    teste: (c) => /10 pts/.test(c) && !/5 pts placar exato/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'Pontuação 7 pts vencedor + gols',
    teste: (c) => /7 pts/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'Não cita pontuação antiga "2 pts" (empate antigo)',
    teste: (c) => !/2 pts/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'NÃO cita "primeiro jogo da rodada começa" (texto antigo errado)',
    teste: (c) => !/primeiro jogo da rodada come[çc]a/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'Cita prazo por jogo individual (kickoff)',
    teste: (c) => /kickoff/.test(c) || /cada jogo/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'Admin NÃO vê palpite (v3.11.0)',
    teste: (c) => /admin n[ãa]o v[êe]/.test(c) || /nem admin/.test(c),
    onde: ['knowledge', 'prompts'],
  },
  {
    nome: 'Fuso de Brasília mencionado',
    teste: (c) => /bras[íi]lia/.test(c),
    onde: ['regras', 'knowledge', 'prompts'],
  },
  {
    nome: 'Multi-bolão TODOS (v3.12.0)',
    teste: (c) => /todos/.test(c),
    onde: ['knowledge', 'prompts'],
  },
];

let warnings = 0;
console.log('\n🔍 auditoria de prompts — VAR do Bolão\n');

for (const check of checks) {
  for (const arq of check.onde) {
    const ok = check.teste(conteudo[arq]);
    const marker = ok ? '✅' : '❌';
    const arquivoLabel = arq.padEnd(10);
    console.log(`  ${marker} [${arquivoLabel}] ${check.nome}`);
    if (!ok) warnings++;
  }
}

console.log(`\nResultado: ${warnings} warning(s)\n`);

if (warnings > 0) {
  console.error('❌ Discrepâncias encontradas — corrija antes de fazer deploy.');
  process.exit(1);
}
console.log('✅ Todos os fatos críticos estão consistentes entre as 3 fontes.');
