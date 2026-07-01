/**
 * Inserção MANUAL de palpite (admin) — pra casos em que o bot esteve fora e a
 * pessoa comprovou (print com horário) que enviou o palpite antes do kickoff.
 *
 * NÃO passa pela trava de "jogo já começou" (isso é de propósito — é admin
 * inserindo palpite legítimo perdido). Cria/atualiza o Palpite + PalpiteJogo
 * em TODOS os bolões do usuário que tenham aquele jogo, e recalcula a
 * pontuação na hora (mesma lógica do bot).
 *
 * Telefones entram por ARGUMENTO (não ficam no repositório).
 *
 * Uso:
 *   npx tsx scripts/inserir-palpite-manual.ts --jogo "França x Suécia" \
 *     5511984436650=3x1 557199160596=2x0 5511982204377=3x1 --dry-run
 *
 *   (tira o --dry-run pra gravar de verdade)
 *
 * Formato de cada entrada:  <numero>=<golsCasa>x<golsVisitante>
 *   onde casa/visitante seguem a ORDEM do --jogo ("França x Suécia" →
 *   França é a casa). O script alinha sozinho à ordem oficial no banco.
 */
import 'dotenv/config';

function norm(s: string): string {
  return s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}
function digits(s: string): string {
  return s.replace(/\D/g, '');
}

interface Entrada {
  numero: string;
  golsCasa: number;
  golsVisitante: number;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const jogoIdx = argv.indexOf('--jogo');
  if (jogoIdx === -1 || !argv[jogoIdx + 1]) {
    throw new Error('Faltou --jogo "Casa x Visitante" (ex: --jogo "França x Suécia").');
  }
  const [casaNome, visitanteNome] = argv[jogoIdx + 1].split(/\s+x\s+/i);
  if (!casaNome || !visitanteNome) {
    throw new Error('--jogo precisa ser "Casa x Visitante" (com " x " no meio).');
  }
  const entradas: Entrada[] = [];
  for (const a of argv) {
    const m = a.match(/^(\+?\d[\d\s()-]*)=(\d+)x(\d+)$/i);
    if (!m) continue;
    entradas.push({ numero: digits(m[1]), golsCasa: parseInt(m[2], 10), golsVisitante: parseInt(m[3], 10) });
  }
  if (entradas.length === 0) {
    throw new Error('Nenhuma entrada no formato <numero>=<GxG> (ex: 5511984436650=3x1).');
  }
  return { dryRun, casaNorm: norm(casaNome), visitanteNorm: norm(visitanteNome), casaNome, visitanteNome, entradas };
}

async function main() {
  const { dryRun, casaNorm, visitanteNorm, casaNome, visitanteNome, entradas } = parseArgs();

  console.log(`\n🎯 Jogo: ${casaNome} (casa) x ${visitanteNome} (visitante)`);
  console.log(`   ${entradas.length} entrada(s) — ${dryRun ? 'DRY-RUN (nada grava)' : 'GRAVANDO'}\n`);

  const { prisma, connectDatabase, disconnectDatabase } = await import('../src/config/database.js');
  const { calcularPontuacaoRodada, recalcularRanking } = await import(
    '../src/modules/ranking/ranking.service.js'
  );
  await connectDatabase();

  const rodadasAfetadas = new Set<string>();
  const boloesAfetados = new Set<string>();

  try {
    for (const ent of entradas) {
      const usuarios = await prisma.usuario.findMany({
        where: { whatsappId: { contains: ent.numero.slice(-10) } },
      });
      const usuario = usuarios.find((u) => digits(u.whatsappId ?? '') === ent.numero);
      if (!usuario) {
        console.log(`❌ +${ent.numero}: usuário NÃO encontrado — pulado.`);
        continue;
      }

      const jogos = await prisma.jogo.findMany({
        where: { rodada: { bolao: { participacoes: { some: { usuarioId: usuario.id } } } } },
        include: { rodada: { include: { bolao: { select: { id: true, nome: true } } } } },
      });
      const alvos = jogos.filter((j) => {
        const c = norm(j.timeCasa);
        const v = norm(j.timeVisitante);
        return (c === casaNorm && v === visitanteNorm) || (c === visitanteNorm && v === casaNorm);
      });
      if (alvos.length === 0) {
        console.log(`❌ ${usuario.nome} (+${ent.numero}): jogo não achado nos bolões dele — pulado.`);
        continue;
      }

      for (const jogo of alvos) {
        // Alinha o placar à ordem OFICIAL casa/visitante do banco.
        const casaEhCasa = norm(jogo.timeCasa) === casaNorm;
        const golsCasa = casaEhCasa ? ent.golsCasa : ent.golsVisitante;
        const golsVisitante = casaEhCasa ? ent.golsVisitante : ent.golsCasa;

        console.log(
          `${dryRun ? '[DRY] ' : '✅ '}${usuario.nome} @ ${jogo.rodada.bolao.nome}: ` +
            `${jogo.timeCasa} ${golsCasa} x ${golsVisitante} ${jogo.timeVisitante} ` +
            `(jogo ${jogo.status})`,
        );
        if (dryRun) continue;

        const palpite = await prisma.palpite.upsert({
          where: { usuarioId_rodadaId: { usuarioId: usuario.id, rodadaId: jogo.rodadaId } },
          create: { usuarioId: usuario.id, rodadaId: jogo.rodadaId, calculado: false },
          update: { calculado: false },
        });
        const empate = golsCasa === golsVisitante;
        await prisma.palpiteJogo.upsert({
          where: { palpiteId_jogoId: { palpiteId: palpite.id, jogoId: jogo.id } },
          create: { palpiteId: palpite.id, jogoId: jogo.id, golsCasa, golsVisitante },
          update: { golsCasa, golsVisitante, ...(empate ? {} : { classificadoPalpite: null }) },
        });
        rodadasAfetadas.add(jogo.rodadaId);
        boloesAfetados.add(jogo.rodada.bolao.id);
      }
    }

    if (dryRun) {
      console.log('\n🧪 --dry-run: nada gravado. Confira acima e rode sem --dry-run pra valer.');
    } else {
      for (const rid of rodadasAfetadas) await calcularPontuacaoRodada(rid);
      for (const bid of boloesAfetados) await recalcularRanking(bid);
      console.log(
        `\n🎯 Gravado + recalculado: ${rodadasAfetadas.size} rodada(s), ${boloesAfetados.size} bolão(ões).`,
      );
      console.log('   (Se o jogo ainda não finalizou, pontua sozinho no apito — está com calculado=false.)');
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error('❌ erro fatal:', (err as Error).message);
  process.exit(1);
});
