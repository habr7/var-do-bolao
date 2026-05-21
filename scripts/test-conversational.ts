/**
 * Smoke test do fluxo conversacional (responderConversacional).
 * Testa as perguntas reais que o user mandou na VPS pra confirmar que
 * o LLM responde naturalmente.
 *
 * Uso: npx tsx scripts/test-conversational.ts
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { responderConversacional } from '../src/llm/conversational.responder.js';
import { chatGemini } from '../src/llm/gemini.client.js';

async function tentaComRetry(label: string, fn: () => Promise<string | null>, tentativas = 3) {
  for (let i = 1; i <= tentativas; i++) {
    const t0 = Date.now();
    const r = await fn();
    const ms = Date.now() - t0;
    if (r) {
      console.log(`✅ [${label}] tentativa=${i} latencia=${ms}ms`);
      console.log(`   ${r.replace(/\n/g, '\n   ')}`);
      return r;
    }
    console.log(`⚠️  [${label}] tentativa=${i} latencia=${ms}ms — NULL (possivelmente HTTP 503)`);
    if (i < tentativas) await new Promise((r) => setTimeout(r, 1500 * i));
  }
  console.log(`❌ [${label}] FALHOU após ${tentativas} tentativas`);
  return null;
}

async function main() {
  console.log('═════════════════════════════════════════════════');
  console.log(`  Config:`);
  console.log(`    LLM_ENABLED      = ${env.LLM_ENABLED}`);
  console.log(`    LLM_PROVIDER     = ${env.LLM_PROVIDER}`);
  console.log(`    GEMINI_API_KEY   = ${env.GEMINI_API_KEY ? env.GEMINI_API_KEY.slice(0, 8) + '…' : '(VAZIO)'}`);
  console.log(`    GEMINI_MODEL     = ${env.GEMINI_MODEL}`);
  console.log(`    LLM_TIMEOUT_MS   = ${env.LLM_TIMEOUT_MS}`);
  console.log('═════════════════════════════════════════════════\n');

  // Sanity check: Gemini OK?
  console.log('🩺 Sanity check Gemini direto:');
  await tentaComRetry('gemini "oi"', () => chatGemini([{ role: 'user', content: 'oi' }]));
  console.log('');

  // As 2 perguntas reais reportadas
  const perguntas = [
    'Quais próximos jogos da Inglaterra?',
    'Qual canal posso assistir o Brasil hoje?',
    'Quem ganhou a Copa do Mundo de 1994?',
    'Em que grupo o Brasil está na Copa 2026?',
  ];

  for (const pergunta of perguntas) {
    console.log(`\n📩 Pergunta: "${pergunta}"`);
    await tentaComRetry('responderConversacional', () => responderConversacional(pergunta));
  }

  console.log('\n═════════════════════════════════════════════════');
  process.exit(0);
}

main().catch((e) => {
  console.error('Erro:', e);
  process.exit(1);
});
