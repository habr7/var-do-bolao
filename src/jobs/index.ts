import cron from 'node-cron';
import { env } from '../config/env.js';
// PIX desativado nesta fase — bolao gratuito.
// import { validatePixJob } from './validate-pix.job.js';
import { fetchResultsJob } from './fetch-results.job.js';
import { calculateScoresJob } from './calculate-scores.job.js';
import { sendDailyGamesJob } from './send-daily-games.job.js';
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

  // Ranking — a cada hora
  cron.schedule('0 * * * *', wrap('send-ranking', sendRankingJob));

  // Jogos do dia — conforme env.HORARIO_ENVIO_JOGOS_DIA (HH:MM)
  const [h, m] = env.HORARIO_ENVIO_JOGOS_DIA.split(':');
  cron.schedule(`${m} ${h} * * *`, wrap('send-daily-games', sendDailyGamesJob), {
    timezone: env.TIMEZONE,
  });

  console.log('⏰ Jobs registrados');
}
