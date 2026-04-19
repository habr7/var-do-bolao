import 'dotenv/config';
import { z } from 'zod';

/**
 * Modo dry-run da Meta Cloud API: quando ligado, o meta.client NAO faz
 * requisicoes HTTP para o Graph API — ele captura as mensagens "enviadas"
 * em memoria. Util pra testar o bot localmente via `npm run sim` antes de
 * ter token/phone_number_id reais.
 *
 * Ligado por default em dev se DRY_RUN_META nao for setado.
 */
function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === '1' || v.toLowerCase() === 'true';
  return false;
}

const baseSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6380/0'),

  // Flag: se TRUE, meta.client roda em modo fake (sem HTTP)
  DRY_RUN_META: z.preprocess(coerceBool, z.boolean()).default(false),

  // Meta WhatsApp Cloud API — em dry-run podem ter defaults
  WHATSAPP_ACCESS_TOKEN: z.string().default('dry-run-token'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default('dry-run-phone-id'),
  WHATSAPP_VERIFY_TOKEN: z.string().default('dry-run-verify'),
  WHATSAPP_APP_SECRET: z.string().default('dry-run-secret'),
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

export type Env = z.infer<typeof baseSchema>;

function loadEnv(): Env {
  const result = baseSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Variáveis de ambiente inválidas:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  const data = result.data;

  // Em producao, exige tokens reais da Meta (a menos que DRY_RUN_META esteja ligado)
  if (data.NODE_ENV === 'production' && !data.DRY_RUN_META) {
    const placeholders = ['dry-run-token', 'dry-run-phone-id', 'dry-run-verify', 'dry-run-secret'];
    const placeholderUsado =
      placeholders.includes(data.WHATSAPP_ACCESS_TOKEN) ||
      placeholders.includes(data.WHATSAPP_PHONE_NUMBER_ID) ||
      placeholders.includes(data.WHATSAPP_VERIFY_TOKEN) ||
      placeholders.includes(data.WHATSAPP_APP_SECRET);

    if (placeholderUsado) {
      console.error('❌ Em produção, defina WHATSAPP_ACCESS_TOKEN/PHONE_NUMBER_ID/VERIFY_TOKEN/APP_SECRET reais ou ative DRY_RUN_META=true explicitamente.');
      process.exit(1);
    }
  }

  return data;
}

export const env = loadEnv();
