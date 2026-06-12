/**
 * v3.34.0 — Recuperação de palpite em jogo JÁ FECHADO (admin, one-off).
 *
 * Caso motivador (Felipe 11/06 20:44): palpites separados por vírgula não
 * foram registrados por um bug do parser; um deles (Coreia do Sul 1x1
 * República Tcheca) era de um jogo que já finalizou. O fluxo normal e o
 * `auditar-recuperar-palpite.ts` NÃO conseguem registrar nesse jogo porque
 * o service trava palpite em jogo que não está AGENDADO ("ja comecou").
 *
 * Este script registra o palpite DIRETO no repositório (bypass da trava,
 * de propósito), recalcula a pontuação da rodada e o ranking, e mostra os
 * pontos que o usuário ganhou. NÃO inventa pontos — registra o palpite real
 * e deixa o motor de pontuação calcular (placar exato 10 / vencedor+gols 7 /
 * etc.), preservando a integridade do ranking.
 *
 * Idempotente (UPSERT por palpite+jogo). Rodar 2× não duplica nem dá pontos
 * a mais.
 *
 * Uso (no container app):
 *   # 1) DRY-RUN (não escreve nada — mostra o que faria):
 *   docker compose exec app npx tsx scripts/recuperar-palpite-jogo-fechado.ts \
 *     <waId> "Coreia do Sul 1x1 República Tcheca"
 *
 *   # 2) APLICAR de verdade:
 *   docker compose exec app npx tsx scripts/recuperar-palpite-jogo-fechado.ts \
 *     <waId> "Coreia do Sul 1x1 República Tcheca" --apply
 */
import 'dotenv/config';
import { prisma } from '../src/config/database.js';
import { acharJogoPorTimes, resolverPalpiteParaJogo } from '../src/utils/validators.js';
import { calcularPontos } from '../src/modules/ranking/pontuacao.calc.js';
import { getOrCreatePalpite, registrarPalpiteJogo } from '../src/modules/palpite/palpite.repository.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../src/modules/ranking/ranking.service.js';

interface PalpiteIn {
  timeCasa: string;
  golsCasa: number;
  golsVisitante: number;
  timeVisitante: string;
  texto: string;
}

function parse(texto: string): PalpiteIn | null {
  const m = texto.trim().match(/^(.+?)\s+(\d+)\s*[xX-]\s*(\d+)\s+(.+)$/);
  if (!m) return null;
  return {
    timeCasa: m[1].trim(),
    golsCasa: parseInt(m[2], 10),
    golsVisitante: parseInt(m[3], 10),
    timeVisitante: m[4].trim(),
    texto,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [waId, ...resto] = args.filter((a) => a !== '--apply');
  const palpitesTxt = resto;

  if (!waId || palpitesTxt.length === 0) {
    console.error('Uso: recuperar-palpite-jogo-fechado.ts <waId> "Time1 NxN Time2" [...] [--apply]');
    process.exit(1);
  }

  // Busca tolerante: por whatsappId exato, por dígitos (JID vs número), ou nome.
  let usuario = await prisma.usuario.findFirst({ where: { whatsappId: waId } });
  if (!usuario) {
    const digits = waId.replace(/\D/g, '');
    if (digits.length >= 8) {
      usuario = await prisma.usuario.findFirst({ where: { whatsappId: { contains: digits } } });
    }
  }
  if (!usuario) {
    const candidatos = await prisma.usuario.findMany({
      where: { nome: { contains: waId, mode: 'insensitive' } },
      take: 5,
    });
    if (candidatos.length === 1) usuario = candidatos[0];
    else if (candidatos.length > 1) {
      console.error(`❌ "${waId}" casa ${candidatos.length} usuários — seja específico (número):`);
      candidatos.forEach((c) => console.error(`   - ${c.nome} (${c.whatsappId})`));
      process.exit(1);
    }
  }
  if (!usuario) {
    console.error(`❌ Nenhum usuário com whatsappId/nome = "${waId}"`);
    process.exit(1);
  }
  console.log(`\n👤 ${usuario.nome} (id=${usuario.id})  —  modo: ${apply ? 'APLICAR ✍️' : 'DRY-RUN 👀'}\n`);

  // Bolões do usuário (participante OU admin), com TODAS as rodadas/jogos.
  const boloes = await prisma.bolao.findMany({
    where: {
      OR: [{ adminId: usuario.id }, { participacoes: { some: { usuarioId: usuario.id } } }],
    },
    include: { rodadas: { include: { jogos: true } } },
  });

  const rodadasAfetadas = new Set<string>();
  const boloesAfetados = new Set<string>();
  let algoRegistrado = false;

  for (const txt of palpitesTxt) {
    const p = parse(txt);
    if (!p) {
      console.log(`⚠️  Não entendi "${txt}" — formato: "Coreia do Sul 1x1 República Tcheca". Pulando.`);
      continue;
    }

    let achou = false;
    for (const b of boloes) {
      for (const r of b.rodadas) {
        const m = acharJogoPorTimes(r.jogos, p.timeCasa, p.timeVisitante);
        if (!m) continue;
        achou = true;

        const resolvido = resolverPalpiteParaJogo(r.jogos, p)!; // ordem do fixture
        const j = m.jogo;
        const temPlacar = j.golsCasa !== null && j.golsVisitante !== null;
        const pontosPrevistos =
          j.status === 'FINALIZADO' && temPlacar
            ? calcularPontos(
                { golsCasa: resolvido.golsCasa, golsVisitante: resolvido.golsVisitante },
                { golsCasa: j.golsCasa!, golsVisitante: j.golsVisitante! },
              )
            : null;

        console.log(`🏆 ${b.nome} — Rodada ${r.numero}`);
        console.log(`   Jogo: ${j.timeCasa} x ${j.timeVisitante}  (status=${j.status}${temPlacar ? `, oficial ${j.golsCasa}x${j.golsVisitante}` : ''})`);
        console.log(`   Palpite a registrar: ${resolvido.timeCasa} ${resolvido.golsCasa}x${resolvido.golsVisitante} ${resolvido.timeVisitante}${m.invertido ? ' (ordem invertida corrigida)' : ''}`);
        console.log(`   → pontos previstos: ${pontosPrevistos ?? '(jogo não finalizado — pontua no apito)'}`);

        if (apply) {
          const palpite = await getOrCreatePalpite(usuario.id, r.id);
          await registrarPalpiteJogo(palpite.id, j.id, resolvido.golsCasa, resolvido.golsVisitante);
          rodadasAfetadas.add(r.id);
          boloesAfetados.add(b.id);
          algoRegistrado = true;
          console.log(`   ✅ registrado (upsert).`);
        }
        console.log();
      }
    }
    if (!achou) {
      console.log(`⚠️  Jogo "${p.timeCasa} x ${p.timeVisitante}" não encontrado em nenhum bolão do usuário.\n`);
    }
  }

  if (apply && algoRegistrado) {
    console.log('🧮 Recalculando pontuação e ranking...\n');
    for (const rid of rodadasAfetadas) await calcularPontuacaoRodada(rid);
    for (const bid of boloesAfetados) await recalcularRanking(bid);

    // Mostra o resultado final
    for (const bid of boloesAfetados) {
      const part = await prisma.participacao.findFirst({
        where: { bolaoId: bid, usuarioId: usuario.id },
        include: { bolao: { select: { nome: true } } },
      });
      if (part) {
        console.log(`📊 ${part.bolao.nome}: total ${part.pontuacaoTotal} pts, posição ${part.posicaoAtual}º`);
      }
    }
    console.log('\n✅ Pronto. Os pontos do(s) jogo(s) finalizado(s) já entraram.\n');
  } else if (!apply) {
    console.log('👀 DRY-RUN — nada foi gravado. Rode de novo com --apply pra efetivar.\n');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
