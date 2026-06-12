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
  // Provider de placares:
  //   "hybrid" (v3.22.0+, RECOMENDADO): FIFA (api.fifa.com, AO VIVO) primário
  //                  + openfootball como fallback automático se a FIFA cair.
  //   "openfootball": só JSON público openfootball/worldcup.json — sem API key,
  //                  latência ~30-60min, SEM placar ao vivo.
  //   "fifa-2026":   só api.fifa.com — AO VIVO; usa FIFA_SEASON_ID (default 285023).
  //   "mock":        3 jogos fixos pra dev local.
  FOOTBALL_PROVIDER: z.enum(['mock', 'fifa-2026', 'openfootball', 'hybrid']).default('hybrid'),
  // IdSeason da Copa na api.fifa.com. Default = FIFA World Cup 2026™ (285023),
  // confirmado em /api/v3/seasons?idCompetition=17. Override só se a FIFA mudar.
  FIFA_SEASON_ID: z.string().default('285023'),

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
  HORARIO_BOM_DIA: z.string().default('09:00'),
  // Quantas horas antes do 1o jogo do dia disparar a chamada de palpites.
  PALPITE_CALL_HORAS_ANTES: z.coerce.number().default(6),
  // v3.13.0 — flags pra desabilitar canais de comunicacao isoladamente
  // sem mexer em DRY_RUN_WHATSAPP (que afeta TODO envio). Util pra
  // staging onde queremos jobs rodando mas sem cutucar usuario.
  ENABLE_BOM_DIA: z.coerce.boolean().default(true),
  ENABLE_PALPITE_CALL: z.coerce.boolean().default(true),
  // v3.31.0 — DESATIVADO por padrão: o lembrete "faltam ~30 min e você não
  // palpitou ESTE jogo" (ENABLE_LEMBRETE_30MIN) substitui este, que era
  // por-rodada e mais propenso a spam. O aviso antecipado segue coberto por
  // bom-dia + chamada de palpites.
  ENABLE_REMINDERS: z.coerce.boolean().default(false),
  // v3.24.0 — revelação de palpites no kickoff (push automático).
  ENABLE_PALPITE_REVEAL: z.coerce.boolean().default(true),
  // v3.31.0 — lembrete de última hora POR JOGO: ~30 min antes do kickoff,
  // cutuca quem ainda não palpitou aquele jogo. Anti-spam: 1x por (user,
  // jogo) + cooldown por usuário + cap diário + coalescência por janela.
  ENABLE_LEMBRETE_30MIN: z.coerce.boolean().default(true),
  // Antecedência da janela (min). Default 30 (= "faltando 30 min").
  LEMBRETE_30MIN_ANTECEDENCIA_MIN: z.coerce.number().int().min(5).max(120).default(30),
  // Cooldown por usuário (min): no máx. 1 lembrete-de-última-hora por janela.
  LEMBRETE_30MIN_COOLDOWN_MIN: z.coerce.number().int().min(0).default(90),
  // v3.17.0 — cap absoluto de avisos por user por dia (cross-job).
  // Resolve o problema da Camila 11/06 (3 msgs em 3.5h) e protege custo
  // na futura migração Meta Cloud API.
  // v3.24.0 — subido de 2 → 8: a revelação de palpites no kickoff CONTA
  // neste cap, e em dia de fase de grupos há até ~4 jogos. 8 dá folga pra
  // bom-dia + chamada + as revelações do dia sem suprimir.
  MAX_AVISOS_DIA: z.coerce.number().int().min(0).default(8),
  // Numero do bot em formato amigavel ("+55 11 97827-7516") — usado nas
  // mensagens-convite que o admin encaminha pros convidados. Opcional;
  // se vazio, a mensagem usa "do VAR do Bolão" como fallback.
  WHATSAPP_BUSINESS_NUMBER: z.string().default(''),

  // v3.26.0 — Broadcast administrativo (aviso pra todos os usuários).
  // Só número(s) dono(s) (lista por vírgula, só dígitos) podem disparar.
  OWNER_WHATSAPP_IDS: z.string().default('5511976135412'),
  // Modo teste: quando TRUE, o broadcast envia SÓ pro próprio dono que
  // disparou (valida o fluxo com segurança). Trocar pra false só depois
  // de validar — e com EVOLUTION_WEBHOOK_TOKEN setado em produção.
  BROADCAST_TEST_MODE: z.preprocess(coerceBool, z.boolean()).default(true),
  // Marcador que abre o comando de broadcast (no início da mensagem).
  BROADCAST_MARKER: z.string().default('#ENVIOPARAVARDOBOLAO#'),
  // Delay (ms) entre envios no broadcast — protege contra ban/rate-limit.
  BROADCAST_THROTTLE_MS: z.coerce.number().int().min(0).default(1000),

  // LLM — opcional, melhora compreensao de linguagem natural quando o
  // parser regex falha. Se LLM_ENABLED=false, sistema continua funcional
  // usando so regex/keywords.
  //
  // PROVIDER: "gemini" (Google Gemini, default se GEMINI_API_KEY setada)
  //           "ollama" (Ollama Cloud, legado)
  // Se LLM_PROVIDER nao setado: auto-detecta (gemini se key, senao ollama).
  // O router em src/llm/llm.client.ts tenta gemini primeiro e cai pra
  // ollama em caso de falha.
  LLM_ENABLED: z.preprocess(coerceBool, z.boolean()).default(true),
  LLM_PROVIDER: z.enum(['gemini', 'ollama', 'auto']).default('auto'),
  // Bump 5s→8s (18/05): Gemini sob carga responde em 4-7s as vezes.
  // Timeout 5s causava abort precoce e null pro caller.
  LLM_TIMEOUT_MS: z.coerce.number().default(8000),

  // Gemini (Google AI Studio) — gratuito ate 1500 req/dia no flash.
  // Pega chave em https://aistudio.google.com/apikey
  GEMINI_API_KEY: z.string().default(''),
  // Modelo Gemini padrao: flash-lite (mais barato/rapido que o flash).
  // Suficiente pras tarefas do bot: classificacao de intent, extracao de
  // palpite, sim/nao, resposta conversacional curta.
  //
  // Para usar o flash regular (qualidade maior, mais lento), setar
  // GEMINI_MODEL=gemini-2.5-flash no .env.
  //
  // Nota: 'gemini-2.0-flash' foi descontinuado para keys novas em 05/2026
  // ("no longer available to new users"). Por isso 2.5+.
  GEMINI_MODEL: z.string().default('gemini-2.5-flash-lite'),

  // Ollama Cloud (legado) — usado como fallback quando Gemini falha,
  // ou principal se LLM_PROVIDER=ollama.
  LLM_URL: z.string().default('https://ollama.com'),
  LLM_API_KEY: z.string().default('dry-run-llm-key'),
  LLM_MODEL: z.string().default('gpt-oss:20b'),

  // Sprint 3 — historico de mensagens nao entendidas (LGPD)
  // Retencao em dias antes do job mensal limpar. Default 180 dias.
  MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS: z.coerce.number().default(180),
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
