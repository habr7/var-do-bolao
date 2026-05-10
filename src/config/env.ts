import 'dotenv/config';
import { z } from 'zod';

/**
 * Modo dry-run do cliente WhatsApp (Evolution API): quando ligado, o
 * evolution.client NAO faz requisicoes HTTP — captura as mensagens
 * "enviadas" em memoria. Util pra rodar `npm run sim` ou os testes
 * unitarios sem precisar da Evolution rodando.
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

  // Flag: se TRUE, evolution.client roda em modo fake (sem HTTP)
  DRY_RUN_WHATSAPP: z.preprocess(coerceBool, z.boolean()).default(false),

  // Evolution API — em dry-run podem ter defaults
  EVOLUTION_API_URL: z.string().default('http://localhost:8080'),
  EVOLUTION_API_KEY: z.string().default('dry-run-key'),
  EVOLUTION_INSTANCE: z.string().default('varbolao'),
  // Token opcional para validar requests do webhook (header x-evolution-token)
  EVOLUTION_WEBHOOK_TOKEN: z.string().default(''),

  // Futebol
  FOOTBALL_API_KEY: z.string().default('mock'),
  FOOTBALL_API_URL: z.string().default('https://www.api-futebol.com.br/v1'),
  // Provider: "mock" (3 jogos fixos) | "fifa-2026" (Copa do Mundo via JSON local + scraping)
  FOOTBALL_PROVIDER: z.enum(['mock', 'fifa-2026']).default('fifa-2026'),

  // PIX (DESATIVADO no momento — bolao gratuito ate ganhar escala)
  // Mantido apenas para nao quebrar o pagamento.service caso volte. Nao
  // ha cobranca acontecendo.
  PIX_PROVIDER: z.enum(['mock', 'mercadopago', 'gerencianet']).default('mock'),
  PIX_ACCESS_TOKEN: z.string().optional().default(''),
  PIX_CHAVE: z.string().default('contato@vardobolao.com.br'),
  PIX_VALOR_CENTAVOS: z.coerce.number().default(0),

  // Bot
  BOT_PREFIX: z.string().default('!'),
  TIMEZONE: z.string().default('America/Sao_Paulo'),
  DEFAULT_CAMPEONATO: z.string().default('copa-2026-fase-grupos'),
  HORARIO_ENVIO_JOGOS_DIA: z.string().default('09:00'),
});

export type Env = z.infer<typeof baseSchema>;

function loadEnv(): Env {
  const result = baseSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Variaveis de ambiente invalidas:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  const data = result.data;

  // Em producao, exige credenciais reais da Evolution (a menos que
  // DRY_RUN_WHATSAPP esteja ligado).
  if (data.NODE_ENV === 'production' && !data.DRY_RUN_WHATSAPP) {
    const placeholders = ['dry-run-key'];
    const placeholderUsado = placeholders.includes(data.EVOLUTION_API_KEY);

    if (placeholderUsado) {
      console.error(
        '❌ Em producao, defina EVOLUTION_API_KEY real ou ative DRY_RUN_WHATSAPP=true explicitamente.',
      );
      process.exit(1);
    }
  }

  return data;
}

export const env = loadEnv();
