import cron from 'node-cron';
import { env } from '../config/env.js';
// PIX desativado nesta fase — bolao gratuito.
// import { validatePixJob } from './validate-pix.job.js';
import { fetchResultsJob } from './fetch-results.job.js';
import { calculateScoresJob } from './calculate-scores.job.js';
import { sendBomDiaJob } from './send-bom-dia.job.js';
import { sendPalpiteCallJob } from './send-palpite-call.job.js';
import { sendRemindersJob } from './send-reminders.job.js';
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

  // Lembrete palpite — a cada 30min
  cron.schedule('*/30 * * * *', wrap('send-reminders', sendRemindersJob));

  // Ranking personalizado — a cada hora
  cron.schedule('0 * * * *', wrap('send-ranking', sendRankingJob));

  // Bom dia boleiros — hourly. Decide internamente se eh a hora certa
  // (default HORARIO_BOM_DIA, ou kickoff-6h quando default cai depois de kickoff-8h).
  cron.schedule('0 * * * *', wrap('send-bom-dia', sendBomDiaJob), {
    timezone: env.TIMEZONE,
  });

  // Chamada de palpites — hourly, dispara PALPITE_CALL_HORAS_ANTES horas
  // antes do 1o jogo do dia (default 6h). Idempotente via flag em Redis.
  cron.schedule('5 * * * *', wrap('send-palpite-call', sendPalpiteCallJob), {
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
