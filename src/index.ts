import Fastify from 'fastify';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { disconnectRedis } from './config/redis.js';
import { webhookVerifyHandler, webhookMessageHandler } from './whatsapp/webhook.handler.js';
import { registerJobs } from './jobs/index.js';
import { APP_VERSION } from './version.js';

async function buildApp() {
  const app = Fastify({
    logger: env.NODE_ENV === 'development' ? { level: 'info' } : { level: 'warn' },
  });

  // Preserva o raw body para validacao HMAC do webhook da Meta
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      // salva raw pra usar no signature check
      (req as unknown as { rawBody: string }).rawBody = body as string;
      done(null, body ? JSON.parse(body as string) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Meta WhatsApp Cloud API webhook
  app.get('/webhook/whatsapp', webhookVerifyHandler);
  app.post('/webhook/whatsapp', webhookMessageHandler);

  return app;
}

async function start() {
  const app = await buildApp();

  try {
    await connectDatabase();
    registerJobs();

    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    console.log(`[boot] ⚽ VAR do Bolão v${APP_VERSION} (${env.NODE_ENV}) rodando na porta ${env.PORT}`);
    console.log(`📨 Webhook WhatsApp: ${env.APP_URL}/webhook/whatsapp`);
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }

  const shutdown = async () => {
    console.log('\n🛑 Encerrando VAR do Bolão...');
    await app.close();
    await disconnectDatabase();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
