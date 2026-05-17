/**
 * Roda o job de reparo de boloes quebrados uma unica vez e sai.
 * Util pra disparar o reparo sob demanda sem subir o servidor inteiro
 * (que conflitaria com porta 3000 ja ocupada).
 *
 * Uso: npx tsx scripts/run-repair-once.ts
 */
import 'dotenv/config';
import { repararBoloesQuebrados } from '../src/jobs/repair-broken-boloes.job.js';
import { prisma } from '../src/config/database.js';

async function main() {
  console.log('--- run-repair-once iniciando ---');
  const resultado = await repararBoloesQuebrados();
  console.log('--- run-repair-once resultado:', JSON.stringify(resultado));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('--- run-repair-once falhou:', e);
  process.exit(1);
});
