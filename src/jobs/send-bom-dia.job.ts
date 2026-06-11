import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { formatarDataHoraCurtaBR, formatarHoraBR } from '../utils/datetime.js';
import { podeEnviarAvisoHoje, registrarAvisoEnviado } from '../utils/aviso-cap.js';

/**
 * Job "aviso de jogo" — v3.13.0 reescrito (caso real Jeniffer 11/06).
 *
 * Roda HOURLY. Pra cada usuário com jogo aberto, decide se está dentro
 * da janela de envio "6h antes do próximo jogo" com 3 guardas:
 *
 *   1. **Clamp horário civilizado**: só envia entre 07:00–22:00 BRT.
 *      Se "6h antes" cair fora, dispara em 22:00 do dia anterior
 *      (pra jogos da madrugada que rolam 01h BRT).
 *
 *   2. **Cooldown 24h**: flag Redis `aviso_jogo:{waId}` TTL 24h.
 *      Garantia firme: máximo 1 mensagem por usuário por dia.
 *
 *   3. **Cross-job**: mesma flag é honrada por `send-palpite-call`.
 *      Se palpite-call mandou nas últimas 24h, bom-dia pula.
 *
 * Conteúdo: lista TODOS os jogos do user nas próximas ~30h, marcando
 * ✅ palpitado / ⚪ pendente — assim 1 aviso cobre jogos consecutivos
 * num lote sem precisar de re-envio.
 *
 * Substituiu a lógica anterior de "envio em horário fixo 09:00" que
 * perdia jogos noturnos (Copa 2026 EUA Costa Oeste = 23h-04h BRT).
 */

const JANELA_PROXIMO_JOGO_HORAS = 6; // dispara em "kickoff - 6h"
const JANELA_LISTAGEM_HORAS = 30; // lista todos os jogos nas próximas N horas
const HORA_MIN_BRT = 7; // não envia antes das 07:00 BRT
const HORA_MAX_BRT = 22; // se "kickoff - 6h" cair >22, dispara em 22:00 do mesmo dia

export async function sendBomDiaJob() {
  if (!env.ENABLE_BOM_DIA) return;

  const agora = new Date();
  const limiteListagem = new Date(agora.getTime() + JANELA_LISTAGEM_HORAS * 3600_000);

  // Acha bolões com jogos nas próximas 30h (qualquer status que conte)
  const boloesComJogo = await prisma.bolao.findMany({
    where: {
      status: 'ATIVO',
      rodadas: {
        some: {
          status: 'ABERTA',
          jogos: { some: { dataHora: { gte: agora, lte: limiteListagem } } },
        },
      },
    },
    include: {
      participacoes: { include: { usuario: true } },
      rodadas: {
        where: { status: 'ABERTA' },
        include: {
          jogos: {
            where: { dataHora: { gte: agora, lte: limiteListagem }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
            orderBy: { dataHora: 'asc' },
          },
          palpites: {
            select: { usuarioId: true, jogos: { select: { jogoId: true } } },
          },
        },
      },
    },
  });

  if (boloesComJogo.length === 0) return;

  // Pra cada user, agrega jogos das próximas 30h + computa o que já palpitou
  interface JogoComStatus {
    timeCasa: string;
    timeVisitante: string;
    dataHora: Date;
    palpitou: boolean;
  }
  interface Alvo {
    waId: string;
    nome: string;
    jogos: JogoComStatus[]; // sorted asc
  }
  const alvos = new Map<string, Alvo>();

  for (const bolao of boloesComJogo) {
    for (const rodada of bolao.rodadas) {
      const palpitouPorUser = new Map<string, Set<string>>();
      for (const p of rodada.palpites) {
        palpitouPorUser.set(p.usuarioId, new Set(p.jogos.map((pj) => pj.jogoId)));
      }
      for (const part of bolao.participacoes) {
        const waId = part.usuario.whatsappId;
        if (!waId) continue;
        const jaPalpitouEm = palpitouPorUser.get(part.usuarioId) ?? new Set<string>();
        const jogosDoUser: JogoComStatus[] = rodada.jogos.map((j) => ({
          timeCasa: j.timeCasa,
          timeVisitante: j.timeVisitante,
          dataHora: j.dataHora,
          palpitou: jaPalpitouEm.has(j.id),
        }));
        const existente = alvos.get(waId);
        if (existente) {
          existente.jogos.push(...jogosDoUser);
          existente.jogos.sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
        } else {
          alvos.set(waId, { waId, nome: part.usuario.nome, jogos: jogosDoUser });
        }
      }
    }
  }

  // Pra cada alvo, decide envio.
  for (const alvo of alvos.values()) {
    if (alvo.jogos.length === 0) continue;
    const proximo = alvo.jogos[0];
    const tAvisoBase = new Date(proximo.dataHora.getTime() - JANELA_PROXIMO_JOGO_HORAS * 3600_000);
    const tAviso = clampHorarioCivilizado(tAvisoBase, proximo.dataHora);

    // Está dentro da janela de 1h do envio (cron hourly)?
    const diff = agora.getTime() - tAviso.getTime();
    if (diff < 0 || diff >= 3600_000) continue;

    // Cross-job + cooldown 24h
    const flag = `aviso_jogo:${alvo.waId}`;
    const ja = await redis.get(flag);
    if (ja) continue;

    // v3.17.0 — cap absoluto de avisos/dia (defesa de profundidade)
    if (!(await podeEnviarAvisoHoje(alvo.waId))) continue;

    // Monta mensagem
    const header = headerPorHorario(agora);
    const linhas = alvo.jogos.slice(0, 10).map((j) => {
      const marcado = j.palpitou ? '✅' : '⚪';
      return `${marcado} ${formatarDataHoraCurtaBR(j.dataHora)} — ${j.timeCasa} x ${j.timeVisitante}`;
    });
    const faltaPalpitar = alvo.jogos.filter((j) => !j.palpitou).length;
    const footer = faltaPalpitar > 0
      ? `\n⚪ = falta palpitar (${faltaPalpitar}). Manda *próximos jogos* pra palpitar o que falta.`
      : `\n🎉 Você já palpitou em todos! Boa sorte!`;
    // v3.17.0 — fuso explícito (caso Camila 11/06: ela perguntou se 16:00 era BRT)
    const rodapeBrt = `\n\n_(horários em fuso de Brasília 🇧🇷)_`;

    const mensagem = `${header}\n\n${linhas.join('\n')}\n${footer}${rodapeBrt}`;

    try {
      await sendText({ to: alvo.waId, text: mensagem });
      await registrarAvisoEnviado(alvo.waId);
      // Flag cross-job: bloqueia outros avisos de jogo nas próximas 24h
      await redis.set(flag, '1', 'EX', 24 * 3600);
      console.log(
        `[bom-dia] waId=${alvo.waId} jogos=${alvo.jogos.length} proximo=${proximo.dataHora.toISOString()} pendentes=${faltaPalpitar}`,
      );
    } catch (error) {
      console.error(
        `[bom-dia] falha ao enviar pra ${alvo.waId} (${alvo.nome}):`,
        (error as Error).message,
      );
    }
  }
}

/**
 * v3.13.0 — clamp do horário de envio pra evitar mandar em hora ruim.
 * Se "kickoff - 6h" cair fora de [07:00, 22:00] BRT, ajusta:
 * - 22:00–23:59 BRT → manda às 22:00 do mesmo dia (ainda antes do jogo)
 * - 00:00–06:59 BRT → manda às 22:00 do dia anterior
 *
 * Se o ajuste cair depois do kickoff (jogo muito próximo), retorna o
 * cap (22:00 do dia que ainda dá tempo) — pode acabar não enviando
 * se cair fora da janela cron, mas garante zero msg de madrugada.
 */
function clampHorarioCivilizado(tBase: Date, kickoff: Date): Date {
  const horaBRT = parseInt(
    tBase.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }),
    10,
  );
  if (horaBRT >= HORA_MIN_BRT && horaBRT < HORA_MAX_BRT) return tBase;

  // Quer ir pra 22:00 BRT do dia mais próximo que ainda esteja ANTES do kickoff.
  const candidato = brasiliaHoraDoMesmoDia(tBase, HORA_MAX_BRT, 0);
  if (candidato.getTime() < kickoff.getTime()) return candidato;
  // Senão, dia anterior 22:00 BRT
  const anterior = new Date(candidato.getTime() - 24 * 3600_000);
  return anterior;
}

function brasiliaHoraDoMesmoDia(referencia: Date, horas: number, minutos: number): Date {
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
  const iso = `${ano}-${mes}-${dia}T${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:00-03:00`;
  return new Date(iso);
}

function headerPorHorario(agora: Date): string {
  const horaBRT = parseInt(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }),
    10,
  );
  if (horaBRT >= 7 && horaBRT < 12) return `☀️ *Bom dia!* Hoje rola Copa, ó:`;
  if (horaBRT >= 12 && horaBRT < 18) return `⚽ Tem Copa nas próximas horas, ó:`;
  return `🌙 *Boa noite!* Madrugada vai ter Copa — palpita ainda hoje:`;
}

// Mantém export pra compat (usado no formato `formatarHoraBR` em outros lugares)
void formatarHoraBR;
