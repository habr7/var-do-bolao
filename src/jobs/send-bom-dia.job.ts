import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';
import { formatarDataHoraCurtaBR } from '../utils/datetime.js';
import { reservarCotaAviso, devolverCotaAviso } from '../utils/aviso-cap.js';

/**
 * Job "bom dia boleiros" — v3.36.0 reescrito (caso real 12/06: jogo cedo
 * fazia o aviso "kickoff-6h" cair 22h da véspera e só PARTE do pessoal
 * recebia; o resto ficava sem heads-up até o kickoff).
 *
 * Roda HOURLY, mas só dispara na HORA FIXA `HORARIO_BOM_DIA` (default
 * 09:00 BRT) — entrega uniforme a TODOS de uma vez, em vez de espalhar
 * por "kickoff-6h de cada um".
 *
 * Pra cada usuário com jogo nas próximas ~30h (cobre os de madrugada
 * seguinte), manda 1 mensagem listando os jogos com ✅ palpitado /
 * ⚪ pendente. Conteúdo adaptativo:
 *   - falta palpitar → lembra ("manda *próximos jogos*")
 *   - palpitou tudo  → "🎉 já palpitou em todos! Boa sorte!"
 *
 * Guardas:
 *   1. **Hora fixa**: só na hora de `HORARIO_BOM_DIA` (BRT).
 *   2. **Idempotência diária PRÓPRIA**: flag `bomdia:{waId}:{YYYY-MM-DD}`
 *      (SET NX) — 1 por usuário por dia, SEM dividir trava com outros jobs
 *      (era o que causava a entrega desigual).
 *   3. **Cap diário** `MAX_AVISOS_DIA` (reserva atômica; devolve em falha).
 */

const JANELA_LISTAGEM_HORAS = 30; // lista todos os jogos nas próximas N horas

export async function sendBomDiaJob() {
  if (!env.ENABLE_BOM_DIA) return;

  const agora = new Date();
  const horaBRT = parseInt(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }),
    10,
  );
  const horaAlvo = parseInt((env.HORARIO_BOM_DIA || '09:00').split(':')[0], 10) || 9;
  if (horaBRT !== horaAlvo) return; // só dispara na hora do bom-dia

  const diaBRT = agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
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

    // v3.36.0 — idempotência diária PRÓPRIA (não divide trava com outros
    // jobs). SET NX = 1 envio por usuário por dia.
    const flag = `bomdia:${alvo.waId}:${diaBRT}`;
    const claimed = await redis.set(flag, '1', 'EX', 20 * 3600, 'NX');
    if (claimed !== 'OK') continue;

    // v3.28.0 — cap absoluto de avisos/dia, reserva ATÔMICA (corrige TOCTOU)
    if (!(await reservarCotaAviso(alvo.waId))) {
      await redis.del(flag); // não enviou → libera a flag do dia
      continue;
    }

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
      console.log(
        `[bom-dia] waId=${alvo.waId} jogos=${alvo.jogos.length} pendentes=${faltaPalpitar}`,
      );
    } catch (error) {
      await devolverCotaAviso(alvo.waId); // envio falhou — devolve a cota
      await redis.del(flag); // libera a flag do dia (não enviou)
      console.error(
        `[bom-dia] falha ao enviar pra ${alvo.waId} (${alvo.nome}):`,
        (error as Error).message,
      );
    }
  }
}

function headerPorHorario(agora: Date): string {
  const horaBRT = parseInt(
    agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }),
    10,
  );
  if (horaBRT >= 5 && horaBRT < 12) return `☀️ *Bom dia, boleiros!* Hoje rola Copa, ó:`;
  if (horaBRT >= 12 && horaBRT < 18) return `⚽ *Boleiros!* Tem Copa nas próximas horas, ó:`;
  return `🌙 *Boa noite, boleiros!* Vem Copa — palpita aí:`;
}
