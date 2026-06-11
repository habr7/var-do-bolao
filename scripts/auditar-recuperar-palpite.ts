/**
 * v3.19.0 — Script de auditoria + recuperação manual de palpites.
 *
 * Caso real motivador (Natane 11/06 14:02): bot rodou
 * `tentarPalpiteLivreViaLLM` que registrava palpites SEM mostrar
 * preview, e respondia "✅ Palpite registrado!" mesmo se LLM tivesse
 * alucinado. Esse script existe pra:
 *
 *   1. AUDITAR: ver exatamente o que está no banco pra um waId (quais
 *      bolões, rodada aberta, palpites já registrados com placares).
 *   2. RECUPERAR: registrar uma lista de palpites manualmente, com
 *      UPSERT idempotente (reusa palpiteService que já tem isso).
 *
 * Uso (dentro do container app):
 *
 *   docker compose exec app npx tsx scripts/auditar-recuperar-palpite.ts \
 *     audit <waId>
 *
 *   docker compose exec app npx tsx scripts/auditar-recuperar-palpite.ts \
 *     registrar <waId> "1x2 Mexico x Africa do Sul" "1x0 Coreia do Sul x Republica Tcheca" ...
 *
 * UPSERT garante idempotência: rodar 2× não duplica. Se o jogo já
 * tinha palpite com placar diferente, sobrescreve (correção).
 */
import 'dotenv/config';
import { prisma } from '../src/config/database.js';
import * as palpiteService from '../src/modules/palpite/palpite.service.js';

interface PalpiteParsed {
  golsCasa: number;
  golsVisitante: number;
  timeCasa: string;
  timeVisitante: string;
  textoOriginal: string;
}

/**
 * Aceita os 3 formatos canônicos do bot:
 *   - "Time1 NxN Time2"          (canônico)
 *   - "NxN Time1 x Time2"        (invertido v3.10.0)
 *   - "N Time1 X N Time2"        (separado — caso Natane v3.19.0)
 *
 * Retorna null se nenhum match.
 */
function parsePalpite(texto: string): PalpiteParsed | null {
  const t = texto.trim();
  // canônico
  let m = t.match(/^(.+?)\s+(\d+)\s*[xX-]\s*(\d+)\s+(.+)$/);
  if (m) {
    return {
      timeCasa: m[1].trim(),
      golsCasa: parseInt(m[2], 10),
      golsVisitante: parseInt(m[3], 10),
      timeVisitante: m[4].trim(),
      textoOriginal: texto,
    };
  }
  // invertido NxN
  m = t.match(/^(\d+)\s*[xX-]\s*(\d+)\s+(.+?)\s+[xX]\s+(.+)$/);
  if (m) {
    return {
      golsCasa: parseInt(m[1], 10),
      golsVisitante: parseInt(m[2], 10),
      timeCasa: m[3].trim(),
      timeVisitante: m[4].trim(),
      textoOriginal: texto,
    };
  }
  // gols separados (formato Natane)
  m = t.match(/^(\d+)\s+(.+?)\s+[xX]\s+(\d+)\s+(.+)$/);
  if (m) {
    return {
      golsCasa: parseInt(m[1], 10),
      timeCasa: m[2].trim(),
      golsVisitante: parseInt(m[3], 10),
      timeVisitante: m[4].trim(),
      textoOriginal: texto,
    };
  }
  return null;
}

async function audit(waId: string): Promise<void> {
  const usuario = await prisma.usuario.findFirst({ where: { whatsappId: waId } });
  if (!usuario) {
    console.log(`❌ Nenhum usuário com whatsappId=${waId}`);
    return;
  }
  console.log(`\n👤 Usuário: ${usuario.nome} (id=${usuario.id})`);

  const participacoes = await prisma.participacao.findMany({
    where: { usuarioId: usuario.id },
    include: {
      bolao: {
        include: {
          rodadas: {
            where: { status: 'ABERTA' },
            include: {
              palpites: {
                where: { usuarioId: usuario.id },
                include: { jogos: { include: { jogo: true } } },
              },
              jogos: {
                where: { status: { in: ['AGENDADO', 'AO_VIVO'] } },
                orderBy: { dataHora: 'asc' },
              },
            },
          },
        },
      },
    },
  });

  if (participacoes.length === 0) {
    console.log('  (não participa de nenhum bolão)');
    return;
  }

  for (const p of participacoes) {
    console.log(`\n🏆 Bolão: ${p.bolao.nome} (id=${p.bolao.id}, status=${p.bolao.status})`);
    if (p.bolao.rodadas.length === 0) {
      console.log('  (sem rodada ABERTA)');
      continue;
    }
    for (const r of p.bolao.rodadas) {
      console.log(`  📅 Rodada ${r.numero} (id=${r.id}, total ${r.jogos.length} jogo(s) abertos)`);
      const palpitesDoUser = r.palpites[0];
      if (!palpitesDoUser) {
        console.log('     ⚪ Nenhum palpite registrado nesta rodada.');
        continue;
      }
      console.log(`     ✅ ${palpitesDoUser.jogos.length} palpite(s) registrado(s) (calculado=${palpitesDoUser.calculado}, pontuacao=${palpitesDoUser.pontuacao}):`);
      for (const pj of palpitesDoUser.jogos) {
        const j = pj.jogo;
        console.log(`        • ${j.timeCasa} ${pj.golsCasa} × ${pj.golsVisitante} ${j.timeVisitante} _(jogoId=${j.id}, dataHora=${j.dataHora.toISOString()})_`);
      }
    }
  }
  console.log();
}

async function registrar(waId: string, palpitesArgs: string[]): Promise<void> {
  const usuario = await prisma.usuario.findFirst({ where: { whatsappId: waId } });
  if (!usuario) {
    console.log(`❌ Nenhum usuário com whatsappId=${waId}`);
    return;
  }
  console.log(`\n👤 Usuário: ${usuario.nome} (id=${usuario.id})`);

  const palpitesParsed: PalpiteParsed[] = [];
  for (const arg of palpitesArgs) {
    const p = parsePalpite(arg);
    if (!p) {
      console.error(`⚠️  Não entendi: "${arg}" — pule ou reformate. Formatos:`);
      console.error(`     "Brasil 2x1 Marrocos" / "2x1 Brasil x Marrocos" / "2 Brasil X 1 Marrocos"`);
      process.exit(2);
    }
    palpitesParsed.push(p);
  }

  console.log(`\n📋 ${palpitesParsed.length} palpite(s) parseado(s):\n`);
  palpitesParsed.forEach((p, i) =>
    console.log(
      `  ${i + 1}. ${p.timeCasa} ${p.golsCasa} × ${p.golsVisitante} ${p.timeVisitante}` +
        `    _(de: "${p.textoOriginal}")_`,
    ),
  );

  console.log(`\n🚀 Registrando via palpiteService.registrarPalpitesEmTodosBoloes (UPSERT, idempotente)...\n`);
  const resultado = await palpiteService.registrarPalpitesEmTodosBoloes({
    usuarioId: usuario.id,
    palpites: palpitesParsed.map((p) => ({
      timeCasa: p.timeCasa,
      timeVisitante: p.timeVisitante,
      golsCasa: p.golsCasa,
      golsVisitante: p.golsVisitante,
    })),
  });

  console.log(`\n📊 Resultado consolidado (${palpitesParsed.length} palpite(s) do lote):\n`);
  for (const b of resultado.porBolao) {
    const sufixoErr = b.erros.length > 0 ? ` ⚠️ ${b.erros.length} erro(s)` : '';
    console.log(
      `  • ${b.bolaoNome}: ${b.registrados}/${resultado.totalPalpitesDoLote} registrados, ` +
        `${b.naoAplicaveis} não-aplicáveis (jogo não existe nesse bolão)${sufixoErr}`,
    );
    for (const e of b.erros) {
      console.log(`     - ${e.jogo}: ${e.motivo}`);
    }
  }
  console.log();
}

async function main(): Promise<void> {
  const [cmd, waId, ...palpiteArgs] = process.argv.slice(2);
  if (!cmd || !waId) {
    console.error('Uso:');
    console.error('  audit <waId>');
    console.error('  registrar <waId> <palpite1> <palpite2> ...');
    console.error('Ex:');
    console.error('  registrar 5511949607958 "1x2 Mexico x Africa do Sul" "3x1 Brasil x Marrocos"');
    process.exit(1);
  }
  if (cmd === 'audit') {
    await audit(waId);
  } else if (cmd === 'registrar') {
    if (palpiteArgs.length === 0) {
      console.error('❌ registrar precisa de pelo menos 1 palpite como argumento.');
      process.exit(1);
    }
    await registrar(waId, palpiteArgs);
  } else {
    console.error(`❌ Comando desconhecido: ${cmd}. Use "audit" ou "registrar".`);
    process.exit(1);
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('❌ Falha:', e);
  await prisma.$disconnect();
  process.exit(1);
});
