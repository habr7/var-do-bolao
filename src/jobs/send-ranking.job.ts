import { prisma } from '../config/database.js';
import { recalcularRanking } from '../modules/ranking/ranking.service.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { celebracao, lamento, medalha } from '../utils/football.terms.js';

/**
 * Envia mensagem PERSONALIZADA pra cada participante apos uma rodada
 * finalizar. Cada um recebe:
 *  - Pontuacao individual da rodada
 *  - Posicao no ranking + numero total de participantes
 *  - Tom alegre/sarcastico baseado na performance
 *  - Convite pra ver o ranking completo via comando "ranking"
 *
 * Idempotente via flag Redis `ranking-sent:{rodadaId}` com TTL 7d.
 */
export async function sendRankingJob() {
  const rodadasFinalizadas = await prisma.rodada.findMany({
    where: { status: 'FINALIZADA' },
    select: { id: true, bolaoId: true, numero: true },
  });

  for (const rodada of rodadasFinalizadas) {
    const flag = `ranking-sent:${rodada.id}`;
    const ja = await redis.get(flag);
    if (ja) continue;

    const bolao = await prisma.bolao.findUnique({
      where: { id: rodada.bolaoId },
      include: { participacoes: { include: { usuario: true } } },
    });
    if (!bolao) continue;

    const palpitesRodada = await prisma.palpite.findMany({
      where: { rodadaId: rodada.id },
      select: { usuarioId: true, pontuacao: true },
    });

    let ranking;
    try {
      ranking = await recalcularRanking(rodada.bolaoId);
    } catch (error) {
      console.error(`[send-ranking] erro recalculando ranking de ${rodada.bolaoId}:`, error);
      continue;
    }

    const totalParticipantes = ranking.length;
    const pontosPorUsuario = new Map(palpitesRodada.map((p) => [p.usuarioId, p.pontuacao]));

    let envios = 0;
    for (const p of bolao.participacoes) {
      const pontosRodada = pontosPorUsuario.get(p.usuarioId) ?? 0;
      const entradaRanking = ranking.find((r) => r.nome === p.usuario.nome);
      const posicao = entradaRanking?.posicao ?? 0;
      const totalGeral = entradaRanking?.pontuacaoTotal ?? 0;

      const tom =
        pontosRodada >= 7 ? celebracao() : pontosRodada >= 3 ? '👀 Deu pra fazer pontos!' : lamento();

      const linhaPosicao =
        posicao > 0
          ? `${medalha(posicao)} *${posicao}º lugar* de ${totalParticipantes} no ${bolao.nome}`
          : `📊 Você ainda não pontuou no ${bolao.nome}`;

      const mensagem =
        `🏁 *Rodada ${rodada.numero} encerrada!*\n\n` +
        `${tom}\n\n` +
        `Você fez *${pontosRodada} pts* nesta rodada.\n` +
        `${linhaPosicao}\n` +
        `_Total geral: ${totalGeral} pts_\n\n` +
        `Quer ver a tabela completa? Manda *ranking ${bolao.nome}* aqui mesmo. ⚽`;

      try {
        await sendText({ to: p.usuario.whatsappId, text: mensagem });
        envios++;
      } catch (error) {
        console.error(
          `[send-ranking] falha ao enviar pra ${p.usuario.whatsappId}:`,
          (error as Error).message,
        );
      }
    }

    if (envios > 0) {
      await redis.set(flag, '1', 'EX', 7 * 24 * 3600);
    }
  }
}
