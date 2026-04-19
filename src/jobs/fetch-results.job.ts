import { buscarRodadasComJogosEmAndamento, finalizarRodada } from '../modules/rodada/rodada.repository.js';
import { atualizarResultados } from '../modules/resultado/resultado.service.js';
import { calcularPontuacaoRodada, recalcularRanking } from '../modules/ranking/ranking.service.js';
import { enviarRankingParaParticipantes } from '../modules/notificacao/notificacao.service.js';
import { prisma } from '../config/database.js';

export async function fetchResultsJob() {
  const rodadas = await buscarRodadasComJogosEmAndamento();
  if (rodadas.length === 0) return;

  for (const rodada of rodadas) {
    try {
      const { todosFinalizados } = await atualizarResultados(
        rodada.id,
        rodada.bolao.campeonatoId,
        rodada.numero,
      );

      if (todosFinalizados) {
        await calcularPontuacaoRodada(rodada.id);
        const ranking = await recalcularRanking(rodada.bolaoId);
        await finalizarRodada(rodada.id);

        // Lista todos wa_ids do bolao para enviar ranking em DM
        const participantes = await prisma.participacao.findMany({
          where: { bolaoId: rodada.bolaoId },
          include: { usuario: true },
        });

        await enviarRankingParaParticipantes({
          waIds: participantes.map((p) => p.usuario.whatsappId),
          nomeBolao: rodada.bolao.nome,
          rodada: rodada.numero,
          campeonato: rodada.bolao.campeonatoNome,
          ranking,
        });
      }
    } catch (error) {
      console.error(`[fetch-results] erro na rodada ${rodada.numero}:`, error);
    }
  }
}
