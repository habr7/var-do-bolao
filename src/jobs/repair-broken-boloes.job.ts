/**
 * Repair job — boloes em estado quebrado (rodada vazia ou sem rodada).
 *
 * Contexto: ate 17/05/2026, `Jogo.apiJogoId` era unique global. O adapter
 * FifaWorldCup2026Adapter retorna sempre os mesmos 72 apiJogoIds, entao
 * do 2o bolao em diante a chamada createMany de jogos estourava P2002 e o
 * try/catch silencioso de criarBolao engolia o erro. Resultado: bolao
 * criado + rodada criada + ZERO jogos. Quando o usuario mandava "proximos
 * jogos" recebia "nao tem rodada aberta" mesmo com a rodada existindo.
 *
 * Este job:
 *   1. Procura boloes ATIVOS sem rodada
 *   2. Procura boloes ATIVOS com rodada vazia
 *   3. Tenta carregar jogos via adapter e inserir
 *   4. Notifica o admin via DM em cada reparo
 *
 * Roda 1x ao subir o servidor (limpa legado existente) e depois 1x/dia
 * as 03:00 (defensivo — qualquer falha futura cai aqui).
 *
 * Idempotente: se bolao ja tem jogos, ignora.
 */
import { prisma } from '../config/database.js';
import { buscarJogosParaRodada } from '../modules/resultado/resultado.service.js';
import { sendText } from '../whatsapp/evolution.client.js';

export async function repararBoloesQuebrados() {
  console.log('[repair-broken-boloes] iniciando varredura');

  // Boloes ATIVOS sem nenhuma rodada
  const semRodada = await prisma.bolao.findMany({
    where: { status: 'ATIVO', rodadas: { none: {} } },
    include: { admin: true },
  });

  // Boloes ATIVOS que tem rodada(s) mas alguma delas esta vazia.
  // include filtra so as rodadas vazias pra simplificar o loop.
  const comRodadaVazia = await prisma.bolao.findMany({
    where: {
      status: 'ATIVO',
      rodadas: { some: { jogos: { none: {} } } },
    },
    include: {
      admin: true,
      rodadas: {
        where: { jogos: { none: {} } },
        orderBy: { numero: 'asc' },
      },
    },
  });

  console.log(
    `[repair-broken-boloes] encontrados: ${semRodada.length} sem rodada, ` +
    `${comRodadaVazia.length} com rodada vazia`,
  );

  let reparados = 0;

  // Caso 1: sem rodada — cria rodada + jogos
  for (const b of semRodada) {
    try {
      const jogos = await buscarJogosParaRodada(b.campeonatoId, 1);
      if (jogos.length === 0) {
        console.warn(`[repair-broken-boloes] adapter retornou 0 jogos pra ${b.codigo}, pulando`);
        continue;
      }

      const primeiroJogo = jogos.reduce(
        (min, j) => (j.dataHora < min ? j.dataHora : min),
        jogos[0].dataHora,
      );

      await prisma.$transaction(async (tx) => {
        const rodada = await tx.rodada.create({
          data: {
            bolaoId: b.id,
            numero: 1,
            dataAbertura: new Date(),
            dataFechamento: primeiroJogo,
          },
        });
        await tx.jogo.createMany({
          data: jogos.map((j) => ({
            rodadaId: rodada.id,
            apiJogoId: j.apiJogoId,
            timeCasa: j.timeCasa,
            timeVisitante: j.timeVisitante,
            dataHora: j.dataHora,
          })),
        });
      });

      reparados++;
      console.log(`[repair-broken-boloes] reparado #${b.codigo} (${b.nome}) — sem rodada → ${jogos.length} jogos`);

      // Notifica o admin (best-effort — falha em DM nao quebra o reparo)
      try {
        await sendText({
          to: b.admin.whatsappId,
          text:
            `✅ Acabei de carregar os jogos da Copa pro seu bolão *${b.nome}*. ` +
            `Já dá pra palpitar! Manda *próximos jogos* pra ver.`,
        });
      } catch (notifyErr) {
        console.warn(
          `[repair-broken-boloes] notificacao falhou pra ${b.codigo}:`,
          (notifyErr as Error).message,
        );
      }
    } catch (e) {
      console.error(`[repair-broken-boloes] falha reparando ${b.codigo}:`, (e as Error).message);
    }
  }

  // Caso 2: rodada existe mas esta vazia — preenche jogos na rodada existente
  for (const b of comRodadaVazia) {
    try {
      // Pega a primeira rodada vazia (em geral so tem 1 por bolao no momento)
      const rodadaVazia = b.rodadas[0];
      if (!rodadaVazia) continue;

      const jogos = await buscarJogosParaRodada(b.campeonatoId, rodadaVazia.numero);
      if (jogos.length === 0) {
        console.warn(`[repair-broken-boloes] adapter retornou 0 jogos pra ${b.codigo}, pulando`);
        continue;
      }

      await prisma.jogo.createMany({
        data: jogos.map((j) => ({
          rodadaId: rodadaVazia.id,
          apiJogoId: j.apiJogoId,
          timeCasa: j.timeCasa,
          timeVisitante: j.timeVisitante,
          dataHora: j.dataHora,
        })),
      });

      // Atualiza a data de fechamento da rodada pro 1o jogo, se ainda nao foi
      const primeiroJogo = jogos.reduce(
        (min, j) => (j.dataHora < min ? j.dataHora : min),
        jogos[0].dataHora,
      );
      await prisma.rodada.update({
        where: { id: rodadaVazia.id },
        data: { dataFechamento: primeiroJogo },
      });

      reparados++;
      console.log(
        `[repair-broken-boloes] reparado #${b.codigo} (${b.nome}) — rodada vazia → ${jogos.length} jogos`,
      );

      try {
        await sendText({
          to: b.admin.whatsappId,
          text:
            `✅ Carreguei os jogos da Copa pro seu bolão *${b.nome}*. ` +
            `Manda *próximos jogos* pra ver e palpitar.`,
        });
      } catch (notifyErr) {
        console.warn(
          `[repair-broken-boloes] notificacao falhou pra ${b.codigo}:`,
          (notifyErr as Error).message,
        );
      }
    } catch (e) {
      console.error(`[repair-broken-boloes] falha reparando ${b.codigo}:`, (e as Error).message);
    }
  }

  console.log(`[repair-broken-boloes] finalizado — ${reparados} bolao(es) reparado(s)`);
  return {
    reparados,
    semRodadaTotal: semRodada.length,
    comRodadaVaziaTotal: comRodadaVazia.length,
  };
}
