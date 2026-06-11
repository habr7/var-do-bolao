import { prisma } from '../config/database.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { redis } from '../config/redis.js';
import { setSession, getSession } from '../whatsapp/session.manager.js';
import { podeEnviarAvisoHoje, registrarAvisoEnviado } from '../utils/aviso-cap.js';
import { env } from '../config/env.js';
import { chamadaPalpite } from '../utils/football.terms.js';

/**
 * Job de chamada de palpites. Roda toda hora (cron ":05 * * * *") e dispara
 * envio de palpites pra cada bolao quando faltam ~PALPITE_CALL_HORAS_ANTES
 * horas pro 1o jogo do dia.
 *
 * Logica:
 *   - Busca cada bolao ativo com rodada aberta + jogos hoje
 *   - Pega o 1o jogo do dia (ordenado por dataHora)
 *   - Calcula `horasAteJogo = (kickoff - now) / 3600`
 *   - Janela de envio: [PALPITE_CALL_HORAS_ANTES, PALPITE_CALL_HORAS_ANTES - 1]
 *     ou seja, dispara entre 5h e 6h antes do jogo (1h de janela).
 *   - Pra evitar acordar usuario antes das 09h: se a janela cair de
 *     madrugada, aguarda ate 09:00 do mesmo dia.
 *   - Idempotente: flag Redis `palpite-call:{bolaoId}:{YYYY-MM-DD}`.
 */
export async function sendPalpiteCallJob() {
  if (!env.ENABLE_PALPITE_CALL) return;
  const HORAS_ANTES = env.PALPITE_CALL_HORAS_ANTES;
  const HORARIO_MIN = 9; // nao envia antes das 09:00 da manha de Brasilia

  const agora = new Date();
  const fimAmanha = new Date(agora);
  fimAmanha.setHours(0, 0, 0, 0);
  fimAmanha.setDate(fimAmanha.getDate() + 2); // janela ampla pra pegar jogos da madrugada

  const rodadas = await prisma.rodada.findMany({
    where: {
      status: 'ABERTA',
      jogos: { some: { dataHora: { gte: agora, lte: fimAmanha } } },
    },
    include: {
      bolao: {
        include: {
          participacoes: { include: { usuario: true } },
        },
      },
      jogos: {
        where: { dataHora: { gte: agora } },
        orderBy: { dataHora: 'asc' },
      },
      palpites: { select: { usuarioId: true } },
    },
  });

  for (const rodada of rodadas) {
    const primeiroJogo = rodada.jogos[0];
    if (!primeiroJogo) continue;

    const horasAteJogo = (primeiroJogo.dataHora.getTime() - agora.getTime()) / 3600_000;
    if (horasAteJogo > HORAS_ANTES) continue; // ainda cedo
    if (horasAteJogo < 1) continue; // muito tarde, send-reminders cuida disso

    // Nao envia antes das 09:00 BRT (acordar usuario eh ruim)
    const horaBrasilia = parseInt(
      agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }),
      10,
    );
    if (horaBrasilia < HORARIO_MIN) continue;

    // Janela diaria: nao reenviar pro mesmo bolao no mesmo dia
    const dataKickoff = primeiroJogo.dataHora.toISOString().slice(0, 10);
    const flag = `palpite-call:${rodada.bolaoId}:${dataKickoff}`;
    const ja = await redis.get(flag);
    if (ja) continue;

    // Lista jogos a palpitar (todos os jogos da rodada que comecam ate 24h)
    const jogosParaPalpitar = rodada.jogos.slice(0, 12);
    if (jogosParaPalpitar.length === 0) continue;

    const formatHorario = (d: Date) =>
      d.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });

    const formatData = (d: Date) =>
      d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });

    const linhasJogos = jogosParaPalpitar.map((j) => {
      const data = formatData(j.dataHora);
      const hora = formatHorario(j.dataHora);
      return `• ${data} ${hora} — *${j.timeCasa}* x *${j.timeVisitante}*`;
    });

    const mensagem =
      `${chamadaPalpite()}\n\n` +
      `🏆 *${rodada.bolao.nome}* — Rodada ${rodada.numero}\n\n` +
      `${linhasJogos.join('\n')}\n\n` +
      `📝 Manda os palpites assim:\n` +
      `_Brasil 2x1 Marrocos_\n_Argentina 3x0 Argélia_\n\n` +
      `_(pode mandar tudo numa só mensagem ou em linguagem natural mesmo. Horários em fuso de Brasília 🇧🇷)_`;

    // So envia pra quem ainda nao palpitou nada nesta rodada
    const jaPalpitou = new Set(rodada.palpites.map((p) => p.usuarioId));
    const targets = rodada.bolao.participacoes.filter((p) => !jaPalpitou.has(p.usuarioId));

    let enviados = 0;
    for (const p of targets) {
      // v3.13.0 — cross-job: pula se já mandei aviso de jogo nas últimas 24h.
      // Flag compartilhada com send-bom-dia. Evita dupla notificação.
      const flagCross = `aviso_jogo:${p.usuario.whatsappId}`;
      if (await redis.get(flagCross)) continue;

      // v3.17.0 — cap absoluto de avisos/dia (defesa de profundidade)
      if (!(await podeEnviarAvisoHoje(p.usuario.whatsappId))) continue;

      // v3.15.0 — BUG: setSession incondicional ATROPELAVA sessão em
      // andamento. User no meio de criar bolão / confirmar palpites
      // perdia todo o contexto quando o job disparava. Agora só seta
      // PALPITANDO se o user está IDLE (sem fluxo em curso). Quem está
      // em outro fluxo ainda RECEBE a mensagem (não perde o aviso),
      // mas a sessão dele fica intacta — os palpites dele vão pelo
      // fluxo inline normal quando ele mandar.
      const sessaoAtual = await getSession(p.usuario.whatsappId);
      const podeSetarSessao = sessaoAtual.state === 'IDLE';
      try {
        if (podeSetarSessao) {
          await setSession(p.usuario.whatsappId, {
            state: 'PALPITANDO',
            ctx: {
              bolaoId: rodada.bolaoId,
              rodadaId: rodada.id,
              jogosPendentes: jogosParaPalpitar.map((j) => j.id),
            },
          });
        }
        await sendText({ to: p.usuario.whatsappId, text: mensagem });
        await registrarAvisoEnviado(p.usuario.whatsappId);
        await redis.set(flagCross, '1', 'EX', 24 * 3600);
        enviados++;
      } catch (error) {
        console.error(
          `[palpite-call] falha ao enviar pra ${p.usuario.whatsappId}:`,
          (error as Error).message,
        );
      }
    }

    if (enviados > 0) {
      await redis.set(flag, '1', 'EX', 30 * 3600); // 30h pra cobrir madrugada
    }
  }
}
