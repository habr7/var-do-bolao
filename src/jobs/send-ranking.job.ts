import { prisma } from '../config/database.js';
import { recalcularRanking } from '../modules/ranking/ranking.service.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
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
  // v3.53.0 — disparo em massa (1 msg por participante por rodada). OFF por
  // padrão; ligue ENABLE_RANKING=true só quando o número estiver seguro.
  if (!env.ENABLE_RANKING) return;
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
    let falhas = 0;
    for (const p of bolao.participacoes) {
      // v3.28.0 — idempotência POR USUÁRIO: na retry (quando a rodada não
      // foi 100% entregue), quem já recebeu não recebe de novo.
      const flagUser = `ranking-sent:${rodada.id}:${p.usuarioId}`;
      if (await redis.get(flagUser)) continue;

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
        await redis.set(flagUser, '1', 'EX', 7 * 24 * 3600);
        envios++;
      } catch (error) {
        falhas++;
        console.error(
          `[send-ranking] falha ao enviar pra ${p.usuario.whatsappId}:`,
          (error as Error).message,
        );
      }
    }

    // v3.28.0 — só marca a rodada como concluída quando NINGUÉM falhou.
    // Com falhas, a flag fica aberta e o próximo tick reenvia SÓ pra quem
    // faltou (graças à flag por usuário acima). Antes bastava 1 envio ok
    // pra marcar concluída → os que falharam nunca recebiam.
    if (falhas === 0 && envios >= 0) {
      await redis.set(flag, '1', 'EX', 7 * 24 * 3600);
    }
  }
}
