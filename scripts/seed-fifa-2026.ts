/**
 * Script CLI para popular um bolao existente com os 72 jogos da fase de
 * grupos da Copa 2026. Util quando voce ja criou o bolao mas atualizou
 * o JSON de fixtures depois (ex: o sorteio da FIFA saiu e voce mudou
 * "A1" pra "Brasil").
 *
 * Uso:
 *   npx tsx scripts/seed-fifa-2026.ts <bolaoId>
 *
 * Apaga TODOS os jogos da rodada 1 do bolao e re-cria com base no JSON
 * atual em src/data/fifa-2026-fixtures.json.
 *
 * IMPORTANTE: nao apaga palpites — eles sao recalculados pelo apiJogoId,
 * entao se voce mudou a ordem mas mantém os mesmos apiJogoIds, os
 * palpites continuam validos.
 */
import 'dotenv/config';
import { prisma } from '../src/config/database.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { buscarJogosParaRodada } from '../src/modules/resultado/resultado.service.js';
import * as rodadaRepo from '../src/modules/rodada/rodada.repository.js';

async function main() {
  const bolaoId = process.argv[2];
  if (!bolaoId) {
    console.error('❌ Uso: npx tsx scripts/seed-fifa-2026.ts <bolaoId>');
    process.exit(1);
  }

  await connectDatabase();

  const bolao = await prisma.bolao.findUnique({ where: { id: bolaoId } });
  if (!bolao) {
    console.error(`❌ Bolao ${bolaoId} nao encontrado.`);
    await disconnectDatabase();
    process.exit(1);
  }

  console.log(`📥 Carregando jogos para bolao "${bolao.nome}"...`);
  const jogos = await buscarJogosParaRodada(bolao.campeonatoId, 1);
  if (jogos.length === 0) {
    console.error('❌ Nenhum jogo retornado pelo adapter de futebol.');
    await disconnectDatabase();
    process.exit(1);
  }
  console.log(`✅ ${jogos.length} jogos carregados.`);

  let rodada = await prisma.rodada.findUnique({
    where: { bolaoId_numero: { bolaoId, numero: 1 } },
  });

  const primeiroJogo = jogos.reduce(
    (min, j) => (j.dataHora < min ? j.dataHora : min),
    jogos[0].dataHora,
  );

  if (!rodada) {
    rodada = await rodadaRepo.criarRodada({
      bolaoId,
      numero: 1,
      dataAbertura: new Date(),
      dataFechamento: primeiroJogo,
    });
    console.log(`✅ Rodada 1 criada (id=${rodada.id}).`);
  } else {
    console.log(`ℹ Rodada 1 ja existia. Atualizando jogos...`);
  }

  // Para cada jogo do JSON: upsert por apiJogoId (jogos novos sao criados,
  // existentes tem timeCasa/timeVisitante/dataHora atualizados).
  let criados = 0;
  let atualizados = 0;
  for (const j of jogos) {
    const existente = await prisma.jogo.findUnique({ where: { apiJogoId: j.apiJogoId } });
    if (existente) {
      await prisma.jogo.update({
        where: { id: existente.id },
        data: {
          timeCasa: j.timeCasa,
          timeVisitante: j.timeVisitante,
          dataHora: j.dataHora,
        },
      });
      atualizados++;
    } else {
      await prisma.jogo.create({
        data: {
          rodadaId: rodada.id,
          apiJogoId: j.apiJogoId,
          timeCasa: j.timeCasa,
          timeVisitante: j.timeVisitante,
          dataHora: j.dataHora,
        },
      });
      criados++;
    }
  }

  // Atualiza dataFechamento da rodada com o primeiro jogo do calendario
  await prisma.rodada.update({
    where: { id: rodada.id },
    data: { dataFechamento: primeiroJogo },
  });

  console.log(`✅ Concluido: ${criados} criado(s), ${atualizados} atualizado(s).`);
  await disconnectDatabase();
}

main().catch(async (err) => {
  console.error('❌ erro fatal:', err);
  await disconnectDatabase();
  process.exit(1);
});
