import { Redis } from 'ioredis';
import { env } from './env.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times: number) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on('connect', () => {
  console.log('✅ Redis conectado');
});

redis.on('error', (error: Error) => {
  console.error('❌ Erro no Redis:', error.message);
});

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
  console.log('🔌 Redis desconectado');
}
