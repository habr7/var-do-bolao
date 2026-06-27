import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { env } from '../config/env.js';
import { reservarCotaAviso, devolverCotaAviso } from '../utils/aviso-cap.js';
import { comLockJob } from '../utils/lock.js';
import { formatarHoraBR } from '../utils/datetime.js';
import { ehTimePlaceholder } from '../data/bracket-2026.js';

/**
 * v3.31.0 — Lembrete de ÚLTIMA HORA, por JOGO.
 *
 * Quando falta ~LEMBRETE_30MIN_ANTECEDENCIA_MIN (default 30) min pro kickoff
 * de um jogo, cutuca quem ainda NÃO palpitou AQUELE jogo. Substitui o
 * `send-reminders` (que era por-rodada e mais propenso a spam).
 *
 * Anti-spam em camadas (pedido explícito — caso Camila 11/06):
 *   1. Idempotência por (user, jogo): `lembrete30:{wa}:{jogoId}` TTL 2h →
 *      cada jogo cutuca a pessoa no máximo 1 vez.
 *   2. Cooldown por usuário: `lembrete30_cd:{wa}` (LEMBRETE_30MIN_COOLDOWN_MIN,
 *      default 90 min) → no máx. 1 lembrete-de-última-hora por janela.
 *   3. Coalescência: jogos do mesmo user na janela viram 1 mensagem.
 *   4. Cap diário compartilhado (MAX_AVISOS_DIA) via reserva atômica.
 *   5. NÃO honra a flag `aviso_jogo` (24h) de propósito — é um aviso de
 *      natureza distinta (última chance, por jogo); o cooldown próprio +
 *      o cap seguram o volume.
 *
 * Não mexe na sessão FSM (informativo).
 */
export async function sendLembrete30minJob(): Promise<void> {
  if (!env.ENABLE_LEMBRETE_30MIN) return;
  await comLockJob('send-lembrete-30min', sendLembrete30minInterno);
}

interface JogoFaltante {
  jogoId: string;
  label: string; // "Brasil x Marrocos — 19:00 (Bolão da Firma)"
}

async function sendLembrete30minInterno(): Promise<void> {
  const agora = new Date();
  const limite = new Date(agora.getTime() + env.LEMBRETE_30MIN_ANTECEDENCIA_MIN * 60_000);

  const jogosBrutos = await prisma.jogo.findMany({
    where: {
      status: 'AGENDADO',
      dataHora: { gt: agora, lte: limite },
    },
    include: {
      rodada: {
        include: {
          bolao: { include: { participacoes: { include: { usuario: true } } } },
        },
      },
      palpitesJogo: { include: { palpite: { select: { usuarioId: true } } } },
    },
  });
  // Mata-mata: não cutuca por jogo com time placeholder ("Vencedor 73").
  const jogos = jogosBrutos.filter(
    (j) => !ehTimePlaceholder(j.timeCasa) && !ehTimePlaceholder(j.timeVisitante),
  );
  if (jogos.length === 0) return;

  // Acumula, por usuário, os jogos da janela que ele AINDA NÃO palpitou.
  const porUsuario = new Map<string, { whatsappId: string; faltantes: JogoFaltante[] }>();

  for (const jogo of jogos) {
    const palpitaram = new Set(jogo.palpitesJogo.map((pj) => pj.palpite.usuarioId));
    const hora = formatarHoraBR(jogo.dataHora);
    const nomeBolao = jogo.rodada.bolao.nome;

    for (const part of jogo.rodada.bolao.participacoes) {
      if (palpitaram.has(part.usuarioId)) continue;
      const wa = part.usuario.whatsappId;
      if (!wa) continue;

      const acc = porUsuario.get(part.usuarioId) ?? { whatsappId: wa, faltantes: [] };
      acc.faltantes.push({
        jogoId: jogo.id,
        label: `*${jogo.timeCasa}* x *${jogo.timeVisitante}* — ${hora} _(${nomeBolao})_`,
      });
      porUsuario.set(part.usuarioId, acc);
    }
  }

  let enviados = 0;
  for (const { whatsappId, faltantes } of porUsuario.values()) {
    // Filtra jogos que já cutucaram esta pessoa (idempotência por jogo)
    const novos: JogoFaltante[] = [];
    for (const f of faltantes) {
      const ja = await redis.get(`lembrete30:${whatsappId}:${f.jogoId}`);
      if (!ja) novos.push(f);
    }
    if (novos.length === 0) continue;

    // Cooldown por usuário (anti-spam): no máx. 1 lembrete por janela.
    if (await redis.get(`lembrete30_cd:${whatsappId}`)) continue;

    // Cap diário compartilhado (reserva atômica)
    if (!(await reservarCotaAviso(whatsappId))) continue;

    const corpo =
      novos.length === 1
        ? `⏰ *Faltam ~${env.LEMBRETE_30MIN_ANTECEDENCIA_MIN} min* e você ainda não palpitou:\n\n${novos[0].label}\n\n` +
          `Manda o placar agora que ainda dá tempo! Ex: *${exemploPlacar(novos[0].label)}* ⚽`
        : `⏰ *Faltam ~${env.LEMBRETE_30MIN_ANTECEDENCIA_MIN} min* e você ainda não palpitou:\n\n` +
          `${novos.map((n) => `• ${n.label}`).join('\n')}\n\n` +
          `Manda os placares agora que ainda dá tempo! ⚽`;

    try {
      await sendText({ to: whatsappId, text: corpo });
      // marca cada jogo incluído (2h cobre o jogo + folga)
      for (const n of novos) {
        await redis.set(`lembrete30:${whatsappId}:${n.jogoId}`, '1', 'EX', 2 * 3600);
      }
      // cooldown por usuário
      if (env.LEMBRETE_30MIN_COOLDOWN_MIN > 0) {
        await redis.set(
          `lembrete30_cd:${whatsappId}`,
          '1',
          'EX',
          env.LEMBRETE_30MIN_COOLDOWN_MIN * 60,
        );
      }
      enviados++;
    } catch (error) {
      await devolverCotaAviso(whatsappId); // envio falhou — devolve a cota
      console.error(`[lembrete-30min] falha ao enviar pra ${whatsappId}:`, (error as Error).message);
    }
  }

  if (enviados > 0) {
    console.log(`[lembrete-30min] lembretes enviados: ${enviados}`);
  }
}

/** "*Brasil* x *Marrocos* — ..." → "Brasil 2x1 Marrocos" (exemplo de formato). */
function exemploPlacar(label: string): string {
  const m = label.match(/\*([^*]+)\* x \*([^*]+)\*/);
  if (!m) return 'Brasil 2x1 Marrocos';
  return `${m[1].trim()} 2x1 ${m[2].trim()}`;
}
