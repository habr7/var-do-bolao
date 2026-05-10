import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { bomDia } from '../utils/football.terms.js';

/**
 * Job de "bom dia, boleiros". Roda HOURLY e decide por bolao quando
 * disparar.
 *
 * Regra de horario:
 *   - Default: HORARIO_BOM_DIA (ex 09:00) no fuso de Brasilia.
 *   - Se HORARIO_BOM_DIA cair DEPOIS de (kickoff - 8h) — ou seja, o
 *     primeiro jogo do dia eh suficientemente cedo pra que 09:00 ja
 *     esteja passado da janela de "8h antes" — desloca o bom dia pra
 *     (kickoff - 6h). Assim a saudacao chega antes da chamada de
 *     palpite (que dispara em kickoff - PALPITE_CALL_HORAS_ANTES, default 6h).
 *
 * Filtro: so envia para usuarios que tem **jogo do bolao no dia de hoje**.
 *
 * Idempotencia: flag Redis `bomdia:{waId}:{YYYY-MM-DD}` com TTL 25h.
 */
export async function sendBomDiaJob() {
  const agora = new Date();
  const inicioHoje = new Date(agora);
  inicioHoje.setHours(0, 0, 0, 0);
  const fimHoje = new Date(agora);
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

  const hoje = agora.toISOString().slice(0, 10); // YYYY-MM-DD

  // ---- Decide alvo (waId, nome, jogos do dia, primeiroJogo) ----
  // Mesmo usuario pode estar em varios bolaoes — agrega.
  interface Alvo {
    waId: string;
    nome: string;
    jogosHoje: { timeCasa: string; timeVisitante: string; dataHora: Date }[];
    primeiroJogoHoje: Date;
  }

  const alvosMap = new Map<string, Alvo>();
  for (const bolao of boloesComJogo) {
    const jogosBolao = bolao.rodadas.flatMap((r) => r.jogos);
    if (jogosBolao.length === 0) continue;
    for (const p of bolao.participacoes) {
      const waId = p.usuario.whatsappId;
      if (!waId) continue;
      const existente = alvosMap.get(waId);
      const jogosCombinados = existente
        ? [...existente.jogosHoje, ...jogosBolao]
        : [...jogosBolao];
      jogosCombinados.sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
      alvosMap.set(waId, {
        waId,
        nome: p.usuario.nome,
        jogosHoje: jogosCombinados,
        primeiroJogoHoje: jogosCombinados[0].dataHora,
      });
    }
  }

  // ---- Calcula janela de envio (em ms desde epoch) ----
  // horaDefault = HORARIO_BOM_DIA hoje em Brasilia
  const [hStr, mStr] = env.HORARIO_BOM_DIA.split(':');
  const horaPadrao = parseInt(hStr, 10);
  const minPadrao = parseInt(mStr ?? '0', 10);

  const formatHorario = (d: Date) =>
    d.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: env.TIMEZONE,
    });

  for (const alvo of alvosMap.values()) {
    const flag = `bomdia:${alvo.waId}:${hoje}`;
    const ja = await redis.get(flag);
    if (ja) continue;

    // horaPadraoToday: 09:00 BRT do dia atual (em UTC)
    const horaPadraoToday = brasiliaHoraToUtc(agora, horaPadrao, minPadrao);

    const kickoffMenos8 = new Date(alvo.primeiroJogoHoje.getTime() - 8 * 3600_000);
    const kickoffMenos6 = new Date(alvo.primeiroJogoHoje.getTime() - 6 * 3600_000);

    // Regra: se default ficaria depois de kickoff-8, dispara em kickoff-6.
    const targetTime =
      horaPadraoToday.getTime() > kickoffMenos8.getTime() ? kickoffMenos6 : horaPadraoToday;

    // Janela de 1h: dispara quando agora ∈ [target, target + 1h)
    const diffMs = agora.getTime() - targetTime.getTime();
    if (diffMs < 0 || diffMs >= 3600_000) continue;

    // Nao manda em horario absurdo (madrugada). Cap em 06:00 BRT.
    const horaBrasiliaAgora = parseInt(
      agora.toLocaleString('en-US', { timeZone: env.TIMEZONE, hour: 'numeric', hour12: false }),
      10,
    );
    if (horaBrasiliaAgora < 6) continue;

    // Monta mensagem
    const linhasJogos = alvo.jogosHoje
      .slice(0, 8)
      .map((j) => `• ${formatHorario(j.dataHora)} — ${j.timeCasa} x ${j.timeVisitante}`);

    const mensagem =
      `${bomDia()}\n\n` +
      `Hoje rola jogo da Copa, ó:\n${linhasJogos.join('\n')}\n\n` +
      `_Mais perto da hora eu mando a chamada pra você palpitar._ ⚽`;

    try {
      await sendText({ to: alvo.waId, text: mensagem });
      await redis.set(flag, '1', 'EX', 25 * 3600);
    } catch (error) {
      console.error(
        `[bom-dia] falha ao enviar pra ${alvo.waId} (${alvo.nome}):`,
        (error as Error).message,
      );
    }
  }
}

/**
 * Devolve um Date em UTC representando "HH:MM no fuso de Brasilia
 * do mesmo dia em que `referencia` esta (em Brasilia)".
 *
 * Ex: referencia=2026-06-13T18:00Z (15:00 BRT), HH=9, MM=0 →
 * devolve 2026-06-13T12:00Z (09:00 BRT).
 *
 * Implementacao simples: usa Intl.DateTimeFormat pra extrair o ano/mes/dia
 * em Brasilia, depois constroi um Date UTC e adiciona o offset de -3h.
 *
 * Brasilia eh fixo UTC-3 (sem horario de verao desde 2019).
 */
function brasiliaHoraToUtc(referencia: Date, horas: number, minutos: number): Date {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const partes = fmt.formatToParts(referencia);
  const ano = partes.find((p) => p.type === 'year')!.value;
  const mes = partes.find((p) => p.type === 'month')!.value;
  const dia = partes.find((p) => p.type === 'day')!.value;
  // YYYY-MM-DDTHH:MM:00-03:00 em Brasilia
  const iso = `${ano}-${mes}-${dia}T${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:00-03:00`;
  return new Date(iso);
}
