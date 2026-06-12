import cron from 'node-cron';
import { env } from '../config/env.js';
// PIX desativado nesta fase — bolao gratuito.
// import { validatePixJob } from './validate-pix.job.js';
import { fetchResultsJob } from './fetch-results.job.js';
import { calculateScoresJob } from './calculate-scores.job.js';
import { sendBomDiaJob } from './send-bom-dia.job.js';
import { sendPalpiteCallJob } from './send-palpite-call.job.js';
import { sendRemindersJob } from './send-reminders.job.js';
import { sendLembrete30minJob } from './send-lembrete-30min.job.js';
import { revisaoDiariaJob } from './revisao-diaria.job.js';
import { sendPalpiteRevealJob } from './send-palpite-reveal.job.js';
import { sendRankingJob } from './send-ranking.job.js';
import { repararBoloesQuebrados } from './repair-broken-boloes.job.js';
import { limparMensagensAntigas } from './limpar-mensagens-antigas.job.js';

function wrap(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (error) {
      console.error(`[cron ${name}] erro:`, error);
    }
  };
}

export function registerJobs() {
  // PIX desativado:
  // cron.schedule('*/30 * * * * *', wrap('validate-pix', validatePixJob));

  // Resultados — a cada 5min
  cron.schedule('*/5 * * * *', wrap('fetch-results', fetchResultsJob));

  // Calculo — a cada 10min
  cron.schedule('*/10 * * * *', wrap('calculate-scores', calculateScoresJob));

  // Lembrete palpite por-rodada — a cada 30min. v3.31.0: DESATIVADO por
  // padrão (ENABLE_REMINDERS=false), substituído pelo lembrete de 30min por
  // jogo abaixo. Cron mantido pra re-ativação rápida via env, se preciso.
  cron.schedule('*/30 * * * *', wrap('send-reminders', sendRemindersJob));

  // v3.31.0 — Lembrete de última hora POR JOGO: ~30min antes do kickoff,
  // cutuca quem não palpitou aquele jogo. A cada 5min pra precisão do marco.
  cron.schedule('*/5 * * * *', wrap('send-lembrete-30min', sendLembrete30minJob));

  // Revelação de palpites no kickoff — a cada 2min. Quando um jogo começa,
  // manda pros integrantes os palpites de todos do bolão pra aquele jogo.
  // Time-driven (independe da FIFA); idempotente por (user, jogo) em Redis.
  cron.schedule('*/2 * * * *', wrap('send-palpite-reveal', sendPalpiteRevealJob));

  // Ranking personalizado — a cada hora
  cron.schedule('0 * * * *', wrap('send-ranking', sendRankingJob));

  // Bom dia boleiros — hourly; só dispara na HORA FIXA HORARIO_BOM_DIA
  // (default 09:00 BRT). v3.36.0: horário fixo + flag própria pra entrega
  // uniforme a TODOS de uma vez (antes era kickoff-6h e espalhava).
  cron.schedule('0 * * * *', wrap('send-bom-dia', sendBomDiaJob), {
    timezone: env.TIMEZONE,
  });

  // Chamada de palpites — hourly. v3.36.0: DESATIVADA por padrão
  // (ENABLE_PALPITE_CALL=false) — redundante com bom-dia (9h) + lembrete
  // de 30min. Cron mantido pra re-ativação rápida via env.
  cron.schedule('5 * * * *', wrap('send-palpite-call', sendPalpiteCallJob), {
    timezone: env.TIMEZONE,
  });

  // v3.32.0 — revisão diária das mensagens não-entendidas: 09:00 BRT manda
  // o relatório das últimas 24h pro(s) dono(s). Idempotente por dia (Redis).
  cron.schedule('0 9 * * *', wrap('revisao-diaria', revisaoDiariaJob), {
    timezone: env.TIMEZONE,
  });

  // HOTFIX 17/05: reparo de boloes quebrados (rodada vazia ou sem rodada).
  // Roda 1x no boot pra limpar o legado existente, depois 1x/dia as 03:00
  // como defensivo (caso futuras falhas reintroduzam o estado).
  repararBoloesQuebrados().catch((e) =>
    console.error('[cron repair-broken-boloes] reparo inicial falhou:', e),
  );
  cron.schedule(
    '0 3 * * *',
    wrap('repair-broken-boloes', async () => {
      await repararBoloesQuebrados();
    }),
    { timezone: env.TIMEZONE },
  );

  // Sprint 3 — limpeza mensal de mensagens nao entendidas (LGPD).
  // Dia 1 de cada mes as 05:00. Deleta registros mais antigos que
  // MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS (default 180).
  cron.schedule(
    '0 5 1 * *',
    wrap('limpar-mensagens-antigas', async () => {
      await limparMensagensAntigas();
    }),
    { timezone: env.TIMEZONE },
  );

  console.log('⏰ Jobs registrados');
}
