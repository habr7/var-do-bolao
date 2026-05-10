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

  console.log('⏰ Jobs registrados');
}
