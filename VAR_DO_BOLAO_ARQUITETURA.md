# VAR do Bolão — Arquitetura Técnica

> Bot de WhatsApp para bolão de futebol que opera em **conversa direta** (DM) com
> cada usuário. Não depende de grupos. Sistema é DM-only e híbrido **regex → LLM**
> para entender mensagens em português coloquial.

**Versão do documento:** 3.3
**Última atualização:** 2026-05-18 (Fase 2+3 do site: Web API no bot + área logada com OTP, sessão HMAC, dashboard real)
**Integração WhatsApp:** Evolution API v2.x (fork `evoapicloud`, com Baileys override)
**LLM:** Google Gemini (`gemini-2.5-flash-lite`) com fallback pra Ollama Cloud

> Documento canônico de arquitetura. Sempre que houver mudança estrutural,
> nova intent, novo state FSM, novo job, novo módulo ou nova integração,
> atualizar AQUI antes do PR — ver `.claude/skills/manter-docs-atualizada/SKILL.md`.

---

## 1. Visão geral do produto

### 1.1 O que é

O usuário adiciona o número do bot como contato no WhatsApp. Toda interação
acontece nessa conversa individual (DM). O bot é o único ponto de contato:

- **Criador do bolão** (admin): conversa com o bot, escolhe nome e senha,
  ganha um *ID curto* (formato `#K3MZ8P`) + um *link wa.me* clicável pra
  encaminhar pra galera.
  > PIX está **desativado** nesta fase — bolão criado **de graça** pra
  > ganhar tração. Schema do `Pagamento` continua mas o fluxo pula a cobrança.

- **Participante**: clica no link de convite (ou manda o ID `#XXX` em DM
  pro bot). O bot encaminha pedido pro admin via DM. Admin aprova/recusa
  em linguagem natural (`aprovar Fulano`, `recusar todos`).

- **Palpites**: o bot pode mandar uma "chamada de palpites" automaticamente
  N horas antes do primeiro jogo do dia OU o usuário pode mandar palpites
  inline a qualquer momento (`Brasil 2x1 Marrocos`). Suporta multi-palpite
  em linguagem natural ("Brasil perde de 1 a 0 do Marrocos") via LLM.

- **Ranking**: calculado e enviado de hora em hora durante a Copa.

### 1.2 Por que DM (e não grupo)

1. **Privacidade dos palpites** — cada um palpita sem ver o dos outros
2. **Escala/custo** — DMs iniciadas pelo usuário cabem na janela de 24h da
   WhatsApp Business API; em grupos cada mensagem viraria template pago
3. **UX guiada por FSM** — máquina de estados por usuário permite fluxos
   de criação / entrada / palpite multi-turno
4. **Aprovação de admin direta** — admin recebe pedido em DM, responde sim/não

### 1.3 Fluxos principais (resumo)

```
[criar bolão]
  usuário → bot: "criar bolão"
  bot: "qual o nome?"               ← state CRIANDO_BOLAO_NOME
  usuário: "Firma FC"
  bot: "defina uma senha"           ← state CRIANDO_BOLAO_SENHA
  usuário: "cerveja123"
  bot: cria bolão + ID #ABC123 + link wa.me clicável

[entrar em bolão — caminho rápido com link wa.me]
  convidado clica no link → WhatsApp abre conversa com bot já preenchida
  convidado manda → bot extrai #ABC123, cria SolicitacaoEntrada PENDENTE
  bot → admin (DM): "Fulano quer entrar. Aprovar?"
  admin: "aprovado Fulano"            (linguagem natural)
  bot → Fulano: "aprovado! bem-vindo ao bolão"

[entrar em bolão — manual]
  usuário → bot: "entrar em bolão"
  bot: "manda o ID ou o nome"        ← state ENTRANDO_NOME
  usuário: "Firma FC"                (ou "#ABC123")
  bot: busca → 1 match → cria solicitação (sem senha)
       │ 0 matches → conta tentativa (até 3) e pede de novo
       │ >1 matches → lista numerada (ESCOLHENDO_BOLAO_PARA_ENTRAR)

[palpite inline em IDLE]
  usuário → bot: "Brasil 2x1 Marrocos"
  bot detecta bolões com rodada aberta:
    1 bolão  → vai pra confirmação direto
    >1 bolão → "qual bolão?" (ESCOLHENDO_BOLAO_PARA_PALPITAR)
  bot mostra preview + "Confirma? sim/não/refazer"
                                     ← state CONFIRMANDO_PALPITES_INLINE
  usuário: "sim"
  bot: registra todos os palpites

[ranking / meus pontos / meus palpites]
  usuário → bot: "ranking"
  bot: se >1 bolão, pergunta qual (ESCOLHENDO_BOLAO_RANKING)
       se 1 bolão, manda direto
```

---

## 2. Stack

| Camada | Tecnologia | Observação |
|--------|------------|-------------|
| Runtime | Node.js 20 LTS + TypeScript 5 | ESM, strict mode |
| HTTP server | Fastify 5 | Recebe webhook da Evolution |
| Banco | PostgreSQL 16 | Via Docker em dev (porta 5433) |
| ORM | Prisma 6 | Migrations versionadas |
| Cache / FSM | Redis 7 | Estado FSM (`session:*`) + janela palpite livre + métricas |
| Scheduler | `node-cron` | Jobs de resultados, ranking, bom-dia, palpite-call, lembretes |
| WhatsApp | **Evolution API v2.x** (fork `evoapicloud`) | Baileys override pra acompanhar versão WhatsApp Web |
| LLM | **Google Gemini** (`gemini-2.5-flash-lite`) | Fallback: Ollama Cloud. Thinking sempre desabilitado |
| Pagamento (legado) | Schema PIX presente mas **desativado** | bolão gratuito nesta fase |
| Imagens | `sharp` + SVG | Cards de ranking/resultados (em `src/image/`) |
| Testes | Vitest | Unit + simulação determinística (`scripts/simulate-conversation.ts`) |
| Containers | Docker Compose | Postgres + Redis + Evolution; app roda no host em dev |

---

## 3. Diagrama de alto nível

```
                          ┌────────────────────────────────┐
                          │  WhatsApp (telefone do usuário) │
                          └──────────────┬─────────────────┘
                                         │
                                         ▼
                          ┌────────────────────────────────┐
                          │  Evolution API v2.x            │
                          │  (Docker, porta 8080,          │
                          │   instância "varbolao")        │
                          └──────────────┬─────────────────┘
                                         │ webhook POST {APP_URL}/webhook/whatsapp
                                         │ event=messages.upsert
                                         ▼
     ┌──────────────────┐       ┌─────────────────────────────────┐       ┌────────────┐
     │ Gemini API       │◀──────│  VAR do Bolão (Fastify)         │──────▶│ PostgreSQL │
     │ (Google AI)      │       │  ─ /webhook/whatsapp            │       │ via Prisma │
     └──────────────────┘       │  ─ /health                      │       └────────────┘
     ┌──────────────────┐       │  ─ Jobs (cron):                 │
     │ Ollama Cloud     │◀──────│      • fetch-results            │       ┌────────────┐
     │ (fallback)       │       │      • calculate-scores         │──────▶│ Redis 7    │
     └──────────────────┘       │      • send-bom-dia             │       │ (FSM,      │
                                │      • send-palpite-call        │       │  janela,   │
                                │      • send-reminders           │       │  métricas) │
                                │      • send-ranking             │       └────────────┘
                                │  ─ FSM de conversa (por waId)   │
                                │  ─ Pipeline: regex → LLM        │
                                └────────────┬────────────────────┘
                                             │
                                             ▼
                                ┌────────────────────────────┐
                                │ FIFA 2026 data provider    │
                                │ (JSON local + scraping)    │
                                └────────────────────────────┘
```

---

## 4. Estrutura de pastas

```
var_do_bolao/
├── prisma/
│   ├── schema.prisma                # Usuario, Bolao(codigo, senhaHash),
│   │                                  Pagamento, SolicitacaoEntrada,
│   │                                  Participacao, Rodada, Jogo,
│   │                                  Palpite, PalpiteJogo
│   └── migrations/                  # versionadas (inclui bolao.codigo)
│
├── src/
│   ├── index.ts                     # bootstrap Fastify + registerJobs + healthcheck
│   ├── config/
│   │   ├── env.ts                   # Zod-validated env (dotenv/config)
│   │   ├── database.ts              # PrismaClient singleton
│   │   └── redis.ts                 # ioredis singleton
│   │
│   ├── whatsapp/
│   │   ├── webhook.handler.ts       # GET + POST /webhook/whatsapp (Evolution v2)
│   │   ├── evolution.client.ts      # Cliente HTTP Evolution (sendText, markAsRead)
│   │   ├── message.parser.ts        # Camada 1 regex/keywords (Intencao enum)
│   │   ├── admin.parser.ts          # Detecta ações admin (aprovar/recusar/lote)
│   │   ├── session.manager.ts       # FSM por waId (Redis) + janela palpite livre
│   │   ├── command.router.ts        # Roteador principal — FSM dispatcher
│   │   ├── lista.helper.ts          # Numeração + parseEscolhaBolao
│   │   ├── convite.helper.ts        # Renderização do convite com link wa.me
│   │   └── regras.text.ts           # Texto canônico das regras de pontuação
│   │
│   ├── llm/                         # Camada 2 — fallback inteligente
│   │   ├── llm.client.ts            # Router Gemini/Ollama (tryParseJson incluído)
│   │   ├── gemini.client.ts         # Cliente Google Gemini (thinking off sempre)
│   │   ├── ollama.client.ts         # Fallback (Ollama Cloud)
│   │   ├── system-prompts.ts        # BASE_CONTEXT + 4 prompts especializados
│   │   ├── intent.classifier.ts     # Classifica mensagem em Intencao (JSON)
│   │   ├── palpite.extractor.ts     # Extrai placares de NL ("Brasil perde de 1 a 0")
│   │   ├── bolao.matcher.ts         # Escolhe bolão da lista + interpretar sim/nao
│   │   └── conversational.responder.ts  # Smart-fallback (resposta livre, sem inventar)
│   │
│   ├── modules/                     # Lógica de negócio (Repository + Service)
│   │   ├── bolao/
│   │   │   ├── bolao.types.ts
│   │   │   ├── bolao.repository.ts  # listarBoloesAtivos vs listarBoloesComHistorico (split p/ consultas)
│   │   │   └── bolao.service.ts     # criar (atômico/transacional), buscarPorNomeFuzzy, excluir (soft), renomear, remover participante, bolão padrão
│   │   ├── pagamento/               # PIX (desativado — schema presente, fluxo skip)
│   │   ├── solicitacao/             # PENDENTE → APROVADA/RECUSADA
│   │   ├── rodada/
│   │   ├── palpite/                 # registrarPalpiteEmRodada + status
│   │   ├── ranking/
│   │   │   ├── ranking.types.ts     # PONTUACAO_PADRAO (10/7/5/3/0)
│   │   │   └── pontuacao.calc.ts    # função pura — testada isolada
│   │   ├── resultado/               # adapter FIFA + fetcher
│   │   └── notificacao/
│   │
│   ├── jobs/
│   │   ├── index.ts                 # registerJobs() — agenda crons
│   │   ├── fetch-results.job.ts     # */5min — puxa placares
│   │   ├── calculate-scores.job.ts  # */10min — calcula pontos
│   │   ├── send-bom-dia.job.ts      # 0 * * * * — saudação nos dias com jogo
│   │   ├── send-palpite-call.job.ts # 5 * * * * — chamada N horas antes do 1o jogo
│   │   ├── send-reminders.job.ts    # */30min — cutuca quem não palpitou
│   │   ├── send-ranking.job.ts      # 0 * * * * — ranking hourly
│   │   ├── repair-broken-boloes.job.ts # boot + 0 3 * * * — repara bolões sem rodada/vazia
│   │   └── validate-pix.job.ts      # (comentado — PIX desativado)
│   │
│   ├── image/
│   │   ├── ranking.card.ts
│   │   └── result.card.ts
│   │
│   ├── data/                        # JSON local da Copa FIFA 2026
│   │
│   ├── types/global.d.ts
│   │
│   └── utils/
│       ├── football.terms.ts        # confirmacao(), naoEntendi(), emojis
│       ├── formatting.ts            # formatAjuda, formatRanking
│       ├── validators.ts            # placar, normalizeTeamName
│       ├── password.ts              # bcrypt hash + compare (legado, sem uso ativo)
│       ├── bolao-codigo.ts          # gerar + extrair códigos curtos
│       └── metrics.ts               # contadores diários em Redis (ISSUE-008)
│
├── scripts/
│   ├── sim.ts                       # REPL local (npm run sim)
│   ├── simulate-conversation.ts     # 55+ cenários determinísticos
│   ├── seed-fifa-2026.ts            # Popula Rodada+Jogos da Copa
│   ├── test-gemini.ts               # Smoke test do Gemini real
│   └── init-evolution-db.sh         # Cria DB "evolution" no boot do Postgres
│
├── tests/unit/                      # Vitest — 280+ tests
│
├── docs/
│   ├── commands.md                  # Comandos do bot
│   └── TESTING.md                   # Estratégia de testes (3 camadas)
│
├── .claude/skills/
│   └── manter-docs-atualizada/      # Skill que dispara update da doc
│       └── SKILL.md
│
├── docker-compose.yml               # postgres + redis + evolution (+app profile=full)
├── Dockerfile
├── .env.example
├── package.json
└── VAR_DO_BOLAO_ARQUITETURA.md      # este arquivo
```

---

## 5. Pipeline de processamento de mensagem

Toda mensagem entrante passa por este pipeline (em `command.router.ts:handleIncomingMessage`):

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 0. getOrCreateUsuario (DB) + getSession (Redis) + parseIntencao (regex) │
│    → mede timing por etapa em log [timing]                              │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────────┐
            ▼                     ▼                         ▼
┌────────────────────┐  ┌──────────────────────┐  ┌───────────────────────┐
│ 1. Intent=CANCELAR │  │ 2. Fast-path código  │  │ 3. FSM escape #1      │
│    reset + menu    │  │    extrairCodigoBolao│  │    admin com pendentes│
└────────────────────┘  │    (em quase todos os│  │    + ação admin       │
                        │    estados, exceto   │  │    em estado stale    │
                        │    destrutivos)      │  │    → reseta + reroteia│
                        └──────────────────────┘  └───────────────────────┘
                                  │
                                  ▼
                ┌──────────────────────────────────────┐
                │ 4. FSM escape #2 (sync, sem DB)      │
                │    estado "leitura/escolha" + intent │
                │    forte (RANKING, CRIAR_BOLAO…) →   │
                │    reset + reroteia                  │
                └──────────────────────────────────────┘
                                  │
                                  ▼
        ┌────────────────────────────────────────────────────┐
        │ 5. Switch por state (CRIANDO_*, ENTRANDO_*, etc.)  │
        │    Handlers específicos por state. Se não bater,   │
        │    cai pra IDLE (próximo passo).                   │
        └────────────────────────────────────────────────────┘
                                  │
                                  ▼
                ┌──────────────────────────────────────┐
                │ 6. IDLE: tentarAcaoAdminEmIdle       │
                │    (só se intent não cede + texto    │
                │    parece ação admin + tem pendentes)│
                └──────────────────────────────────────┘
                                  │
                                  ▼
                ┌──────────────────────────────────────┐
                │ 7. IDLE: dispatchIntencao(regex)     │
                │    Se casou intent regex → handler   │
                └──────────────────────────────────────┘
                                  │ não casou
                                  ▼
                ┌──────────────────────────────────────┐
                │ 8. IDLE: classificarIntencao (LLM)   │
                │    Camada 2 — Gemini classifica em   │
                │    19 intents. Threshold 0.55.       │
                └──────────────────────────────────────┘
                                  │ ainda sem intent
                                  ▼
                ┌──────────────────────────────────────┐
                │ 9. IDLE: responderConversacional     │
                │    Camada 3 — Smart fallback Gemini  │
                │    resposta curta sem inventar dados │
                └──────────────────────────────────────┘
                                  │ tudo falhou
                                  ▼
                ┌──────────────────────────────────────┐
                │ 10. naoEntendi() + menuTexto()       │
                │     + metrics.registrarMsgNaoEntendi │
                └──────────────────────────────────────┘
```

**Otimização para mensagens simples:** se a intent regex bater (passo 7), o
LLM nunca é chamado. "oi", "ranking", "regras", etc. resolvem em <100ms sem
custo. Métrica `[timing]` logada em todas as mensagens para diagnóstico.

---

## 6. Camada LLM (Gemini)

### 6.1 Por que LLM

Português coloquial, gírias, erros de digitação e variações regionais
quebram regex constantemente. O LLM cobre os 10-20% de mensagens que
o regex não pega.

### 6.2 Provedor + modelo

- **Default**: Google Gemini (`gemini-2.5-flash-lite`) via Generative Language API v1beta
- **Fallback**: Ollama Cloud (`gpt-oss:20b`)
- **Router**: `src/llm/llm.client.ts:chat()` — tenta Gemini primeiro, cai pra Ollama em falha
- **Thinking sempre off** (`thinkingConfig.thinkingBudget: 0`) — economiza ~1s de latência e tokens

### 6.3 Os 4 callers (em `src/llm/`)

| Caller | Quando dispara | System prompt |
|--------|---------------|---------------|
| `intent.classifier.classificarIntencao` | regex falhou (camada 2) | `INTENT_CLASSIFIER_PROMPT` — escolhe 1 de 19 intents, threshold 0.55 |
| `palpite.extractor.extrairPalpites` | janela de palpite livre OR multi-palpite OR fluxo de palpite com texto NL | `PALPITE_EXTRACTOR_PROMPT` — entende "perde de", "ganha por", "empate em N" |
| `bolao.matcher.escolherBolaoDaLista` | usuário responde escolha de bolão em texto livre ("o da firma") | `BOLAO_MATCHER_PROMPT` — primeiro tenta `parseEscolhaBolao` (índice/código/fuzzy), só cai no LLM se nada bater |
| `bolao.matcher.interpretarSimNao` | confirmações sim/não em estados CONFIRMANDO_* | `SIM_NAO_PROMPT` |
| `conversational.responder.responderConversacional` | tudo falhou — última tentativa antes do "não entendi" | Smart fallback: PT-BR curto, redireciona pros comandos certos, NUNCA inventa dados |

### 6.4 System prompts (centralizados em `system-prompts.ts`)

- `BASE_CONTEXT` — quem é o bot, regras de pontuação resumidas, regras de "não inventar"
- 4 prompts especializados compõem com BASE_CONTEXT

Tunar em um lugar só.

### 6.5 Telemetria de LLM

Cada chamada do Gemini loga `[llm] provider=gemini model=... latency=Xms ok`.
Janela de cota: `LLM_TIMEOUT_MS` (default 8000). Em timeout/HTTP-error, retorna
`null` e caller decide fallback.

Contadores em Redis (via `src/utils/metrics.ts`):

| Métrica | Quando incrementa |
|---------|-------------------|
| `msg.total` | toda mensagem entrante |
| `intent.<NOME>` | regex casou esta intent na camada 1 |
| `llm.intent.classifier.{hit,miss}` | LLM classificador acertou/não |
| `llm.conversational.{hit,miss}` | LLM smart fallback respondeu/não |
| `msg.nao_entendi` | caiu no "não entendi" final |

Amostras de mensagens não roteadas em `metrics:YYYY-MM-DD:nao-entendi` (lista,
top 500, TTL 30 dias).

---

## 7. Intents (`src/whatsapp/message.parser.ts`)

| Intent | Padrões regex principais | Handler |
|--------|--------------------------|---------|
| `SAUDACAO` | "oi", "ola", "salve", "bom dia", "e ai"… | mostra menu de boas-vindas |
| `MENU` | "menu", "inicio", "voltar"… | idem |
| `AJUDA` | "ajuda", "help", "?", "como funciona" (genérico) | `formatAjuda()` |
| `CRIAR_BOLAO` | "criar bolão", "abrir bolão", "novo bolão"… | inicia FSM `CRIANDO_BOLAO_NOME` |
| `ENTRAR_BOLAO` | "entrar em bolão", "quero participar"… | inicia FSM `ENTRANDO_NOME` |
| `MEUS_BOLOES` | "meus bolões", "onde participo"… | lista bolões com 👑 admin |
| `RANKING` | "ranking", "tabela", "quem ta na frente" | hourly ranking do bolão |
| `MEUS_PONTOS` | "meus pontos", "minha pontuação" | mostra pontos + pergunta se quer ver palpites |
| `MEU_PALPITE` | "meus palpites", "o que palpitei" | mostra histórico (após confirmação) |
| `JOGOS_HOJE` | "jogos hoje", "agenda" | jogos do dia |
| `PROXIMOS_JOGOS` | "próximos jogos", "quero palpitar", "bora dar palpites" | lista jogos abertos + abre janela palpite livre |
| `PALPITE_INLINE` | "Brasil 2x1 Marrocos" e variantes (extenso, preposição, "perde de") | fluxo de confirmação inline |
| `ABRIR_RODADA` | "abrir rodada", "começar bolão" | status das rodadas do admin |
| `COMO_CONVIDAR` | "como convido", "manda o convite" | gera link wa.me clicável |
| `SAIR_BOLAO` | "sair do bolão", "me remove" | confirmação + remove participação |
| `QUEM_PARTICIPA` | "quem participa", "lista do bolão" | participantes |
| `REGRAS` | "regras", "como pontua", "como funciona a pontuação" | `regrasTexto()` |
| `PALPITES_AMBIGUO` | "palpites" (sozinho) | pergunta entre 3 opções (ver/fazer/regras) |
| `INFO_SENHA` | "qual a senha", "esqueci a senha" | explica que bolão usa ID, não senha (ISSUE-005) |
| `EXCLUIR_BOLAO` | "excluir bolão", "encerrar bolão", "deletar" (admin) | fluxo de exclusão com confirmação textual (ISSUE-006) |
| `INFO_PRODUTO` | "o que é esse bot", "pra que serve", "sobre o var" | pitch curto sem LLM (ISSUE-009) |
| `INFO_PRECO` | "quanto custa", "é grátis", "tem que pagar" | "🆓 É grátis" (ISSUE-010) |
| `COMO_PALPITAR` | "como dou palpite", "formato do palpite" | exemplos + dica próximos jogos (ISSUE-017) |
| `QUANDO_COMECA` | "quando começa", "quando termina", "que dia abre rodada" | data próxima rodada (usa bolão padrão) (ISSUE-018) |
| `EDITAR_PALPITE` | "corrigir palpite", "errei palpite", "mudar palpite" | fluxo edita palpite se rodada aberta (ISSUE-011) |
| `APAGAR_PALPITE` | "apagar palpite", "desfazer palpite", "remover palpite" | fluxo deleta PalpiteJogo (ISSUE-012) |
| `DEFINIR_BOLAO_PADRAO` | "bolão padrão", "meu bolão principal" | seta `Usuario.bolaoPadraoId` (ISSUE-016) |
| `RENOMEAR_BOLAO` | "renomear bolão", "mudar nome do bolão" | admin renomeia + notifica participantes (ISSUE-020) |
| `REMOVER_PARTICIPANTE` | "remover Fulano", "tirar Fulano do bolão", "expulsar" | admin remove participante com confirmação (ISSUE-021) |
| `RESUMO_BOLOES` | "como to indo nos boloes", "meu desempenho geral" | resumo posição + pontos em cada bolão (ISSUE-023) |
| `APROVAR` / `RECUSAR` | `!aprovar Nome` / `!recusar Nome` | ações admin explícitas |
| `PENDENTES` | "pendentes", "tem pedido pra aprovar" | lista pedidos pendentes |
| `CANCELAR` | "cancelar", "sair", "esquece" | reset FSM + menu |
| `TEXTO_LIVRE` | (fallback) | passa pra camada 2 (LLM) |

**Ordem do matching em `INTENT_RULES`**: `REGRAS → INFO_SENHA → EXCLUIR_BOLAO →
PENDENTES → COMO_CONVIDAR → ABRIR_RODADA → SAIR_BOLAO → QUEM_PARTICIPA →
MEU_PALPITE → PALPITES_AMBIGUO → PROXIMOS_JOGOS → MEUS_PONTOS → MEUS_BOLOES →
JOGOS_HOJE → CRIAR_BOLAO → ENTRAR_BOLAO → RANKING`.

Específicos antes de genéricos (ex: `INFO_SENHA` antes de `ENTRAR_BOLAO` porque
"senha do bolão" tem "bolão").

---

## 8. Estados FSM (`src/whatsapp/session.manager.ts`)

Armazenados em Redis (`session:{waId}`), TTL **30min**.

| Estado | Quando entra | Handler | Sai para |
|--------|--------------|---------|----------|
| `IDLE` | default | router IDLE | qualquer outro |
| `CRIANDO_BOLAO_NOME` | "criar bolão" | `handleCriandoBolaoNome` | `CRIANDO_BOLAO_SENHA` |
| `CRIANDO_BOLAO_SENHA` | nome válido | `handleCriandoBolaoSenha` | `IDLE` (criou) |
| `CRIANDO_BOLAO_AGUARDANDO_PIX` | *desativado* (PIX off) | inerte | — |
| `ENTRANDO_NOME` | "entrar em bolão" | `handleEntrandoNome` (3 tentativas, ISSUE-002) | `IDLE` ou `ESCOLHENDO_BOLAO_PARA_ENTRAR` |
| `ENTRANDO_SENHA` | *legado* — fluxo novo (ISSUE-004) cria solicitação sem senha | `handleEntrandoSenha` (não setado mais) | — |
| `PALPITANDO` | job `send-palpite-call` | `handlePalpitando` | `IDLE` |
| `ESCOLHENDO_BOLAO_RANKING` | "ranking" + >1 bolão | `handleEscolhendoBolaoRanking` | `IDLE` |
| `ESCOLHENDO_BOLAO_PALPITES` | "meus palpites" + >1 bolão | `handleEscolhendoBolaoPalpites` | `CONFIRMANDO_VER_PALPITES` ou `IDLE` |
| `CONFIRMANDO_VER_PALPITES` | escolheu bolão pra palpites | `handleConfirmandoVerPalpites` | `IDLE` |
| `ESCOLHENDO_BOLAO_PARA_PALPITAR` | palpite inline + >1 bolão | `handleEscolhendoBolaoParaPalpitar` | `CONFIRMANDO_PALPITES_INLINE` |
| `CONFIRMANDO_PALPITES_INLINE` | extraiu palpites | `handleConfirmandoPalpitesInline` | `IDLE` |
| `ESCOLHENDO_INTENCAO_PALPITES` | "palpites" sozinho | `handleEscolhendoIntencaoPalpites` | `IDLE` ou despacha handler escolhido |
| `ESCOLHENDO_BOLAO_PARA_ENTRAR` | nome bate >1 bolão (ISSUE-003) | `handleEscolhendoBolaoParaEntrar` | `IDLE` (cria solicitação) |
| `ESCOLHENDO_BOLAO_CONVITE` | "como convido" + >1 bolão admin | `handleEscolhendoBolaoConvite` | `IDLE` (manda link) |
| `ESCOLHENDO_BOLAO_SAIR` | "sair" + >1 bolão | `handleEscolhendoBolaoSair` | `CONFIRMANDO_SAIR_BOLAO` |
| `CONFIRMANDO_SAIR_BOLAO` | escolheu bolão pra sair | `handleConfirmandoSairBolao` | `IDLE` |
| `ESCOLHENDO_BOLAO_PARTICIPANTES` | "quem participa" + >1 | `handleEscolhendoBolaoParticipantes` | `IDLE` |
| `ESCOLHENDO_BOLAO_EXCLUIR` | "excluir bolão" + >1 admin | `handleEscolhendoBolaoExcluir` | `CONFIRMANDO_EXCLUSAO_BOLAO` |
| `CONFIRMANDO_EXCLUSAO_BOLAO` | escolheu bolão pra excluir | `handleConfirmandoExclusaoBolao` (exige texto "confirmar") | `IDLE` |
| `ESCOLHENDO_BOLAO_PADRAO` | "bolão padrão" + >1 bolão | `handleEscolhendoBolaoPadrao` (ISSUE-016) | `IDLE` |
| `RENOMEANDO_BOLAO_ESCOLHA` | "renomear bolão" + >1 admin | `handleEscolhendoBolaoRenomear` (ISSUE-020) | `RENOMEANDO_BOLAO_NOME` |
| `RENOMEANDO_BOLAO_NOME` | admin escolheu/único | `handleRenomeandoBolaoNome` (recebe nome) | `CONFIRMANDO_RENOMEACAO_BOLAO` |
| `CONFIRMANDO_RENOMEACAO_BOLAO` | nome recebido | `handleConfirmandoRenomeacaoBolao` (sim/não) | `IDLE` |
| `REMOVENDO_PARTICIPANTE_ESCOLHA_BOLAO` | "remover" + >1 admin | `handleEscolhendoBolaoRemover` (ISSUE-021) | `REMOVENDO_PARTICIPANTE_ESCOLHA_NOME` ou direto |
| `REMOVENDO_PARTICIPANTE_ESCOLHA_NOME` | bolão escolhido + sem nome no texto | `handleRemovendoParticipanteNome` | `CONFIRMANDO_REMOCAO_PARTICIPANTE` |
| `CONFIRMANDO_REMOCAO_PARTICIPANTE` | nome encontrado | `handleConfirmandoRemocaoParticipante` | `IDLE` |
| `CONFIRMANDO_PALPITE_PLACAR_ABSURDO` | palpite >15 gols ou total >20 | `handleConfirmandoPalpitePlacarAbsurdo` (ISSUE-013) | `IDLE` |
| `EDITANDO_PALPITE_ESCOLHA_BOLAO` | "editar palpite" + >1 bolão aberto | `handleEscolhendoBolaoEditarPalpite` (ISSUE-011) | `EDITANDO_PALPITE_NOVO_PLACAR` |
| `EDITANDO_PALPITE_NOVO_PLACAR` | bolão escolhido | `handleEditandoPalpiteNovoPlacar` (espera placar novo) | `IDLE` |
| `APAGANDO_PALPITE_ESCOLHA_BOLAO` | "apagar palpite" + >1 bolão | `handleEscolhendoBolaoApagarPalpite` (ISSUE-012) | `APAGANDO_PALPITE_ESCOLHA_JOGO` |
| `APAGANDO_PALPITE_ESCOLHA_JOGO` | bolão escolhido | `handleApagandoPalpiteEscolhaJogo` (lista palpites editáveis) | `CONFIRMANDO_APAGAR_PALPITE` |
| `CONFIRMANDO_APAGAR_PALPITE` | jogo escolhido | `handleConfirmandoApagarPalpite` | `IDLE` |
| `CONFIRMANDO_APROVAR_TODOS` | "aprovar todos" detectado | `handleConfirmandoAprovarTodos` | `IDLE` |
| `CONFIRMANDO_RECUSAR_TODOS` | "recusar todos" detectado | `handleConfirmandoRecusarTodos` | `IDLE` |
| `CONFIRMANDO_RECUSAR_NOMEADO` | "recusar Fulano" detectado | `handleConfirmandoRecusarNomeado` | `IDLE` |

### 8.1 FSM escape (interrupção de estado)

Quando o usuário está num estado de "leitura/escolha" e manda **intent forte**
(ex: `RANKING`, `CRIAR_BOLAO`, `MEUS_BOLOES`), o estado anterior é abandonado
silenciosamente. Implementado em `escapouFsmStaleParaNovaIntent`.

**Estados protegidos** (NÃO interrompem): `CRIANDO_BOLAO_*`, `PALPITANDO`,
`CONFIRMANDO_PALPITES_INLINE`, `CONFIRMANDO_EXCLUSAO_BOLAO`, todos os
`CONFIRMANDO_APROVAR_*`/`CONFIRMANDO_RECUSAR_*` (ações destrutivas/críticas).

### 8.2 Janela de palpite livre

Chave separada em Redis (`palpite_window:{waId}`, TTL **5min**). Setada quando
o bot manda lista de "próximos jogos". Na próxima mensagem em IDLE, se for
TEXTO_LIVRE, dispara o LLM extrator de palpite — cobre "2 a zero pra Brasil"
e formatos que regex não pega.

---

## 9. Modelo de dados (Prisma)

`prisma/schema.prisma`:

```prisma
model Usuario {
  id            String   @id @default(uuid())
  whatsappId    String   @unique          // só dígitos (5511999999999)
  nome          String                    // pushName do WhatsApp Business
  telefone      String   @unique
  bolaoPadraoId String?                   // ISSUE-016: bolão padrão opt-in
  criadoEm      DateTime @default(now())
  atualizadoEm  DateTime @updatedAt
  participacoes        Participacao[]
  palpites             Palpite[]
  pagamentos           Pagamento[]
  boloesAdministrados  Bolao[]            @relation("BolaoAdmin")
  solicitacoesFeitas   SolicitacaoEntrada[]
  bolaoPadrao          Bolao?             @relation("BolaoPadrao", fields: [bolaoPadraoId], references: [id])
}

model Bolao {
  id             String      @id @default(uuid())
  codigo         String      @unique     // curto, ex: K3MZ8P (ISSUE-001: legado AD71F3 também aceito)
  nome           String                  // visível ("Bolão da Firma")
  senhaHash      String                  // bcrypt — LEGADO (ISSUE-004: entrada via ID pula senha)
  adminId        String
  campeonatoId   String
  campeonatoNome String
  status         StatusBolao @default(ATIVO)   // ATIVO | PAUSADO | FINALIZADO
  pagamentoId    String?     @unique     // PIX desativado nesta fase
  criadoEm       DateTime    @default(now())
  // ...
  @@unique([adminId, nome])
}

model Pagamento { ... PIX desativado ... }

model SolicitacaoEntrada {
  id           String @id @default(uuid())
  usuarioId    String
  bolaoId      String
  status       SolicitacaoStatus @default(PENDENTE)  // PENDENTE | APROVADA | RECUSADA
  respondidoEm DateTime?
  criadoEm     DateTime @default(now())
}

model Participacao {
  id             String   @id @default(uuid())
  usuarioId      String
  bolaoId        String
  pontuacaoTotal Int      @default(0)
  posicaoAtual   Int      @default(0)
  entradaEm      DateTime @default(now())
  @@unique([usuarioId, bolaoId])
}

model Rodada {
  id             String       @id @default(uuid())
  bolaoId        String
  numero         Int
  status         StatusRodada @default(ABERTA)       // ABERTA | FECHADA | FINALIZADA
  dataAbertura   DateTime
  dataFechamento DateTime
  @@unique([bolaoId, numero])
}

model Jogo {
  id            String     @id @default(uuid())
  rodadaId      String
  // Atenção: apiJogoId NÃO é unique global. Adapter FIFA 2026 retorna
  // sempre os mesmos 72 IDs (WC2026_A_1..) — a unicidade é POR RODADA.
  // Ver migration 20260517160000_jogo_apijogo_unique_por_rodada.
  apiJogoId     String
  timeCasa      String
  timeVisitante String
  golsCasa      Int?
  golsVisitante Int?
  status        StatusJogo @default(AGENDADO)        // AGENDADO | AO_VIVO | FINALIZADO | ADIADO | CANCELADO
  dataHora      DateTime
  @@unique([rodadaId, apiJogoId])
}

model Palpite {
  id        String   @id @default(uuid())
  usuarioId String
  rodadaId  String
  pontuacao Int      @default(0)
  calculado Boolean  @default(false)
  jogos     PalpiteJogo[]
  @@unique([usuarioId, rodadaId])
}

model PalpiteJogo {
  id            String @id @default(uuid())
  palpiteId     String
  jogoId        String
  golsCasa      Int
  golsVisitante Int
  pontosObtidos Int    @default(0)
  @@unique([palpiteId, jogoId])
}
```

### 9.1 Operações críticas — invariantes que NÃO podem regredir

Resumo das regras que vieram de bugs reais e que **toda mudança nesta
camada precisa preservar**:

| Invariante | Onde mora | Por que existe |
|------------|-----------|----------------|
| `criarBolao` é **atômico** (`prisma.$transaction`) | `bolao.service.ts:criarBolao` | Pré-2026-05-17 o seed de jogos vivia num try/catch silencioso. Quando o `createMany` estourava P2002 (causa: `apiJogoId` unique global), o bolão+rodada ficavam criados mas sem jogos. Admin via "✅ criado" e o bot dizia depois "não tem rodada aberta". **Nunca** isolar passos de criação fora da transação. |
| `Jogo.apiJogoId` é unique **por rodada**, não global | `prisma/schema.prisma` + migration `20260517160000_jogo_apijogo_unique_por_rodada` | Adapter FIFA retorna os mesmos 72 IDs (`WC2026_A_1`..) pra qualquer bolão. Unique global quebrava do 2º bolão em diante. |
| Listagens de bolão distinguem **ação** vs **consulta histórica** | `bolao.repository.ts` (2 funções) + `bolao.service.ts` (2 wrappers) | Bolão FINALIZADO (soft delete) deve seguir visível em consultas — bot promete "palpites e ranking ficam guardados" ao encerrar. Convenção: <br>• `listarBoloesAtivosDoUsuario` → ações: palpitar, convidar, sair, abrir rodada. <br>• `listarBoloesDoUsuarioComHistorico` → consultas: ranking, meus palpites, meus bolões. <br>A função antiga `listarBoloesDoUsuario` é alias depreciado pra ativos. |
| Bolões encerrados marcados com 🏁 em listas numeradas | `handleRanking`, `handleMeusBoloes`, `handleMeusPalpites` | UI clara — usuário sabe que aquele bolão já terminou antes de escolher. |
| `enviarRankingDoBolao` adiciona sufixo "🏁 ranking final guardado" se status=FINALIZADO | `command.router.ts:enviarRankingDoBolao` | Coerência com a promessa do encerramento. |
| `handleProximosJogos` detecta "usuário só tem encerrados" e dá mensagem **auto-diagnóstica** | `command.router.ts:handleProximosJogos` | Mensagem genérica "não participa de nenhum bolão" contradizia o próprio bot que tinha notificado o encerramento minutos antes. |

---

## 10. Pontuação

Função pura `calcularPontos` em `src/modules/ranking/pontuacao.calc.ts`.
Config padrão `PONTUACAO_PADRAO` em `ranking.types.ts`:

| Caso | Pontos |
|------|--------|
| Placar exato | **10** |
| Resultado certo + gols de um time | **7** |
| Apenas resultado certo | **5** |
| Apenas gols de um time | **3** |
| Errou tudo | **0** |

Texto exibido pro usuário sempre vem de `regrasTexto()` em `src/whatsapp/regras.text.ts`
(alinhado com `PONTUACAO_PADRAO`).

---

## 11. Códigos curtos de bolão

**Geração** (`gerarCodigoBolao`, `src/utils/bolao-codigo.ts`):
- Alfabeto restritivo (30 chars): `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- Sem `0/1/I/L/O` (ambiguidade visual)
- 6 chars (~729M combinações), unicidade garantida no service

**Extração** (`extrairCodigoBolao`):
- Aceita `[A-Z0-9]{4,10}` (mais permissivo que a geração — ISSUE-001)
- Codigos legados (gerados via MD5 hex, ex: `AD71F3`) funcionam
- Prioridade: `#XXX` (explícito) > palavra isolada com ≥1 dígito

**Fast-path** (`handleIncomingMessage`):
- Detecta código em quase todos os estados (exceto destrutivos como
  `CRIANDO_BOLAO_SENHA`, `PALPITANDO`, `CONFIRMANDO_*`) — ISSUE-007
- Quando bate, vai direto pro `tentarEntrarPorCodigo` (cria solicitação sem senha)

---

## 12. Convite com link wa.me (ISSUE-040)

Helper `renderizarConvite` em `src/whatsapp/convite.helper.ts` gera:

```
Bora galera! 🏆 O bolão "Bolão da Firma" já tá pronto.

Pra entrar é só clicar no link abaixo (manda a mensagem que aparecer pro bot):

https://wa.me/5511978277516?text=Quero%20entrar%20no%20bol%C3%A3o%20...

ID do bolão: #K3MZ8P
```

- Número vem de `env.WHATSAPP_BUSINESS_NUMBER` (formato amigável; helper normaliza pra dígitos)
- Convidado clica → WhatsApp abre conversa com bot já com mensagem pronta → manda → entra
- Fallback automático sem link quando env não setado
- Usado em `handleCriandoBolaoSenha` (pós-criação) e `enviarConvitePraBolao` (handler COMO_CONVIDAR)

---

## 13. Jobs agendados (`src/jobs/`)

| Job | Cron | O que faz |
|-----|------|-----------|
| `fetch-results` | `*/5 * * * *` | Puxa placares da FIFA API/scraping, atualiza `Jogo` |
| `calculate-scores` | `*/10 * * * *` | Calcula pontos de rodadas finalizadas |
| `send-reminders` | `*/30 * * * *` | Cutuca quem tem `jogosPendentes` |
| `send-ranking` | `0 * * * *` | Ranking hourly (cards em imagem via sharp/SVG) |
| `send-bom-dia` | `0 * * * *` | Saudação nos dias com jogo (decide horário internamente) |
| `send-palpite-call` | `5 * * * *` | Chamada de palpites `PALPITE_CALL_HORAS_ANTES` (6h) antes do 1o jogo do dia |
| `repair-broken-boloes` | boot + `0 3 * * *` | Detecta bolões ATIVOS sem rodada ou com rodada vazia, carrega jogos via adapter, notifica admin via DM. Roda 1x no boot (limpa legado) + 1x/dia às 03:00 (defensivo). Idempotente. |
| `validate-pix` | *desativado* | (mantido comentado, volta quando reativar PIX) |

Idempotência via flags em Redis (`bom_dia_sent:YYYY-MM-DD:waId`,
`palpite_call_sent:YYYY-MM-DD:waId`). O `repair-broken-boloes` é
idempotente naturalmente (só age em bolões sem rodada ou rodada vazia).

---

## 14. Comandos do bot (linguagem natural)

Ver `docs/commands.md` para a lista completa em forma de cheatsheet.

Resumo: o bot entende português coloquial. Comandos `!aprovar` e `!recusar`
têm prefixo `!` por convenção de admin; o resto é texto livre.

---

## 15. Variáveis de ambiente (`.env`)

```ini
# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000        # ngrok ou domínio público em prod

# Database
DATABASE_URL=postgresql://varbolao:senha_segura@localhost:5433/varbolao
POSTGRES_PASSWORD=senha_segura

# Redis
REDIS_URL=redis://localhost:6380/0

# Evolution API
DRY_RUN_WHATSAPP=true                # true = simulação, false = WhatsApp real
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<api-key-da-evolution>
EVOLUTION_INSTANCE=varbolao
EVOLUTION_WEBHOOK_TOKEN=             # opcional, token estático no header

# LLM — Google Gemini (default) + Ollama (fallback)
LLM_ENABLED=true
LLM_PROVIDER=auto                    # auto | gemini | ollama
LLM_TIMEOUT_MS=8000

# Gemini (Google AI Studio — gratuito até 1500 req/dia)
GEMINI_API_KEY=<sua-chave>
GEMINI_MODEL=gemini-2.5-flash-lite

# Ollama Cloud (fallback)
LLM_URL=https://ollama.com
LLM_API_KEY=<chave-ollama-cloud>
LLM_MODEL=gpt-oss:20b

# Futebol
FOOTBALL_PROVIDER=fifa-2026          # mock | fifa-2026
FOOTBALL_API_KEY=mock
FOOTBALL_API_URL=https://www.api-futebol.com.br/v1
FIFA_SEASON_ID=                      # opcional, FIFA API pública pra placares ao vivo

# PIX (DESATIVADO)
PIX_PROVIDER=mock
PIX_VALOR_CENTAVOS=0

# Bot
BOT_PREFIX=!
TIMEZONE=America/Sao_Paulo
DEFAULT_CAMPEONATO=copa-2026-fase-grupos
HORARIO_BOM_DIA=09:00
PALPITE_CALL_HORAS_ANTES=6
WHATSAPP_BUSINESS_NUMBER=+55 11 97827-7516  # usado pra link wa.me
```

Schema completo em `src/config/env.ts` (Zod-validado, fail-fast em prod).

---

## 16. Webhook Evolution API

### 16.1 Payload entrante

```json
{
  "event": "messages.upsert",
  "instance": "varbolao",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "ABCD1234..."
    },
    "pushName": "Humberto",
    "message": { "conversation": "oi" }
  }
}
```

### 16.2 Filtros aplicados em `webhook.handler.ts`

1. `event` ≠ `messages.upsert` → ignora
2. `instance` ≠ `EVOLUTION_INSTANCE` → ignora (multi-instance protection)
3. `fromMe` = true → ignora (não responde a si)
4. `remoteJid` termina em `@g.us` → ignora (DM-only, grupos não)
5. `remoteJid` em `@lid` (LinkedID) sem `senderPn`/`participantPn` resolvíveis → ignora
6. Sem texto extraível (image/sticker/audio etc.) → ignora
7. Marca mensagem como lida (best-effort)
8. Despacha pro `handleIncomingMessage`

### 16.3 Segurança (sem HMAC nativo na Evolution)

- Validação opcional via header `x-evolution-token` (env `EVOLUTION_WEBHOOK_TOKEN`)
- Em produção, token recomendado. Em dev, desativado por padrão
- Recomenda-se proxy reverso (nginx) + IP allowlist em prod

### 16.4 Diferença vs Meta WhatsApp Cloud

| Aspecto | Evolution (atual) | Meta Cloud (futuro?) |
|---------|-------------------|----------------------|
| `to` format | `5511999@s.whatsapp.net` | `5511999` (só dígitos) |
| Webhook shape | `data.message.conversation` | `entry[].changes[].value.messages[].text.body` |
| Auth | `apikey` header | `Authorization: Bearer` |
| Assinatura | token estático opcional | `X-Hub-Signature-256` (HMAC obrigatório) |
| Janela 24h | sem regra | obrigatória — fora dela, só templates |

Migração no futuro pode reusar todo o pipeline interno (`message.parser`,
`session.manager`, `command.router`) — só trocar `evolution.client` por
`meta.client`.

---

## 17. Métricas / Observabilidade (ISSUE-008)

`src/utils/metrics.ts` + Redis. Funções `incContador`, `registrarMsgNaoEntendida`,
`lerMetricasDoDia`, `lerAmostrasNaoEntendi`.

Logs estruturados:

| Prefixo | Onde | O que loga |
|---------|------|------------|
| `[timing]` | toda mensagem | `waId=... intent=... state=... user=Xms session=Yms parse=Zms dispatch=Wms total=Tms` |
| `[llm]` | toda chamada LLM | `provider=gemini model=... latency=Xms ok` |
| `[smart-fallback]` | LLM responder funcionou | `waId=... regex_intent=X llm_intent=Y` |
| `[nao-entendi]` | tudo falhou | `text=...` (truncado em 200 chars) |
| `[fsm-escape]` | estado interrompido | `state=X → IDLE (nova intent=Y)` |
| `[multi-palpite]` | parse multilinha | `ok=N descartadas=M` |
| `[webhook-debug]` | toda request webhook | dados do payload Evolution |

---

## 18. Testes

- **Unit (`tests/unit/`)**: Vitest, 280+ tests. Cobertos: `bolao-codigo`,
  `convite.helper`, `lista.helper`, `message.parser` (120+ casos), `admin.parser`,
  `palpite.extractor` (mock LLM), `bolao.matcher`, `intent.classifier` (mock LLM),
  `gemini.client`, `ollama.client`, `evolution.client`, `password`, `validators`,
  `ranking.service`.

- **Simulação (`scripts/simulate-conversation.ts`)**: 55+ cenários
  determinísticos cobrindo bugs reais encontrados em conversa.
  Roda com `npx tsx scripts/simulate-conversation.ts`.

- **REPL (`npm run sim`)**: conversa interativa no terminal com banco real
  mas sem mandar mensagem real (`DRY_RUN_WHATSAPP=true`).

- **Smoke Gemini (`scripts/test-gemini.ts`)**: testa a API real (chat simples
  + classifier + extractor) — usa cota.

Ver `docs/TESTING.md` para detalhes.

---

## 19. Deploy

### 19.1 Dev (local)

```cmd
cp .env.example .env                # editar API keys
docker compose up -d                # postgres + redis + evolution
npx prisma migrate dev
npm install
npm run dev                         # Fastify em :3000
```

Pareando Evolution com WhatsApp real:
```cmd
curl -H "apikey: <EVOLUTION_API_KEY>" http://localhost:8080/instance/connect/varbolao
# pega o QR code da resposta, escaneia no WhatsApp
```

### 19.2 Produção (esboço)

- `docker compose --profile full up -d` sobe também o container `app`
- Domínio HTTPS público (Cloudflare Tunnel, Caddy, nginx)
- Postgres e Redis gerenciados (em vez do Docker local)
- `WEBHOOK_GLOBAL_URL` da Evolution apontando pro `APP_URL/webhook/whatsapp`
- Secrets via env do runtime (nunca `.env` versionado)
- Backup do volume `evolution_instances` (session WhatsApp pareada)

---

## 20. Roadmap / Backlog priorizado

Ver `BUGS_E_CENARIOS_VAR_DO_BOLAO.md` (raiz, gerado em 2026-05-16).

**Sprint 1 (FEITO em 2026-05-17):** ISSUE-001 a ISSUE-008 + link wa.me (ISSUE-040
antecipado).

**Hotfixes pós-Sprint 2 (FEITO em 2026-05-17, ver `docs/SPRINT_STATUS.md`):**
- HF-A: `Jogo.apiJogoId` unique-por-rodada + `criarBolao` atômico + job `repair-broken-boloes`
  (fixa "rodada vazia" do 2º bolão em diante)
- HF-B: bolões encerrados (FINALIZADO) visíveis em consultas, marcados com 🏁;
  `handleProximosJogos` auto-diagnóstico quando usuário só tem encerrados

**Sprint 2 (FEITO em 2026-05-17):** ISSUE-009 a ISSUE-023.
- 009 handler "o que é o bot" → INFO_PRODUTO ✅
- 010 handler "quanto custa" → INFO_PRECO ✅
- 011 editar palpite (fluxo escolha bolão → novo placar) ✅
- 012 apagar palpite (fluxo escolha bolão → escolha jogo → confirma) ✅
- 013 validação de placar absurdo (>15 ou total >20) com confirmação ✅
- 014 palpite com time errado → feedback com jogos abertos ✅
- 015 multi-bolão: palpite único aplica em todos automaticamente ✅
- 016 bolão padrão: `Usuario.bolaoPadraoId` + integrado em ranking/pontos/quando-começa/palpite ✅
- 017 handler "como dou palpite" → COMO_PALPITAR com exemplos ✅
- 018 handler "quando começa/termina" → QUANDO_COMECA ✅
- 019 "meus bolões" mostra ID sempre (não só admin) + flag ⭐ padrão ✅
- 020 renomear bolão (admin) — 3 estados FSM + notifica participantes ✅
- 021 remover participante (admin) — 3 estados FSM + soft remove ✅
- 022 "sair do bolão" — mensagem detalha exatamente o que se perde ✅
- 023 (P2 antecipado) RESUMO_BOLOES — posição + pontos em cada bolão ✅

**Sprint 3 (`[P2]`):** ver 024-032 no arquivo de bugs.

**Segurança/robustez transversais:** 033 rate limit por waId, 034 rate limit
criação bolão, 035 cooldown solicitação após recusa, 036 sanitização nomes,
037 mascarar telefone em logs, 038 TTL curto pra confirmações destrutivas.

**Polish:** 039 menu curto pra erros, 041 contexto FSM no smart-fallback,
042 reconhecer encaminhamento.

**Observabilidade:** 043 dashboard admin, 044 jornada do usuário, 045 Sentry/Telegram.

**Dados:** 046 migração de códigos legados (opcional), 047 auditar duplicatas.

---

## 21. Convenções

### Linguagem
- **PT-BR coloquial** em todas as mensagens do bot (chamar usuário de "craque", "boleiro")
- Emojis com parcimônia (1-2 por mensagem)
- Negrito `*texto*` (WhatsApp markdown) pra nomes de bolão, comandos
- Itálico `_texto_` pra dicas/instruções

### Código
- TypeScript estrito, sem `any` solto
- Comentários em PT-BR informal (alinhado com produto)
- Nomes de funções em PT-BR (`handleIdle`, `enviarRanking`) por consistência com o domínio
- Imports relativos com `.js` (TS ESM)

### Mudanças
- Toda mudança estrutural (FSM state novo, intent nova, módulo novo, env nova,
  job novo, mudança de schema) **deve atualizar este documento** + `docs/commands.md`
  quando aplicável.
- Skill `.claude/skills/manter-docs-atualizada/SKILL.md` documenta o checklist.

---

## 22. Histórico de versões

| Versão | Data | Mudanças principais |
|--------|------|---------------------|
| 1.0 | 2026-03 | Versão inicial baseada em grupos do WhatsApp |
| 2.0 | 2026-04 | Migração pra DM-only + integração Meta Cloud API |
| 2.1 | 2026-04 | Troca Meta → Evolution API (Baileys) |
| 2.5 | 2026-05-12 | Códigos curtos de bolão + admin parser NL |
| 2.6 | 2026-05-13 | Aprovação admin em linguagem natural + intents (REGRAS, PALPITES_AMBIGUO) + smart fallback LLM |
| 2.7 | 2026-05-14 | Multi-palpite com confirmação + Gemini default + FSM escape geral |
| 2.8 | 2026-05-15 | Gemini Flash Lite + thinking off |
| 3.0 | 2026-05-17 | ISSUES 001-008 + link wa.me + 19 intents + métricas Redis + 280+ tests |
| 3.1 | 2026-05-17 | Sprint 2 completo (ISSUES 009-023): +10 intents, +14 FSM states, bolão padrão (schema migration), editar/apagar palpite, validar placar absurdo, multi-bolão auto-apply, renomear bolão, remover participante, RESUMO_BOLOES. 322 tests, 75 cenários. |
| 3.1.1 | 2026-05-17 | Hotfixes pós-Sprint 2 em produção: (a) `Jogo.apiJogoId` deixa de ser unique global → `@@unique([rodadaId, apiJogoId])` + `criarBolao` virou transação atômica + novo job `repair-broken-boloes` (boot + 03:00 diário). Corrige bolões 2º em diante ficando com rodada vazia. (b) Bolões `FINALIZADO` voltaram a aparecer em consultas (ranking/meus palpites/meus bolões), marcados com 🏁; `handleProximosJogos` ganhou mensagem auto-diagnóstica quando usuário só tem encerrados; repository split `listarBoloesAtivos*` vs `listarBoloes*ComHistorico`. **322 tests, 75 cenários — sem regressão.** |
| **3.1.2** | **2026-05-17** | **Patch da migration de unique-por-rodada.** Descoberto em deploy local: o `@unique` original do init migration foi materializado como `CREATE UNIQUE INDEX "jogos_apiJogoId_key"`, não como `ALTER TABLE ADD CONSTRAINT`. Por isso o `DROP CONSTRAINT IF EXISTS` da migration anterior era no-op silencioso e o índice unique global ficava órfão, ainda bloqueando inserts cross-bolão. Novo migration `20260517170000_drop_jogos_apijogoid_unique_index` executa `DROP INDEX IF EXISTS`. Bolão `#K6VCCJ` (legacy quebrado) reparado com sucesso após apply. Novo script `scripts/run-repair-once.ts` permite disparar o reparo sob demanda sem subir o servidor (útil quando porta 3000 já está ocupada). (este documento) |
| **3.2** | **2026-05-17** | **Subprojeto `web/` — site institucional + área logada (skeleton).** Next.js 15 + App Router + Tailwind CSS 4 + React 19, isolado do bot (próprio `package.json`, `tsconfig.json`, sem compartilhar `node_modules`). Landing one-pager dark-mode com paleta verde-gramado: Hero, Como Funciona (3 passos), Por Que (4 benefícios), Banner Copa 2026 com countdown JS, FAQ acordeon, Fale Conosco (mailto), Footer. Páginas adicionais: `/login` (form desabilitado até Fase 2), `/app` (dashboard mock), `/politica-privacidade` e `/termos` (placeholders LGPD para revisão jurídica), `/not-found` 404 com tom de voz, `robots.ts` + `sitemap.ts` para SEO. CTAs primários abrem `wa.me` do bot com mensagem pré-preenchida (zero atrito). Deploy independente, bot intocado. Roadmap detalhado em [`web/README.md`](web/README.md). Veja seção 23 abaixo. |
| **3.3** | **2026-05-18** | **Fase 2 + Fase 3 do site — Web API funcional + área logada real.** Schema Prisma novo: `UsuarioWeb` (com `dataNascimento` opcional/LGPD-friendly) e `OtpToken`. Migration `20260518100000_web_api_usuario_e_otp`. Pasta `src/web-api/` com: `session.service.ts` (token HMAC compacto via crypto nativo), `otp.service.ts` (gerar 6-dig + enviar via Evolution + verificar + rate limit), `rate-limit.ts` (bucket Redis), `session.middleware.ts` (decorator Fastify), `auth.routes.ts` (otp/request, otp/verify, first-access, login, logout, session), `me.routes.ts` (GET/PATCH /me, GET /me/boloes com posição + próximo jogo), `bolao.routes.ts` (ranking, meus-palpites, próximos-jogos). Wire-up CONDICIONAL em `src/index.ts` via `WEB_API_ENABLED` (default `false` = bot idêntico ao 3.2). Dependências novas: `@fastify/cookie`, `@fastify/cors`. Prisma pinado em `~6.6.0` pra preservar tipos do bot. No `web/`: `lib/api.ts` (proxy SSR pro bot com forward de cookies), `lib/session.ts`, `middleware.ts` (protege `/app/*`), server actions de auth, `/login` real (2 passos OTP + alternativa senha), `/login/primeiro-acesso` (com `dataNascimento` opcional), `/app` (dashboard real), `/app/bolao/[codigo]` (tabs Ranking/Palpites/Jogos), `/app/perfil` (editar nome/data + logout). Política de privacidade atualizada com finalidade do `dataNascimento`. **337 tests (322 + 15 novos), bot intocado quando `WEB_API_ENABLED=false`.** Veja seção 24 abaixo. |

---

## 23. Subprojeto Web (`web/`) — site institucional + área logada

### 23.1 Por que existe e por que é um subfolder

O bolão precisa de:
1. **Landing** indexável (`www.vardobolao.com.br`) pra captar usuários organicamente
   e pra ter uma resposta apresentável quando alguém recebe o link wa.me e não
   conhece o produto.
2. **Área logada** read-only pra usuário consultar ranking/palpites/pontos sem
   precisar ficar mandando comando no WhatsApp.

A escolha foi **Next.js 15 (App Router)** num subfolder `web/` do mesmo
repositório do bot. O plano original (`PLANO_SITE_VAR_DO_BOLAO.md`) previa repo
separado; a consolidação num subfolder ficou mais simples por:

- **CI/CD único** — uma só pipeline de deploy, dois services.
- **Schema Prisma compartilhado** — quando a Fase 2 chegar, o Next vai importar
  tipos de `@prisma/client` do bot direto via path. Sem publicar pacote, sem
  duplicar schema (que é exatamente o que a seção 4.2 do plano combate).
- **Documentação centralizada** — este arquivo + `PLANO_SITE_VAR_DO_BOLAO.md`
  no mesmo `git log`.

Isolamento técnico mantido:
- `web/package.json` próprio, com deps separadas (Next, React, Tailwind v4).
- `web/tsconfig.json` próprio, com `paths: { "@/*": ["./src/*"] }`.
- Hooks Claude (`.claude/hooks/typecheck-on-ts-edit.mjs`, `validate-on-stop.mjs`)
  só fazem `tsc --noEmit` quando o arquivo editado está em `src/` ou `tests/` do
  bot — o root `tsconfig.json` (`include: ["src/**/*"]`) ignora `web/`.
- Porta de dev diferente (`3001`) — o bot continua em `3000`.

### 23.2 Stack

| Camada | Tech | Versão |
|--------|------|--------|
| Framework | Next.js | 15 (App Router, Server Components, RSC) |
| UI lib | React | 19 RC |
| Tipos | TypeScript strict | 5.6 |
| CSS | Tailwind CSS 4 (`@tailwindcss/postcss`, sem `tailwind.config.ts`) | 4 beta |
| Ícones | `lucide-react` | latest |
| Fonts | `next/font/google` — Archivo Black (display) + Inter (corpo) | — |
| Util CSS | `clsx` + `tailwind-merge` (em `lib/cn.ts`) | — |

### 23.3 Estrutura de pastas

```
web/
├── README.md            doc própria (quick start, paleta, scripts, roadmap)
├── package.json         deps isoladas
├── next.config.mjs      X-Frame-Options=DENY, no powered-by, no nosniff
├── tsconfig.json        strict, paths @/*
├── postcss.config.mjs   Tailwind v4
├── .env.example         vars do site + futuras vars da Fase 2
├── public/
│   ├── favicon.svg      ícone com a paleta verde-conexao
│   ├── bola-pattern.svg padrão decorativo de bola (background sutil)
│   └── og-image.svg     1200x630 para share social
└── src/
    ├── app/
    │   ├── layout.tsx           metadata raiz (OG, Twitter, theme color)
    │   ├── globals.css          tokens (@theme), animations, utilities
    │   ├── page.tsx             landing one-pager (Hero + ... + Footer)
    │   ├── not-found.tsx        404 ("Bola pra fora.")
    │   ├── robots.ts            SEO — bloqueia /app e /api
    │   ├── sitemap.ts           SEO — / + /login + legais
    │   ├── login/page.tsx       skeleton (form desabilitado, CTAs pro bot)
    │   ├── app/page.tsx         dashboard mock (preview, sem backend)
    │   ├── politica-privacidade/page.tsx
    │   └── termos/page.tsx
    ├── components/
    │   ├── landing/
    │   │   ├── Header.tsx       fixo, scroll-aware, drawer mobile
    │   │   ├── Hero.tsx         tipografia Archivo Black, badge live, stats
    │   │   ├── ComoFunciona.tsx 3 cards (Smartphone, PlusCircle, MessageCircle)
    │   │   ├── PorQue.tsx       4 benefícios em grid responsiva
    │   │   ├── Copa2026.tsx     "use client" — countdown via setInterval
    │   │   ├── FAQ.tsx          "use client" — accordion acessível
    │   │   ├── FaleConosco.tsx  mailto: + CTA WhatsApp
    │   │   ├── Footer.tsx
    │   │   └── PageShell.tsx    layout simples (header + footer) para legais
    │   └── ui/
    │       ├── Button.tsx       variants primary/secondary/ghost
    │       ├── Container.tsx    max-w-6xl, padding lateral
    │       └── Logo.tsx         símbolo (SVG inline) + wordmark
    └── lib/
        ├── cn.ts                clsx + tailwind-merge
        └── constants.ts         SITE_URL, BOT_WHATSAPP_NUMBER, waLink, datas
```

### 23.4 Identidade visual

Tokens vivem em `globals.css` no `@theme` (Tailwind 4 nativo, sem `tailwind.config.ts`).

| Token | Hex | Onde aparece |
|-------|-----|--------------|
| `--color-verde-conexao` | `#25D366` | CTAs primários, badges de live, links em destaque |
| `--color-verde-gramado` | `#1B5E20` | topo do gradiente de fundo |
| `--color-verde-gramado-dark` | `#0F3814` | base do gradiente, header com scroll |
| `--color-verde-gramado-deep` | `#082008` | footer, fundos profundos |
| `--color-amarelo-arbitro` | `#FFEA00` | "falta palpitar", contagem regressiva, alertas |
| `--color-cinza-card` | `#18241B` | cards de seção |
| `--color-branco-puro` | `#FFFFFF` | texto principal |

Utilitários CSS:
- `.var-frame` — cantos `[ ]` tipo mira do VAR ao redor de blocos.
- `.field-divider` — linha branca 20% opacidade entre seções (linhas do campo).
- `.bg-ball` — `bola-pattern.svg` sutil no canto.
- `.animate-fade-up`, `.animate-pulse-soft` — animações curtas.

Tom de voz alinhado com o do bot (boleiro, direto): "A resenha do grupo com
a precisão dos dados", "Bola pra fora.", "Bora segurar.", "Tira a dúvida".

### 23.5 Vínculo com o bot (CTAs `wa.me`)

Cada CTA primário do site abre uma conversa no WhatsApp com mensagem
pré-preenchida via `https://wa.me/<numero>?text=<mensagem>`. Vive em
`web/src/lib/constants.ts`:

```ts
export const CTA_CRIAR_BOLAO = waLink("Olá! Quero criar um bolão.");
export const CTA_ENTRAR_BOLAO = waLink("Olá! Quero entrar em um bolão.");
export const CTA_PALPITAR     = waLink("Quero palpitar.");
export const CTA_FALAR_BOT    = waLink("Oi!");
```

O número do bot vem de `NEXT_PUBLIC_BOT_WHATSAPP_NUMBER` (build-time public).

**Convenção:** o site NUNCA tenta executar uma ação que muda estado (criar
bolão, palpitar, aprovar pedido). Toda ação destrutiva ou de escrita é
redirecionada pro WhatsApp via `wa.me` com mensagem pronta. Isso garante:
- Bot continua sendo a **única fonte de verdade** das mutações.
- Não há duplicação de regras de negócio entre canais.
- Site pode ser estático/cacheado agressivamente.

### 23.6 Páginas (Fase 1 — entregue)

| Rota | Tipo | Estado |
|------|------|--------|
| `/` | Static | Landing one-pager completa |
| `/login` | Static | Form desabilitado, CTAs caem no bot (até Fase 2) |
| `/app` | Static | Dashboard mockado (preview, sem dados reais) |
| `/politica-privacidade` | Static | Texto LGPD-template (revisão jurídica pendente) |
| `/termos` | Static | Texto template (revisão jurídica pendente) |
| `/robots.txt` | Generated | Bloqueia `/app` e `/api` da indexação |
| `/sitemap.xml` | Generated | Inclui `/`, `/login`, legais |

### 23.7 Fases futuras (não entregues neste subprojeto ainda)

Roadmap em fases conforme `PLANO_SITE_VAR_DO_BOLAO.md`:

- **Fase 2 — Backend OTP no bot** (`src/web-api/` no projeto do bot, ainda
  não criado): rotas `/api/auth/otp/request`, `/api/auth/otp/verify`,
  `/api/auth/first-access`, `/api/auth/login`, `/api/me/boloes`,
  `/api/boloes/:codigo/ranking`. Schema novo: `UsuarioWeb`, `OtpToken`.
- **Fase 3 — Login OTP real** no site: substituir form skeleton de
  `/login` por OTP via WhatsApp + sessão `iron-session`.
- **Fase 4 — QA + Deploy**: Lighthouse, WCAG AA, Railway com 2 services
  (bot + web), DNS no Registro.br.

### 23.8 O que NÃO foi tocado no bot

Garantia explícita:
- Nenhum arquivo em `src/` foi modificado.
- Nenhum arquivo em `tests/` foi modificado.
- Nenhuma migration Prisma nova foi adicionada.
- Nenhum `env` foi alterado.
- Hooks do Claude (`typecheck-on-ts-edit`, `validate-on-stop`) continuam
  validando só o bot.

Portanto: **subir essa versão não derruba e não modifica o comportamento
do bot em produção**.

---

## 24. Web API — Fase 2 + Fase 3 entregues (v3.3)

### 24.1 Filosofia

O bot **continua sendo a única fonte de verdade** das mutações de dados
(criar bolão, palpitar, aprovar pedido). O site só **lê** — qualquer ação
destrutiva no `web/` redireciona pro WhatsApp via `wa.me` com mensagem
pré-preenchida. Isso garante:

- Zero duplicação de regras de negócio entre canais.
- Cache agressivo no site sem risco de stale-state em mutações.
- Auditoria simples (toda mutação tem mensagem de WhatsApp correspondente).

A única exceção: `PATCH /api/me` permite editar nome/dataNascimento, porque
isso é dado de conta web (não de bolão) e não tem fluxo correspondente no
chat do bot.

### 24.2 Schema novo (Prisma)

```prisma
model UsuarioWeb {
  id              String   @id @default(uuid())
  usuarioId       String   @unique
  email           String   @unique
  senhaHash       String                            // bcrypt cost 12
  dataNascimento  DateTime?                         // opcional (LGPD)
  emailVerificado Boolean  @default(false)
  criadoEm        DateTime @default(now())
  atualizadoEm    DateTime @updatedAt
  ultimoLoginEm   DateTime?
  usuario         Usuario  @relation(fields: [usuarioId], references: [id], onDelete: Cascade)
  @@map("usuarios_web")
}

model OtpToken {
  id           String    @id @default(uuid())
  whatsappId   String
  codigo       String                                // 6 dígitos
  usadoEm      DateTime?
  expiraEm     DateTime                              // criadoEm + OTP_VALIDITY_MINUTES
  tentativas   Int       @default(0)                 // max OTP_MAX_ATTEMPTS
  criadoEm     DateTime  @default(now())
  @@index([whatsappId, codigo])
  @@index([expiraEm])
  @@map("otp_tokens")
}
```

A `Usuario` ganhou a relação inversa `usuarioWeb UsuarioWeb?`. Migration:
`prisma/migrations/20260518100000_web_api_usuario_e_otp/migration.sql`.

### 24.3 Endpoints REST

Todos só são registrados se `WEB_API_ENABLED=true`. CORS aceita `WEB_ORIGIN`
(virgula-separada). Cookies `httpOnly`, `SameSite=Lax`, `Secure` em prod.

| Método | Rota | Auth | Função |
|--------|------|------|--------|
| POST | `/api/auth/otp/request` | pública | Gera OTP + manda via Evolution. Sempre 200 (anti-enumeration). Rate limit por waId. |
| POST | `/api/auth/otp/verify` | pública | Valida código. Se `UsuarioWeb` existe, seta `vdb_session`. Senão, seta `vdb_pre_cadastro` (10 min). |
| POST | `/api/auth/first-access` | pre-cookie | Cria `UsuarioWeb` (nome, email, senha, dataNascimento opcional). Troca pre-cookie por sessão. |
| POST | `/api/auth/login` | pública | Login com email + senha. Bcrypt cost 12. Rate limit por email. |
| POST | `/api/auth/logout` | qualquer | Limpa cookie. |
| GET | `/api/auth/session` | sessão | Sanity check (`{ uid, wid }`). |
| GET | `/api/me` | sessão | Perfil + email + dataNascimento. |
| PATCH | `/api/me` | sessão | Atualiza nome / dataNascimento. |
| GET | `/api/me/boloes` | sessão | Lista bolões com posição, pontos, próximo jogo, flag "falta palpitar". |
| GET | `/api/boloes/:codigo/ranking` | sessão (participante) | Ranking completo. |
| GET | `/api/boloes/:codigo/meus-palpites` | sessão (participante) | Histórico por rodada com pontuação. |
| GET | `/api/boloes/:codigo/proximos-jogos` | sessão (participante) | Jogos abertos, com flag "já palpitou" e o palpite atual. |

### 24.4 Sessão — token HMAC compacto

Em vez de `iron-session` (mais peso, mais deps), implementamos um token
HMAC bem pequeno em `src/web-api/session.service.ts`:

```
token = <base64url(JSON({uid, wid, exp}))> . <HMAC-SHA256(payload, WEB_SESSION_SECRET)>
```

Validação: `verifySessionToken()` faz compare em tempo constante
(`crypto.timingSafeEqual`), checa expiração, parse JSON. Logout = expira
o cookie no browser; sem lista de revogação no MVP (TTL curto + cookie
httpOnly basta).

### 24.5 OTP via WhatsApp

`src/web-api/otp.service.ts`:
- `gerarEEnviarOtp(waId)` — invalida tokens anteriores do mesmo waId
  (mantém auditoria), cria novo de 6 dígitos, persiste `OtpToken`, manda
  via `sendText()` do Evolution (mesmo cliente do bot).
- `verificarOtp(waId, codigo)` — busca token mais recente não-usado,
  checa `tentativas >= OTP_MAX_ATTEMPTS` (invalida se sim), checa
  expiração, compara código, incrementa tentativas em caso de erro.
- `normalizarTelefoneBR(input)` — função pura testada (15 testes
  unitários novos).

Rate limit por waId via Redis bucket: `OTP_RATE_LIMIT_PER_MINUTE=1` +
`OTP_RATE_LIMIT_PER_DAY=5`. Login com senha tem rate limit independente
por email (5/15min).

### 24.6 Flag `WEB_API_ENABLED` — escopo de impacto

`src/index.ts`:

```ts
if (env.WEB_API_ENABLED) {
  const { registerWebApi } = await import('./web-api/index.js');
  await registerWebApi(app);
}
```

Import dinâmico, dentro do `if`. Quando `WEB_API_ENABLED=false` (default):
- Nenhum módulo de `src/web-api/` é carregado em memória.
- `@fastify/cookie` e `@fastify/cors` não são registrados.
- Banco não consulta `usuarios_web` nem `otp_tokens` (essas migrations
  rodam, mas as tabelas ficam vazias).
- Comportamento do webhook `/webhook/whatsapp` é literalmente o mesmo do
  `v3.2`.

Subir o branch com a flag desligada = zero risco pra produção do bot.

### 24.7 Reuso das funções existentes (não duplicação)

A invariante 9.1 ("backend novo só LÊ via Prisma, usa MESMAS funções de
repository") foi respeitada:

| Endpoint | Reusa de |
|----------|----------|
| `/api/me/boloes` | `listarBoloesDoUsuarioComHistorico` + `buscarRodadaAberta` |
| `/api/boloes/:codigo/ranking` | `buscarRankingBolao` |
| `/api/boloes/:codigo/meus-palpites` | Query direta usando o mesmo padrão de `buscarPontuacaoDetalhada` |
| `/api/boloes/:codigo/proximos-jogos` | `buscarRodadaAberta` + `prisma.jogo.findMany` direto |

Zero novas regras de negócio. Zero risco de drift entre bot e site.

### 24.8 LGPD — data de nascimento

`dataNascimento` é:
- **Opcional** no schema (`DateTime?`) e no form de cadastro.
- **Não-sensível** pela LGPD (art. 5º, II — sensível seria étnico,
  religioso, biométrico, etc).
- Finalidade documentada em [/politica-privacidade](web/src/app/politica-privacidade/page.tsx):
  (a) validação de maioridade pra cumprir Termos; (b) cumprimentar no
  aniversário com mensagem leve.
- **Não compartilhada com terceiros** — fica só no Postgres do bolão.
- **Editável/removível** em `/app/perfil` a qualquer momento (PATCH /api/me
  aceita `dataNascimento: null`).

### 24.9 Novas variáveis de ambiente

```ini
# Liga/desliga toda a Web API. Default false = bot sem mudanca.
WEB_API_ENABLED=false
WEB_ORIGIN=http://localhost:3001
WEB_SESSION_SECRET=<openssl rand -hex 32>
WEB_SESSION_TTL_DAYS=30

OTP_VALIDITY_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_RATE_LIMIT_PER_MINUTE=1
OTP_RATE_LIMIT_PER_DAY=5
```

### 24.10 Testes novos

- `tests/unit/session.service.test.ts` — 6 testes: roundtrip HMAC,
  detecção de assinatura adulterada, swap de payload, expiração, formato
  inválido, JSON corrompido.
- `tests/unit/otp.service.test.ts` — 6 testes de `normalizarTelefoneBR`
  (formatos brasileiros) + 3 placeholders pra suite de integração futura.

Total: **337 testes passando** (322 anteriores + 15 novos).

### 24.11 Falta pra Fase 4 (não entregue ainda)

- Lighthouse audit (target >90 em todas as métricas).
- Teste OTP fim-a-fim com WhatsApp real (`DRY_RUN_WHATSAPP=false`).
- Deploy Railway (2 services: bot com `WEB_API_ENABLED=true` + web).
- DNS `vardobolao.com.br` no Registro.br.
- Suite de integração com DB de teste (atualmente só testes puros).


