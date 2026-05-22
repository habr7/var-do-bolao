# VAR do Bolão — Arquitetura Técnica

> Bot de WhatsApp para bolão de futebol que opera em **conversa direta** (DM) com
> cada usuário. Não depende de grupos. Sistema é DM-only e híbrido **regex → LLM**
> para entender mensagens em português coloquial.

**Versão do documento:** 3.6.0
**Última atualização:** 2026-05-22 (knowledge base do produto em `src/llm/knowledge.produto.ts` injetado no `responderConversacional` — LLM passa a responder dúvidas sobre regras do bolão, multi-palpite, edição/apagamento, ranking, etc. sem alucinar)
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
│   │   ├── conversational.responder.ts  # Smart-fallback (resposta livre, sem inventar) — system prompt embute KNOWLEDGE_PRODUTO
│   │   ├── copa.ground.ts           # Grounding Copa 2026: detecta entidade + monta bloco [FATOS VERIFICADOS] do JSON oficial; recusa fora-de-escopo
│   │   └── knowledge.produto.ts     # Knowledge base do produto (v3.6.0): pontuação, multi-palpite, editar/apagar, ranking, comandos, escopo, privacidade — injetado SEMPRE no system prompt do responderConversacional
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
│   │   ├── notificacao/
│   │   └── copa-2026/
│   │       └── index.ts             # API consultada por código: getGrupoDoTime, getProximosJogosDoTime, getComposicaoGrupo, getEstadios, normalizarNomeTime (dicionário PT↔EN+aliases das 48 seleções)
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
│   │   ├── fifa-2026-fixtures.json  # legacy: 72 jogos da fase de grupos (formato consumido por fifa.fetcher.ts)
│   │   └── copa-2026/               # novo (v3.4.0): snapshot canônico do openfootball/worldcup.json
│   │       ├── matches.json         # 104 jogos (grupos + mata-mata até a final)
│   │       ├── teams.json           # 48 seleções (nome PT, bandeira emoji, código FIFA, grupo, confederação)
│   │       ├── stadiums.json        # 16 estádios (cidade, país, fuso, capacidade)
│   │       └── metadata.json        # fonte + timestamp do snapshot
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
│   ├── sync-copa-2026.mjs           # Baixa do openfootball/worldcup.json e regenera src/data/copa-2026/* + fifa-2026-fixtures.json (npm run sync:copa-2026)
│   ├── test-gemini.ts               # Smoke test do Gemini real
│   ├── test-conversational.ts       # Smoke test do conversacional + grounding
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
- **Retry automático no Gemini** (v3.3.1): até 3 tentativas em HTTP 503 ("model
  overloaded"), 429 ("rate limit"), 408 ("server timeout") e timeouts locais.
  Backoff: 400ms, 1200ms. Gemini Flash Lite frequentemente retorna 503 em pico
  de demanda — sem retry, o caller via null + fallback Ollama; com retry, ~90%
  das chamadas se resolvem no Gemini mesmo.
- **Timeout padrão 8000ms** (era 5000ms): Gemini sob carga responde em 4-7s.

### 6.3 Os 4 callers (em `src/llm/`)

| Caller | Quando dispara | System prompt |
|--------|---------------|---------------|
| `intent.classifier.classificarIntencao` | regex falhou (camada 2) | `INTENT_CLASSIFIER_PROMPT` — escolhe 1 de 19 intents, threshold 0.55 |
| `palpite.extractor.extrairPalpites` | janela de palpite livre OR multi-palpite OR fluxo de palpite com texto NL | `PALPITE_EXTRACTOR_PROMPT` — entende "perde de", "ganha por", "empate em N" |
| `bolao.matcher.escolherBolaoDaLista` | usuário responde escolha de bolão em texto livre ("o da firma") | `BOLAO_MATCHER_PROMPT` — primeiro tenta `parseEscolhaBolao` (índice/código/fuzzy), só cai no LLM se nada bater |
| `bolao.matcher.interpretarSimNao` | confirmações sim/não em estados CONFIRMANDO_* | `SIM_NAO_PROMPT` |
| `conversational.responder.responderConversacional` | (a) handler do `PERGUNTA_GERAL_FUTEBOL` — sempre via grounding Copa 2026 (ver 6.6); (b) smart-fallback final em IDLE quando regex+classifier falham | `RESPONDER_PROMPT` reescrito em v3.4.0: proíbe afirmar fatos de Copa 2026 que não estejam no bloco `[FATOS VERIFICADOS]` injetado pelo caller. Assinatura ganhou 2º parâmetro `bloqueFatos?` que é prepended na user message. |

### 6.4 System prompts (centralizados em `system-prompts.ts`)

- `BASE_CONTEXT` — quem é o bot, regras de pontuação resumidas, regras de "não inventar"
- 4 prompts especializados compõem com BASE_CONTEXT
- `RESPONDER_PROMPT` em `conversational.responder.ts` (não em system-prompts.ts) tem a regra-ouro anti-alucinação da Copa 2026 (v3.4.0)

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
| `llm.conversational.fora_escopo` | Grounding (`copa.ground.ts`) recusou pergunta fora de Copa 2026 ANTES de chamar LLM |
| `llm.conversational.ground.{TIME,GRUPO,DATA,ESTADIO_SEDE,GERAL_COPA,AMBIGUO}` | Motivo do grounding — qual entidade foi detectada na pergunta |
| `msg.nao_entendi` | caiu no "não entendi" final |

Amostras de mensagens não roteadas: a partir de **v3.2.0** vão pra tabela
Prisma `mensagens_nao_entendidas` (persistência indefinida até job mensal
de limpeza). Antes ficavam em Redis com TTL 30d. Ver seção 17 pra detalhes.

### 6.6 Grounding da Copa 2026 (`src/llm/copa.ground.ts`) — v3.4.0

**Por que existe**: até v3.3.x, o `responderConversacional` autorizava o
Gemini a responder perguntas sobre Copa 2026 "usando conhecimento próprio
+ disclaimer". Resultado típico em prod: usuário perguntou "quais
próximos jogos da Inglaterra?" e bot respondeu **"Inglaterra tá no grupo
C da Copa 2026, junto com EUA, Irã e uma equipe que ainda vai se
classificar"** — tudo errado (Inglaterra está no Grupo L; o Grupo C é
Brasil/Marrocos/Haiti/Escócia; Irã está no Grupo G; "equipe que vai se
classificar" é nonsense pra fase de grupos). Gemini-flash-lite alucina.

**Solução**: camada de "grounding" determinística que roda ANTES da LLM:

1. `construirFatosCopa2026(texto)` extrai entidades da pergunta do
   usuário (time/grupo/data/sede) usando regex + dicionário PT↔EN das
   48 seleções (sem LLM, latência ~ms).
2. Constrói um bloco `[FATOS VERIFICADOS — Copa 2026, fonte:
   openfootball, atualizado em YYYY-MM-DD]` com os dados oficiais do
   JSON em `src/data/copa-2026/`.
3. O bloco é injetado na **user message** (não no system) — o modelo
   passa a tratar os fatos como contexto da pergunta dele, e o
   `RESPONDER_PROMPT` proíbe afirmar qualquer fato fora do bloco.
4. Detecta também **fora-de-escopo** (Libertadores, Brasileirão, jogos
   de clube, jogador específico, copas antigas) e recusa ANTES de
   chamar a LLM, com mensagem cordial via `respostaForaDeEscopo()`.

**Fonte de dados**: snapshot do
[openfootball/worldcup.json](https://github.com/openfootball/worldcup.json/tree/master/2026)
(domínio público, sem API key). Atualiza via `npm run sync:copa-2026` —
script baixa os 4 JSONs oficiais e regenera `src/data/copa-2026/*` + o
legacy `fifa-2026-fixtures.json`. Re-rodar quando openfootball publicar
mudança (mata-mata após sorteio das chaves, ajustes de data/estádio).

**Por que não FIFA.com direto**: fifa.com retorna HTTP 403 pra User-Agent
de bot, é SPA Next.js (precisaria de Playwright = +200MB Chromium no
container) e não tem API pública oficial (`api.fifa.com` é interno e
instável). openfootball é a mesma fonte usada por jornalistas, gratuita,
hospedada no GitHub, mantida pela comunidade.

**Cobertura**: só Copa do Mundo 2026. Brasileirão, Libertadores,
Champions, jogadores específicos e copas antigas são recusados com
elegância — "Meu foco aqui é Copa 2026 e o seu bolão".

**Motivos de classificação** (logados em `[handlePerguntaGeralFutebol]`
e contados via métricas `llm.conversational.ground.*`):

| Motivo | Quando dispara | Bloco gerado |
|--------|----------------|---|
| `TIME` | mensagem cita uma seleção da Copa | Grupo + adversários + próximos 3 jogos do time |
| `GRUPO` | "grupo C", "grupo D", etc | Composição do grupo + 6 jogos da fase de grupos |
| `DATA` | "quando começa", "qual a data da final", etc | Data de início, final, formato do torneio |
| `ESTADIO_SEDE` | "sede", "cidade", "estádio", "onde", "país sede" | Lista de cidades por país (Canadá/EUA/México) |
| `GERAL_COPA` | "copa 2026", "mundial", "world cup" sem entidade | Visão geral: 48 seleções, 12 grupos, 104 jogos, datas marco |
| `AMBIGUO` | Não detectou nada específico, mas LLM ainda recebe contexto geral | Visão geral (como fallback) |
| `FORA_DE_COPA` | Libertadores, Brasileirão, clube, jogador, copa antiga | `null` (recusa antes da LLM via `respostaForaDeEscopo()`) |

### 6.7 Knowledge base do produto (`src/llm/knowledge.produto.ts`) — v3.6.0

**Por que existe**: até v3.5.x o `responderConversacional` não tinha
fato nenhum sobre o produto no system prompt. Quando o user perguntava
*"posso mandar vários palpites de uma vez?"*, *"dá pra editar palpite?"*,
*"como funciona o desempate do ranking?"*, *"é grátis?"* — a LLM chutava
de cabeça (ou dizia "não sei"). Como o `conversational.responder` é o
smart-fallback de TUDO que regex/classifier não capturaram (smart-fallback
IDLE + handler de `PERGUNTA_GERAL_FUTEBOL`), o impacto era grande.

**Solução**: arquivo dedicado `knowledge.produto.ts` exporta a constante
`KNOWLEDGE_PRODUTO` — texto compacto (~1500 chars / ~500 tokens) com
fatos verificáveis do produto:

- **Pontuação** (10/7/5/3/0) com exemplos de cada categoria
- **Prazo de palpite**: trava no kickoff de cada jogo (Copa) / 1º jogo da rodada (geral)
- **Multi-palpite**: vários numa mensagem, separados por vírgula ou linhas
- **Editar/apagar** palpite com comandos exatos (`corrigir palpite`, `apagar palpite`)
- **Ranking**: ordem por pontos, atualiza por hora, desempate por nº de palpites + ordem de entrada
- **Multi-bolão + bolão padrão**
- **Admin / convite / ID curto (#ABCD12)** — NÃO usa senha
- **Custo grátis**, sem premium nem propaganda paga
- **Escopo**: só Copa 2026; NÃO cobre Brasileirão/Libertadores/etc, NÃO mostra placar ao vivo nem TV
- **Lista de comandos rápidos** (próximos jogos, mais jogos, regras, etc.)
- **Privacidade**: palpite é privado

**Onde é injetado**: no system message do `responderConversacional`,
acoplado ao final do `RESPONDER_PROMPT` (com cabeçalho `[REGRAS DO BOT]`
e marcador `[FIM DAS REGRAS DO BOT]`). Sempre presente — sem detector,
sem condicional. Custo extra: ~500 tokens por chamada conversacional
(que é uma fração das mensagens — só as que não casam regex/intent
dedicada).

**Regra-ouro adicionada ao prompt**: "Sobre o BOT/BOLAO: voce SO pode
afirmar regras que estejam em [REGRAS DO BOT] abaixo. Se a pergunta não
tem resposta lá, diga 'essa eu não sei te responder direito — manda
*ajuda* pra ver as opções' e siga." Análogo à regra anti-alucinação da
Copa 2026, mas pro produto.

**Como evitar drift**: `tests/unit/knowledge.produto.test.ts` (14
testes) checa que o knowledge bate com `PONTUACAO_PADRAO` (10/7/5/3/0)
e cobre cada uma das áreas acima — se alguém mudar a pontuação no código
e esquecer do knowledge, o teste quebra. Toda mudança de regra do
produto precisa atualizar o knowledge + os testes correspondentes.

**O que NÃO está aqui**:
- Dados dinâmicos (palpites/ranking/pontos do user) — vêm do banco via comandos
- Dados da Copa 2026 — vêm via `copa.ground.ts` (RAG do JSON oficial)
- Texto de boas-vindas / mensagens fixas — em `regras.text.ts`

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
| `RANKING` | "ranking", "tabela", "quem ta na frente", **"quero ver o ranking", "ver o ranking", "me mostra a tabela"** (bug Jeni 17/05) | hourly ranking do bolão. `extrairNomeBolaoDoRanking` faz strip robusto pra extrair só o nome real se o user passou algum |
| `MEUS_PONTOS` | "meus pontos", "minha pontuação" | mostra pontos + pergunta se quer ver palpites |
| `MEU_PALPITE` | "meus palpites", "o que palpitei" | mostra histórico (após confirmação) |
| `JOGOS_HOJE` | "jogos hoje", "agenda" | jogos do dia |
| `PROXIMOS_JOGOS` | "próximos jogos", "quero palpitar", "bora dar palpites" | Mostra lote de até **10 jogos cronológicos** abertos da rodada de cada bolão ativo. Reseta paginação (offset=0). Rodapé honesto com contador "X–Y de Z, faltam W no bolão". Abre janela palpite livre (5min). |
| `MAIS_JOGOS` (v3.5.0) | "mais jogos", "mais palpites", "próximos 10", "outros jogos", "tem mais jogos?", "ver mais", "continuar palpitando" | Avança paginação em +10 a partir do offset salvo em Redis (TTL 60min). Quando estoura o total, volta pro topo com aviso. Usado pra paginar lotes da rodada de Copa (72 jogos da fase de grupos). |
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
| `AGRADECIMENTO` | "obrigado/a", "valeu", "vlw", "brigado/a", "thanks", "tmj", "agradecido" | cordialidade curta randomizada — não reabre menu (bug Jeni 17/05) |
| `DESPEDIDA` | "tchau", "flw", "falou", "fui", "abraço", "abs", "bjs", "até logo/mais/amanhã" | resposta curta de saída sem reabrir menu (Sprint 3) |
| `CUMPRIMENTO_CASUAL` | "tudo bem?", "blz?", "td certo?", "como vai?", "como ta?", "suave?", "firmeza?" | responde + sugere ações leves ("quer ver ranking ou palpitar?") |
| `CONCORDANCIA_CASUAL` | "ok", "beleza", "blz", "show", "fechou", "perfeito", "top", "entendi", "saquei" | acknowledgement curto. Em `CONFIRMANDO_*` o FSM pega antes via `interpretarSimNao` (vira SIM); só dispara em IDLE. |
| `RISADA` | "kkkk", "rsrs", "hahaha", "huehue", "😂", "🤣" | emoji curto, sem menu |
| `PERGUNTA_GERAL_FUTEBOL` | "quais próximos jogos da Inglaterra?", "em que grupo o Brasil está?", "quando começa a Copa?", "quais cidades vai ser?", "qual o grupo C?" | Passa pelo **grounding Copa 2026** (`copa.ground.ts`): se for fora de escopo (Libertadores/Brasileirão/clube/jogador), recusa cordialmente antes da LLM. Se for sobre Copa 2026, monta bloco `[FATOS VERIFICADOS]` do JSON oficial e injeta na user message — LLM responde só com os fatos verificados. (v3.4.0 corrigiu alucinação de v3.3.0) |
| `APROVAR` / `RECUSAR` | `!aprovar Nome` / `!recusar Nome` | ações admin explícitas |
| `PENDENTES` | "pendentes", "tem pedido pra aprovar" | lista pedidos pendentes |
| `CANCELAR` | "cancelar", "sair", "esquece" | reset FSM + menu |
| `TEXTO_LIVRE` | (fallback) | passa pra camada 2 (LLM) |

**Ordem do matching em `INTENT_RULES`**: `AGRADECIMENTO → DESPEDIDA →
CUMPRIMENTO_CASUAL → CONCORDANCIA_CASUAL → RISADA → REGRAS → INFO_SENHA →
EXCLUIR_BOLAO → ... → CRIAR_BOLAO → ENTRAR_BOLAO → RANKING`. Cordialidade no
topo pra mensagens curtas/sociais não caírem em SAUDACAO via fallback LLM
(reabrindo menu). Patterns são restritivos (`^...$`) pra não comer
palavras incidentais em frases longas.

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
| `CONFIRMANDO_PALPITE_MULTI_BOLAO` | palpite único casou em >1 bolão (ISSUE-015) | `handleConfirmandoPalpiteMultiBolao` — preview "vai aplicar em N bolões" + sim/não/refazer (bug Jeni 17/05, antes registrava direto) | `IDLE` |
| `CONFIRMANDO_APROVAR_TODOS` | "aprovar todos" detectado | `handleConfirmandoAprovarTodos` | `IDLE` |
| `CONFIRMANDO_RECUSAR_TODOS` | "recusar todos" detectado | `handleConfirmandoRecusarTodos` | `IDLE` |
| `CONFIRMANDO_RECUSAR_NOMEADO` | "recusar Fulano" detectado | `handleConfirmandoRecusarNomeado` | `IDLE` |

### 8.1 FSM escape (interrupção de estado)

Quando o usuário está num estado de "leitura/escolha" e manda **intent forte**
(ex: `RANKING`, `CRIAR_BOLAO`, `MEUS_BOLOES`), o estado anterior é abandonado
silenciosamente. Implementado em `escapouFsmStaleParaNovaIntent`.

**Estados protegidos** (NÃO interrompem): `CRIANDO_BOLAO_*`, `PALPITANDO`,
`CONFIRMANDO_PALPITES_INLINE`, `CONFIRMANDO_PALPITE_MULTI_BOLAO`,
`CONFIRMANDO_EXCLUSAO_BOLAO`, todos os
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

// Sprint 3: histórico persistente de mensagens não-entendidas (LGPD-friendly)
// Substitui a antiga lista Redis (TTL 30d, 500/dia). Persistência indefinida
// até o job mensal de limpeza derrubar registros > MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS.
model MensagemNaoEntendida {
  id              String   @id @default(uuid())
  usuarioId       String?  // FK opcional — ON DELETE SET NULL
  whatsappIdHash  String   // sha256(whatsappId).slice(0,16) — NUNCA em claro
  texto           String   @db.Text  // truncado em 500 chars
  state           String                 // estado FSM no momento
  motivo          String   // 'regex_fail' | 'llm_fail' | 'final_fallback' | 'low_confidence'
  llmIntent       String?  // intent que LLM tentou (mesmo low-conf)
  llmConfianca    Float?   // 0-1
  criadoEm        DateTime @default(now())
  @@index([criadoEm])
  @@index([motivo, criadoEm])
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
| `extrairNomeBolaoDoRanking` faz strip robusto de frases naturais antes de buscar bolão | `command.router.ts` | Bug Jeni 17/05: `raw.replace(/^ranking\s*/i, '')` só removia "ranking" no início, então "Quero ver o ranking" virava o nome do bolão buscado. Agora enumera prefixos/verbos/triggers e devolve o resíduo (vazio → bot pergunta qual bolão). |
| Multi-bolão auto-apply (ISSUE-015) **passa por confirmação** com preview dos bolões | `command.router.ts:handleConfirmandoPalpiteMultiBolao` | Antes registrava direto sem preview. Agora bot mostra "vai aplicar em N bolões" + sim/não/refazer. |
| `AGRADECIMENTO` no topo de `INTENT_RULES` | `message.parser.ts` | Sem isso, "obrigada" caía em SAUDACAO (via LLM fallback) e bot reabria o menu — UX desconectada. |
| **Pergunta geral de futebol NÃO vira comando do bolão** | `message.parser.ts:PROXIMOS_JOGOS_PATTERNS` (negative lookahead) + `PERGUNTA_GERAL_FUTEBOL_PATTERNS` + `conversational.responder.ts` (prompt reescrito) | Bug VPS 18/05: "Quais próximos jogos da Inglaterra?" virava `handleProximosJogos` do bolão do user, e "Qual canal passa o Brasil?" virava "não entendi". Patterns ambíguos como `\bproximos? jogos?\b` ganharam negative lookahead `(?!\s+d[aoe]\s+\w)` — não matcham quando seguidos por "da/do/de + entidade". LLM responder ganhou autorização explícita pra responder perguntas gerais de futebol usando conhecimento próprio. |
| **Resposta sobre Copa 2026 não pode alucinar grupo/data/adversário/estádio** | `src/llm/copa.ground.ts` + `src/modules/copa-2026/` + `src/data/copa-2026/*.json` + `RESPONDER_PROMPT` em `conversational.responder.ts` | Bug VPS 21/05: Gemini afirmou "Inglaterra está no Grupo C com EUA e Irã" — falso (Grupo L com Croácia/Gana/Panamá). v3.4.0 transformou o caminho de PERGUNTA_GERAL_FUTEBOL em RAG: grounding determinístico monta `[FATOS VERIFICADOS]` do JSON oficial (openfootball) antes da LLM, prompt proíbe afirmar qualquer fato fora do bloco. Fora-de-escopo (Libertadores/Brasileirão/clube/jogador) é recusado antes da LLM. |
| **Nome de bolão sozinho NÃO vira CRIAR_BOLAO** | `command.router.ts:tentarOferecerMenuContextualPorNomeBolao` + `system-prompts.ts` (prompt restritivo) | Bug Humberto 18/05: "Bolao teste oficial" virou CRIAR_BOLAO no LLM classifier (sem verbo). Antes do dispatch de CRIAR_BOLAO, fuzzy-match com bolões que o user participa → menu contextual ("você já participa, quer ranking/meus palpites/etc?"). Prompt LLM agora exige verbo de ação. |
| **FSM escape em `CRIANDO_BOLAO_NOME` e `CRIANDO_BOLAO_SENHA`** | `command.router.ts:tentarFsmEscapeCriandoBolao` | Bug Humberto 18/05: user no estado de criação mandou "Proximos jogos" tentando ver agenda — virou nome do bolão. Agora `parseIntencao` roda no input; se bate intent forte (PROXIMOS_JOGOS/RANKING/MEUS_BOLOES/AJUDA/etc), auto-cancela criação + reprocessa via `handleIncomingMessage`. |

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
| `limpar-mensagens-antigas` | `0 5 1 * *` | LGPD: deleta registros de `mensagens_nao_entendidas` mais antigos que `MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS` (default 180). Roda dia 1 de cada mês às 05:00. |
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

## 17. Métricas / Observabilidade (ISSUE-008 + Sprint 3)

Duas camadas:

### 17.1 Contadores agregados (Redis, TTL 30d)

`src/utils/metrics.ts` — hash diário em `metrics:YYYY-MM-DD`. Função
`incContador(nome)`. Convenções de nomes: `msg.total`, `msg.nao_entendi`,
`intent.<NOME>`, `llm.intent.classifier.{hit,miss,low_conf}`, `llm.conversational.{hit,miss}`,
`admin.<acao>`. Consulta via `lerMetricasDoDia()` ou `redis-cli HGETALL`.

### 17.2 Mensagens não-entendidas (Postgres, retenção configurável)

**Tabela `mensagens_nao_entendidas`** (Sprint 3) substitui a antiga lista
Redis. Persistência indefinida até o job mensal de limpeza
(`MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS`, default 180). Captura 4 motivos:

| Motivo | Quando |
|--------|--------|
| `regex_fail` | Camada 1 (regex) não casou nenhuma intent — atualmente não disparado explicitamente (cai pra LLM antes) |
| `llm_fail` | Smart-fallback respondeu mas regex e classifier falharam — bot escapou via conversational responder |
| `final_fallback` | Tudo falhou — bot mostrou "não entendi" cru |
| `low_confidence` | **LLM classifier tentou classificar mas confiança < 0.55**. **Ouro pra descobrir variantes que merecem virar regex novo.** Captura também `llmIntent` (chute do LLM) + `llmConfianca`. |

**LGPD**: `whatsappId` nunca persistido em claro — só hash sha256-16
(`hashIdentificador()` em metrics.ts). FK `usuarioId` opcional com
`ON DELETE SET NULL` — se admin deletar conta, log fica anônimo mas não
é deletado.

**Consultas úteis:**

```sql
-- Top motivos da última semana
SELECT motivo, COUNT(*) FROM mensagens_nao_entendidas
WHERE "criadoEm" > NOW() - INTERVAL '7 days'
GROUP BY motivo ORDER BY COUNT(*) DESC;

-- Variantes de RANKING que o LLM "achou que era ranking" mas não tinha certeza
-- (ouro pra criar regex novo)
SELECT texto, "llmConfianca" FROM mensagens_nao_entendidas
WHERE motivo = 'low_confidence' AND "llmIntent" = 'RANKING'
ORDER BY "criadoEm" DESC LIMIT 20;

-- Usuários distintos no fallback (hash)
SELECT "whatsappIdHash", COUNT(*) FROM mensagens_nao_entendidas
WHERE "criadoEm" > NOW() - INTERVAL '30 days'
GROUP BY "whatsappIdHash" ORDER BY COUNT(*) DESC LIMIT 10;
```

### 17.3 Logs estruturados

| Prefixo | Onde | O que loga |
|---------|------|------------|
| `[timing]` | toda mensagem | `waId=... intent=... state=... user=Xms session=Yms parse=Zms dispatch=Wms total=Tms` |
| `[llm]` | toda chamada LLM | `provider=gemini model=... latency=Xms ok` |
| `[smart-fallback]` | LLM responder funcionou | `waId=... regex_intent=X llm_intent=Y llm_tried=Z conf=N` |
| `[nao-entendi]` | tudo falhou | `text=... llm_tried=Z conf=N` (truncado em 200 chars) |
| `[fsm-escape]` | estado interrompido | `state=X → IDLE (nova intent=Y)` |
| `[multi-palpite]` | parse multilinha | `ok=N descartadas=M` |
| `[webhook-debug]` | toda request webhook | dados do payload Evolution |
| `[limpar-mensagens-antigas]` | job mensal | `removidos: N (>180d)` |

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
| 3.1.2 | 2026-05-17 | Patch da migration de unique-por-rodada. Descoberto em deploy local: o `@unique` original do init migration foi materializado como `CREATE UNIQUE INDEX "jogos_apiJogoId_key"`, não como `ALTER TABLE ADD CONSTRAINT`. Por isso o `DROP CONSTRAINT IF EXISTS` da migration anterior era no-op silencioso e o índice unique global ficava órfão, ainda bloqueando inserts cross-bolão. Novo migration `20260517170000_drop_jogos_apijogoid_unique_index` executa `DROP INDEX IF EXISTS`. Bolão `#K6VCCJ` (legacy quebrado) reparado com sucesso após apply. Novo script `scripts/run-repair-once.ts` permite disparar o reparo sob demanda sem subir o servidor. |
| 3.1.3 | 2026-05-18 | Hotfixes UX pós-feedback Jeni: (a) `RANKING` intent agora aceita frases naturais como "Quero ver o ranking", "Ver o ranking", "me mostra a tabela" via padrões regex novos + `extrairNomeBolaoDoRanking` que faz strip robusto pra não usar a frase inteira como nome do bolão; (b) Nova intent `AGRADECIMENTO` ("obrigada/o", "valeu", "vlw", "brigado/a", "thanks", "tmj") com handler curto e amigável randomizado — não reabre o menu como SAUDACAO fazia; (c) ISSUE-015 (auto-apply multi-bolão) agora passa por confirmação `CONFIRMANDO_PALPITE_MULTI_BOLAO` com preview dos N bolões antes de registrar. Removido dead code `registrarPalpiteInline`. 342 tests (era 322), 85 cenários (era 75). |
| 3.2.1 | 2026-05-18 | Hotfix 4 bugs Humberto: (1) "Pontuação" sozinho ia pra RANKING("pontuacao") — MEUS_PONTOS_PATTERNS ampliado. (2) "Ajuda" mostrava texto legado com `!comandos` — `formatAjuda` reescrito. (3) "Bolao teste oficial" virava CRIAR_BOLAO espúrio — fuzzy match contextual antes de iniciar criação + LLM prompt restritivo. (4) "Proximos jogos" no CRIANDO_BOLAO_NOME virava nome — FSM escape novo. 384 tests, 106 cenários. |
| 3.3.0 | 2026-05-18 | Nova intent `PERGUNTA_GERAL_FUTEBOL` + LLM responder reescrito. Bug reportado da VPS: usuário perguntava "Quais próximos jogos da Inglaterra?" — bot respondia "não faz parte de nenhum bolão". Fix: nova intent + regex negative lookahead + handler dedicado + responder prompt autorizado a usar conhecimento geral. 397 tests, 116 cenários. |
| **3.6.0** | **2026-05-22** | **Knowledge base do produto no LLM conversacional — fim das dúvidas mal respondidas sobre o bolão.** Sintoma reportado: usuário perguntou "posso mandar vários palpites de uma vez?" e o bot não soube responder corretamente. Diagnóstico: o `responderConversacional` (smart-fallback do IDLE + handler de PERGUNTA_GERAL_FUTEBOL) não tinha fato nenhum sobre o produto no system prompt — LLM chutava ou dizia "não sei". **Fix**: novo arquivo `src/llm/knowledge.produto.ts` exporta `KNOWLEDGE_PRODUTO` (~1500 chars) com bullets verificáveis: pontuação 10/7/5/3/0 com exemplos, prazo de palpite (até kickoff de cada jogo), MULTI-PALPITE (várias por mensagem com vírgula/linhas), editar/apagar palpite + comandos exatos, ranking + critério de desempate, multi-bolão + bolão padrão, admin/convite/ID curto (não senha), custo grátis, escopo Copa 2026 + lista do que NÃO cobre, comandos rápidos, privacidade. Injetado SEMPRE no system prompt do `responderConversacional` (sem detector — robustez supera economia de ~500 tokens). `RESPONDER_PROMPT` ganhou seção "DUAS FONTES DE FATOS" diferenciando [REGRAS DO BOT] (produto) de [FATOS VERIFICADOS] (Copa 2026). Regra-ouro anti-alucinação ampliada pra cobrir regras do produto. Novo `tests/unit/knowledge.produto.test.ts` com 14 testes anti-drift (bate o knowledge contra `PONTUACAO_PADRAO` do código + verifica cobertura de cada área). **461 tests (era 447), 14 novos.** |
| **3.5.0** | **2026-05-22** | **Paginação honesta de PROXIMOS_JOGOS + nova intent MAIS_JOGOS.** Bug reportado (Joao Arruda, 21/05): bot mostrou 10 jogos com o rótulo "Todos os palpites desta rodada já estão registrados! 🍀" depois que ele palpitou nos 10 — **falso**, porque a rodada da fase de grupos tem 72 jogos e ele só viu os 10 mais cedo (filtro `take: 10` no `command.router.ts:3414`). **Fix**: (1) `handleProximosJogos` removeu o `take` da query, busca toda a rodada e faz slice no JS com offset persistido no Redis (`pj_offset:{waId}:{bolaoId}`, TTL 60min). (2) Nova intent `MAIS_JOGOS` com 12 padrões regex ("mais jogos", "mais palpites", "próximos 10", "outros jogos", "tem mais jogos?", "ver mais", "continuar palpitando", etc.) — handler avança offset +10, volta pro topo quando estoura. (3) Mensagem reescrita com **contador honesto**: "Mostrando jogos X–Y de Z. Palpites seus neste lote: N/lote. Faltam W palpite(s) no bolão." (4) **Cutucada inline automática** (`talvezOferecerMaisJogos`): após registrar palpite, se o user fechou todos os jogos do último lote visto E ainda há pendentes na rodada, bot oferece o próximo lote ("Fechou esses 10 👏 Ainda tem X jogos abertos. Manda *mais jogos*"). Idempotente via flag Redis (`pj_oferta:`, TTL 30min). (5) Dica de multi-palpite enfatizada: "Pode mandar VÁRIOS palpites de uma vez separados por vírgula". (6) Patterns `MAIS_JOGOS` colocados antes de `PROXIMOS_JOGOS` no `INTENT_RULES` pra ter precedência. **447 tests (era 438), 9 novos cobrindo todos os patterns de `MAIS_JOGOS` + garantia de precedência sobre `PROXIMOS_JOGOS`.** |
| **3.4.0** | **2026-05-22** | **Grounding da Copa 2026 — fim da alucinação em perguntas gerais de futebol.** Bug reportado da VPS em 21/05: usuário perguntou "Quais próximos jogos da Inglaterra?" e bot respondeu "Inglaterra tá no grupo C da Copa 2026, junto com EUA, Irã e uma equipe que ainda vai se classificar" — tudo errado (Inglaterra está no Grupo L com Croácia/Gana/Panamá; Grupo C é Brasil/Marrocos/Haiti/Escócia). Gemini-flash-lite alucinava porque o prompt 3.3.0 autorizava "conhecimento próprio + disclaimer". **Fix**: (1) Novo snapshot canônico em `src/data/copa-2026/` com 4 JSONs do openfootball/worldcup.json (matches.json — 104 jogos grupos+mata-mata; teams.json — 48 seleções com bandeira/código FIFA; stadiums.json — 16 estádios; metadata.json). (2) Novo módulo `src/modules/copa-2026/` com API consultada por código: `getGrupoDoTime`, `getComposicaoGrupo`, `getProximosJogosDoTime`, `getEstadios`, `normalizarNomeTime` (dicionário PT↔EN+aliases). (3) Novo `src/llm/copa.ground.ts` — detector regex/dict pré-LLM monta bloco `[FATOS VERIFICADOS]` injetado na user message; recusa fora-de-escopo (Libertadores/Brasileirão/clube/jogador) ANTES de chamar Gemini via `respostaForaDeEscopo()`. (4) `RESPONDER_PROMPT` reescrito com regra-ouro anti-alucinação: "só pode afirmar fatos da Copa 2026 que estejam no bloco". (5) `responderConversacional` ganhou 2º param `bloqueFatos?`. (6) `handlePerguntaGeralFutebol` agora chama o grounding antes da LLM. (7) Novo `scripts/sync-copa-2026.mjs` (npm run sync:copa-2026) — baixa do GitHub do openfootball, regenera os 4 JSONs + o legacy `fifa-2026-fixtures.json`. **438 tests (era 400), 38 novos testes em `copa-2026.test.ts` (23) + `copa-ground.test.ts` (15) cobrindo bug original, todos os 12 grupos, fora-de-escopo, normalização PT/EN/alias.** |
| **3.3.1** | **2026-05-18** | **Hotfix Gemini 503 + timeout apertado.** Após deploy do 3.3.0 na VPS, usuário recebeu mensagem fallback "assistente fora do ar" mesmo com o caminho LLM correto — porque o **Gemini 2.5 Flash Lite estava retornando HTTP 503 ("This model is currently experiencing high demand")** com frequência alta no Google. Diagnóstico via novo `scripts/test-conversational.ts`. **Fix:** (1) `chatGemini` agora faz **retry automático com backoff** (400ms, 1200ms) em status retryable: HTTP 503, 429, 408, timeouts (até 3 tentativas total). (2) `LLM_TIMEOUT_MS` default subiu de **5000→8000ms** — Gemini sob carga responde em 4-7s; 5s causava abort prematuro. (3) Logs ANTES silenciosos quando `LLM_ENABLED=false` ou `GEMINI_API_KEY` vazia agora geram `[llm] gemini SKIP` — diagnóstico de config errado fica óbvio. (4) Mensagem fallback no `handlePerguntaGeralFutebol` reescrita pra explicar congestionamento momentâneo + sugerir retry. (5) Fallback automático pra Ollama Cloud continua funcionando — se VPS tiver `LLM_API_KEY` real da Ollama configurada, perguntas que falham no Gemini caem nele transparentemente. **400 tests (era 397), 116 cenários, novo `scripts/test-conversational.ts` pra smoke test do fluxo completo.** (este documento) |
| 3.2.0 | 2026-05-18 | **Expansão de cordialidade + histórico persistente.** **4 novos intents de cordialidade**: `DESPEDIDA` (tchau/flw/abraço/fui), `CUMPRIMENTO_CASUAL` (tudo bem?/blz?/como vai?), `CONCORDANCIA_CASUAL` (ok/beleza/show/perfeito — só em IDLE; em CONFIRMANDO_* o FSM pega antes), `RISADA` (kkk/rsrs/hahaha/😂). Cada um com handler dedicado e variantes randomizadas — não reabrem menu. **Nova tabela Prisma `MensagemNaoEntendida`** substitui a antiga lista Redis (TTL 30d) por persistência indefinida queryable via SQL. Captura também casos `low_confidence` (LLM tentou classificar mas ficou < 0.55) com `llmIntent` + `llmConfianca` — ouro pra descobrir variantes que merecem virar regex. `classificarIntencao` mudou de retornar `Intencao\|null` para `ClassificationOutcome` com `intencao` + `intencaoTentada` + `confianca`. LGPD: `whatsappId` nunca em claro — só hash sha256-16; FK `usuarioId` com `ON DELETE SET NULL`; job mensal de limpeza derruba registros antigos via `MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS` (default 180). **377 tests (era 342), 102 cenários (era 85).** (este documento) |
