import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6380/0'),

  // Meta WhatsApp Cloud API
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),
  WHATSAPP_API_VERSION: z.string().default('v18.0'),

  // Futebol
  FOOTBALL_API_KEY: z.string().default('mock'),
  FOOTBALL_API_URL: z.string().default('https://www.api-futebol.com.br/v1'),

  // PIX
  PIX_PROVIDER: z.enum(['mock', 'mercadopago', 'gerencianet']).default('mock'),
  PIX_ACCESS_TOKEN: z.string().optional().default(''),
  PIX_CHAVE: z.string().default('varbolao@exemplo.com'),
  PIX_VALOR_CENTAVOS: z.coerce.number().default(9990),

  // Bot
  BOT_PREFIX: z.string().default('!'),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
  DEFAULT_CAMPEONATO: z.string().default('brasileirao-serie-a'),
  HORARIO_ENVIO_JOGOS_DIA: z.string().default('09:00'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  return result.data;
}

export const env = loadEnv();
