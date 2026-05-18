/**
 * Roda o job de limpeza on-demand (fora do cron mensal).
 *
 * Uso: npx tsx scripts/limpar-mensagens-antigas.ts
 *
 * Util pra LGPD ad-hoc (deletar tudo antes de uma data) ou pra liberar
 * espaco no DB caso o cron mensal nao tenha rodado.
 */
import 'dotenv/config';
import { limparMensagensAntigas } from '../src/jobs/limpar-mensagens-antigas.job.js';
import { prisma } from '../src/config/database.js';

async function main() {
  console.log('--- limpar-mensagens-antigas iniciando ---');
  const resultado = await limparMensagensAntigas();
  console.log('--- limpar-mensagens-antigas resultado:', JSON.stringify(resultado));
  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error('--- limpar-mensagens-antigas falhou:', e);
  process.exit(1);
});
