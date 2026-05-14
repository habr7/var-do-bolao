/**
 * Smoke-test do Gemini: 3 chamadas reais usando a GEMINI_API_KEY do .env.
 *   1. Chat simples
 *   2. Classificacao de intencao (com system prompt real)
 *   3. Extracao de palpite (com system prompt real)
 *
 * Uso: npx tsx scripts/test-gemini.ts
 *
 * Nao toca DB/Redis. Se GEMINI_API_KEY nao estiver setada ou a chave for
 * invalida, mostra mensagem clara.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { chatGemini } from '../src/llm/gemini.client.js';
import { classificarIntencao } from '../src/llm/intent.classifier.js';
import { extrairPalpites } from '../src/llm/palpite.extractor.js';

function header(titulo: string) {
  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`   ${titulo}`);
  console.log('═══════════════════════════════════════════════════════');
}

async function main() {
  header('CONFIG');
  console.log(`LLM_ENABLED:    ${env.LLM_ENABLED}`);
  console.log(`LLM_PROVIDER:   ${env.LLM_PROVIDER}`);
  console.log(`GEMINI_API_KEY: ${env.GEMINI_API_KEY ? env.GEMINI_API_KEY.slice(0, 8) + '…' + env.GEMINI_API_KEY.slice(-4) : '(vazio)'}`);
  console.log(`GEMINI_MODEL:   ${env.GEMINI_MODEL}`);
  console.log(`LLM_TIMEOUT_MS: ${env.LLM_TIMEOUT_MS}`);

  if (!env.GEMINI_API_KEY) {
    console.log('\n❌ GEMINI_API_KEY não setada no .env. Aborta.');
    process.exit(1);
  }

  // ===== Test 1: chat simples =====
  header('TEST 1 — chat simples');
  const t0 = Date.now();
  const resp1 = await chatGemini([
    { role: 'system', content: 'Voce eh um assistente PT-BR conciso.' },
    { role: 'user', content: 'Diga oi em uma frase curta.' },
  ]);
  console.log(`Latencia: ${Date.now() - t0}ms`);
  console.log(`Resposta: ${resp1 ?? '(null)'}`);
  if (!resp1) {
    console.log('❌ chat simples falhou. Verifica a key + cota.');
    process.exit(1);
  }
  console.log('✅ chat simples OK');

  // ===== Test 2: intent classifier =====
  header('TEST 2 — intent classifier');
  for (const msg of ['oi tudo bom', 'quais meus pontos', 'tem jogo hoje?']) {
    const t = Date.now();
    const intent = await classificarIntencao(msg);
    console.log(`  "${msg}" → ${intent ?? '(null)'} (${Date.now() - t}ms)`);
  }
  console.log('✅ intent classifier exercitado');

  // ===== Test 3: palpite extractor =====
  header('TEST 3 — palpite extractor com jogos reais');
  const jogos = [
    { timeCasa: 'México', timeVisitante: 'África do Sul' },
    { timeCasa: 'Holanda', timeVisitante: 'Japão' },
    { timeCasa: 'Brasil', timeVisitante: 'Marrocos' },
  ];
  const msgPalpite = 'México 2 a 0 na África\nHolanda 3 x 1 Japão\nBrasil perde do Marrocos de 1 a 0';
  console.log(`Mensagem do user:\n${msgPalpite}\n`);
  console.log(`Jogos disponiveis:`);
  for (const j of jogos) console.log(`  - ${j.timeCasa} x ${j.timeVisitante}`);

  const t3 = Date.now();
  const palpites = await extrairPalpites(msgPalpite, jogos);
  console.log(`\nLatencia: ${Date.now() - t3}ms`);
  console.log(`Palpites extraidos (${palpites.length}):`);
  for (const p of palpites) {
    console.log(`  ${p.timeCasa} ${p.golsCasa} x ${p.golsVisitante} ${p.timeVisitante}`);
  }
  if (palpites.length === 0) {
    console.log('⚠️ LLM nao extraiu nenhum palpite. Pode ser cota/prompt.');
  } else {
    console.log('✅ palpite extractor exercitado');
  }

  header('TUDO PRONTO');
  console.log('Gemini configurado e respondendo. Bom pra produção.');
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
