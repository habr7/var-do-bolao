import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { bomDia } from '../utils/football.terms.js';

/**
 * Job de "bom dia, boleiros". Roda em horario fixo (HORARIO_BOM_DIA, default 09:00).
 *
 * Filtra so para usuarios que tem **jogo do bolao no dia de hoje**, evitando
 * spam diario gratuito. Envia uma mensagem leve, sem ainda pedir palpite —
 * a chamada de palpite vem do job send-palpite-call algumas horas antes
 * do primeiro jogo.
 *
 * Por que essa separacao:
 *  - Em um futuro com Meta Cloud API (com janela de 24h), o "bom dia"
 *    abre a conversa, fazendo as mensagens posteriores nao pagarem
 *    template. Aqui na Evolution API o custo nao se aplica, mas o
 *    desenho ja prepara o caminho.
 *
 * Idempotencia: usa flag em Redis `bomdia:{waId}:{YYYY-MM-DD}` com TTL
 * de 25h, garantindo que cada usuario receba so uma vez por dia mesmo
 * se o job rodar 2x por algum motivo.
 */
export async function sendBomDiaJob() {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  const fimHoje = new Date();
  fimHoje.setHours(23, 59, 59, 999);

  // Bolaoes ativos com pelo menos 1 jogo hoje
  const boloesComJogo = await prisma.bolao.findMany({
    where: {
      status: 'ATIVO',
      rodadas: {
        some: {
          jogos: { some: { dataHora: { gte: inicioHoje, lte: fimHoje } } },
        },
      },
    },
    include: {
      participacoes: { include: { usuario: true } },
      rodadas: {
        where: { status: 'ABERTA' },
        include: {
          jogos: {
            where: { dataHora: { gte: inicioHoje, lte: fimHoje } },
            orderBy: { dataHora: 'asc' },
          },
        },
      },
    },
  });

  if (boloesComJogo.length === 0) return;

  const hoje = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Coleta wa_ids unicos (usuario pode estar em varios bolaoes — manda 1x)
  const targetWaIds = new Map<string, string>(); // waId -> nome
  for (const bolao of boloesComJogo) {
    for (const p of bolao.participacoes) {
      if (p.usuario.whatsappId) targetWaIds.set(p.usuario.whatsappId, p.usuario.nome);
    }
  }

  for (const [waId, nome] of targetWaIds.entries()) {
    const flag = `bomdia:${waId}:${hoje}`;
    const ja = await redis.get(flag);
    if (ja) continue;

    // Lista jogos do dia agregados (todos os bolaoes em que essa pessoa participa)
    const jogosHoje = boloesComJogo
      .filter((b) => b.participacoes.some((p) => p.usuario.whatsappId === waId))
      .flatMap((b) => b.rodadas.flatMap((r) => r.jogos))
      .sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());

    if (jogosHoje.length === 0) continue;

    const formatHorario = (d: Date) =>
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

    const linhasJogos = jogosHoje
      .slice(0, 8)
      .map((j) => `• ${formatHorario(j.dataHora)} — ${j.timeCasa} x ${j.timeVisitante}`);

    const mensagem =
      `${bomDia()}\n\n` +
      `Hoje rola jogo da Copa, ó:\n${linhasJogos.join('\n')}\n\n` +
      `_Mais perto da hora eu mando a chamada pra você palpitar._ ⚽`;

    try {
      await sendText({ to: waId, text: mensagem });
      await redis.set(flag, '1', 'EX', 25 * 3600);
    } catch (error) {
      console.error(`[bom-dia] falha ao enviar pra ${waId} (${nome}):`, (error as Error).message);
    }
  }
}
