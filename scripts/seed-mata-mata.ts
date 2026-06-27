/**
 * Seed/sync do MATA-MATA da Copa 2026 a partir da API da FIFA.
 *
 * Desde a v3.43.0 os confrontos vêm AUTOMÁTICOS da api.fifa.com (times, datas em
 * UTC, placar e classificado) — não há mais bloco manual pra transcrever. Em
 * produção o `fetch-results` já roda o sync a cada tick; este script é só pra
 * rodar SOB DEMANDA (ex.: semear na hora) ou pra CONFERIR com `--dry-run`.
 *
 * Uso:
 *   npx tsx scripts/seed-mata-mata.ts --dry-run   # mostra os jogos da FIFA, NÃO grava
 *   npx tsx scripts/seed-mata-mata.ts             # sincroniza em todos os bolões ATIVOS
 */
import 'dotenv/config';
import { buscarFixturesMataMata } from '../src/modules/resultado/fifa.fetcher.js';
import { faseLabel } from '../src/data/bracket-2026.js';

function imprimir(fixtures: Awaited<ReturnType<typeof buscarFixturesMataMata>>) {
  console.log(`\n🏆 Mata-mata — ${fixtures.length} jogos da FIFA:\n`);
  for (const f of fixtures) {
    const br = f.dataHoraUtc.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const casa = f.timeCasa ?? '—';
    const vis = f.timeVisitante ?? '—';
    const real = f.timeCasa && f.timeVisitante ? '✅' : '⚪';
    const placar = f.golsCasa != null ? ` [${f.golsCasa}x${f.golsVisitante}${f.decididoNosPenaltis ? ' pên' : ''}]` : '';
    console.log(`  ${real} #${f.numero} ${faseLabel(f.fase).padEnd(20)} ${casa} x ${vis}${placar} — ${br} BRT`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  let fixtures;
  try {
    fixtures = await buscarFixturesMataMata();
  } catch (e) {
    console.error('❌ Não consegui buscar os jogos na FIFA:', (e as Error).message);
    process.exit(1);
  }
  if (fixtures.length === 0) {
    console.error('❌ A FIFA não retornou jogos de mata-mata (payload vazio?).');
    process.exit(1);
  }
  imprimir(fixtures);

  if (dryRun) {
    console.log('\n🧪 --dry-run: nada gravado. (Em produção o fetch-results sincroniza sozinho.)');
    return;
  }

  // Import dinâmico do banco SÓ aqui — assim o --dry-run não precisa de DATABASE_URL.
  const { prisma, connectDatabase, disconnectDatabase } = await import('../src/config/database.js');
  const { sincronizarMataMata } = await import('../src/modules/resultado/mata-mata.sync.service.js');
  await connectDatabase();
  try {
    const r = await sincronizarMataMata(prisma, fixtures);
    console.log(
      `\n✅ Sync: ${r.jogosAtualizados} jogo(s) atualizado(s), ` +
        `${r.rodadasAbertas} rodada(s) aberta(s), ${r.rodadaIds.length} rodada(s) recalculada(s).`,
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('❌ erro fatal:', err);
  process.exit(1);
});
