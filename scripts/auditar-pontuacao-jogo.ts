/**
 * Auditoria de pontuação de um jogo.
 *
 * Lista TODOS os palpites de um jogo finalizado, com:
 *   - palpite do usuário
 *   - pontos GRAVADOS no banco (PalpiteJogo.pontosObtidos)
 *   - pontos RECALCULADOS agora pela função canônica (calcularPontos)
 *   - flag de DIVERGÊNCIA (se gravado ≠ recalculado → possível bug)
 *
 * Uso (no VPS, com a pasta scripts montada — ver DEPLOY.md seção 8B):
 *   docker compose run --rm -v "$(pwd)/scripts:/app/scripts" \
 *     app npx tsx scripts/auditar-pontuacao-jogo.ts "México" "África"
 *
 * Sem argumentos, audita todos os jogos FINALIZADOS com placar.
 * Os argumentos são filtros (case/acento-insensível) por nome de time.
 */
import { prisma } from '../src/config/database.js';
import { calcularPontos } from '../src/modules/ranking/pontuacao.calc.js';

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .toLowerCase()
    .trim();
}

async function main() {
  const filtros = process.argv.slice(2).map(norm).filter(Boolean);

  const jogos = await prisma.jogo.findMany({
    where: { golsCasa: { not: null }, golsVisitante: { not: null } },
    include: {
      palpitesJogo: { include: { palpite: { include: { usuario: true } } } },
      rodada: { include: { bolao: true } },
    },
    orderBy: { dataHora: 'desc' },
  });

  const alvo = jogos.filter((j) => {
    if (filtros.length === 0) return true;
    const nomes = norm(`${j.timeCasa} ${j.timeVisitante}`);
    return filtros.every((f) => nomes.includes(f));
  });

  if (alvo.length === 0) {
    console.log('Nenhum jogo finalizado bate com o filtro:', filtros.join(' '));
    return;
  }

  let totalDivergencias = 0;

  for (const j of alvo) {
    console.log('\n' + '='.repeat(70));
    console.log(
      `${j.timeCasa} ${j.golsCasa} x ${j.golsVisitante} ${j.timeVisitante}  ` +
        `[bolão: ${j.rodada.bolao.nome}]  status=${j.status}`,
    );
    console.log('='.repeat(70));
    console.log('palpite | gravado | recalc | ok? | usuário');

    const dist: Record<number, number> = {};

    for (const pj of j.palpitesJogo) {
      const recalc = calcularPontos(
        { golsCasa: pj.golsCasa, golsVisitante: pj.golsVisitante },
        { golsCasa: j.golsCasa, golsVisitante: j.golsVisitante },
      );
      const gravado = pj.pontosObtidos;
      const calculado = pj.palpite.calculado;
      const ok = gravado === recalc;
      if (!ok) totalDivergencias++;
      dist[recalc] = (dist[recalc] ?? 0) + 1;

      const flag = ok ? '✅' : calculado ? '❌ DIVERGE' : '⏳ não-calc';
      console.log(
        `  ${pj.golsCasa}x${pj.golsVisitante}   |   ${gravado}     |   ${recalc}    | ${flag} | ` +
          `${pj.palpite.usuario.nome}${calculado ? '' : ' (palpite.calculado=false)'}`,
      );
    }

    const resumo = Object.entries(dist)
      .sort((a, b) => Number(b[0]) - Number(a[0]))
      .map(([pts, n]) => `${pts}pt×${n}`)
      .join('  ');
    console.log(`distribuição (recalc): ${resumo}  | total palpites: ${j.palpitesJogo.length}`);
  }

  console.log('\n' + '-'.repeat(70));
  if (totalDivergencias === 0) {
    console.log('✅ Nenhuma divergência: pontos gravados batem com o recálculo canônico.');
  } else {
    console.log(`❌ ${totalDivergencias} palpite(s) com pontos gravados ≠ recalculados (ver linhas DIVERGE).`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
