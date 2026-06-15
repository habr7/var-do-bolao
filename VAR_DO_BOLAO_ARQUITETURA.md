# VAR do Bolão — Arquitetura Técnica

> Bot de WhatsApp para bolão de futebol que opera em **conversa direta** (DM) com
> cada usuário. Não depende de grupos. Sistema é DM-only e híbrido **regex → LLM**
> para entender mensagens em português coloquial.

**Versão do documento:** 3.21.0
**Última atualização:** 2026-06-15 (v3.37.1 — Palpites com separador × (unicode) e "c" (typo de x) agora parseiam; palpite incompleto "Espanha 4x1" pede o adversário. v3.37.0 — Fix grave: placar de Costa do Marfim x Equador (e Irã/RD Congo) nunca atualizava — o `nome` no teams.json divergia dos fixtures/DB, quebrando o matcher da FIFA (fifaCode→nome→fixture) e o grounding; nomes alinhados + teste de consistência; auto-corrige no próximo tick. v3.36.0 — "Bom dia boleiros" em hora fixa (9h BRT) pra TODOS de uma vez (antes era kickoff-6h e só parte recebia); chamada de palpites desativada (redundante). v3.35.0 — Fix GRAVE: lista rotulada "Meus palpites:\n<jogos>" virava MEU_PALPITE e era ignorada; agora lote de 2+ palpites vence intent de leitura, e prefixo de data/hora do formato do bot é removido. v3.34.0 — Fix GRAVE: palpites separados por VÍRGULA não registravam (caso Felipe) — parser só dividia por \n; agora aceita vírgula/; (formato que o bot anuncia). v3.33.0 — Fix GRAVE de display: "meus palpites" mostrava jogo AO VIVO como final com "0 pts ❌" (placar parcial da FIFA tratado como oficial); render agora decide pelo status. v3.32.0 — Estrutural: whitelist do classificador LLM completada (+teste anti-drift), [DADOS AO VIVO] no smart-fallback (LLM responde placar/rolando com dado real), patterns "rolando agora", e revisão diária automática das não-entendidas pro dono. v3.31.0 — Lembrete por JOGO ~30min antes do kickoff pra quem não palpitou (com idempotência por jogo + cooldown + cap); send-reminders por-rodada desativado por redundância. v3.30.0 — Fix "sair do bolão" pra quem é admin de um e participante de outro: agora explica por que o bolão-admin não aparece + aceita "sair do bolão X" inline. v3.29.0 — Fix matching de abreviação de times: "Coreia 1x0 Rep Checa" agora acha "Coreia do Sul x República Tcheca" [alias + token-match + fallback LLM restrito que só traduz nomes]. v3.28.0 — Auditoria do código, Tier 1+2: paginação do "meus palpites"; criação de bolão sem senha; cap de avisos atômico + lock nos jobs de pontuação; recalcularRanking sem N+1; índices em hot paths; revelação avisa quando corta. v3.27.0 — UX pós-início da Copa: "meus palpites" agrupado por data; "próximos jogos" pergunta filtro [só pendentes/todos] com novo estado FSM; perguntas de placar/finalizados casam PLACAR_JOGO em vez de cair na LLM; "placares dos demais" revela palpites de jogo já iniciado sem janela de 24h. v3.26.2 — Fix ranking sob demanda fora de ordem em empate (caso "1,2,3,5,4"): ordenação determinística por cascata + posição derivada do índice. v3.26.1 — Copy de latência atualizada pro placar AO VIVO da FIFA: removidas as mensagens antigas de "placar oficial em ~1h após o apito" / "placar ao vivo não existe"; agora dizem placar ao vivo + pontos poucos min após o apito final. v3.26.0 — Broadcast administrativo: dono manda `#ENVIOPARAVARDOBOLAO# msg` no WhatsApp e dispara pra todos os usuários [modo-teste envia só pro dono]; interceptado no topo do pipeline, idempotente e com throttle. v3.25.0 — Palpite com times INVERTIDOS [ex: "República Tcheca 2x0 Coreia do Sul" pro jogo "Coreia x Tcheca"] agora é entendido: matching tolera ordem trocada e arruma nomes+placar na confirmação. v3.24.0 — Revelação de palpites no kickoff: quando o jogo começa, manda pros integrantes os palpites de todos do bolão pra aquele jogo [push job time-driven + resposta sob demanda no PALPITE_OUTROS]. Privacidade vira TEMPORAL [privado antes, revelado depois]. `MAX_AVISOS_DIA` 2→8. v3.23.0 — Janela de polling [API só na janela ativa do jogo]. v3.22.0 — Placar AO VIVO via `api.fifa.com` + provider `hybrid`. 806 tests)
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
[criar bolão]  (v3.28.0 — sem passo de senha)
  usuário → bot: "criar bolão"
  bot: "qual o nome?"               ← state CRIANDO_BOLAO_NOME
  usuário: "Firma FC"
  bot: cria bolão na hora + ID #ABC123 + link wa.me clicável

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
│   │   ├── palpite/                 # registrarPalpiteEmRodada + status + revelacao.service (revela palpites no kickoff)
│   │   ├── ranking/
│   │   │   ├── ranking.types.ts     # PONTUACAO_PADRAO (10/7/5/3/0)
│   │   │   └── pontuacao.calc.ts    # função pura — testada isolada
│   │   ├── resultado/               # adapters de placar: hybrid (FIFA→openfootball) + fifa.fetcher + openfootball.fetcher
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
│   │   ├── send-reminders.job.ts    # */30min — (DESATIVADO v3.31.0) por-rodada
│   │   ├── send-lembrete-30min.job.ts # */5min — lembrete por JOGO ~30min antes (v3.31.0)
│   │   ├── send-palpite-reveal.job.ts # */2min — revela palpites de todos no kickoff
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
| `PROGRESSO_PALPITES` (v3.8.0) | "quem palpitou?", "quem ainda não palpitou?", "mais gente registrou?", "progresso do bolão", "quem ta atrasado?", "quanto cada um palpitou?" | Lista de cada participante com X/Y palpites na rodada aberta + bloco "ainda não palpitaram". Visível pra qualquer participante. Não revela placar individual (privacidade). |
| `CUTUCAR_PENDENTES` (v3.8.0, admin only) | "cutucar pendentes", "lembrar quem não palpitou", "cobrar palpites", "chamar pendentes" | Admin manda DM personalizada pra cada pendente: "*<Nome do admin>* (admin do *<bolão>*) pediu pra te lembrar de palpitar". Idempotente via flag Redis `cutucar_admin:` (TTL 30min). |
| `DICAS_PALPITE` (v3.9.0) | "tem dicas?", "como monto/decido/escolho palpite", "qual placar é mais comum?", "tem estratégia?", "me ensina a palpitar" | Resposta determinística com pontuação resumida (10/7/5/3/0) + placares mais comuns em Copa (1x0, 2x1, 2x0, 1x1) + 4 dicas práticas (palpita em tudo / foque em vencedor / vai no coração / dá pra editar). Não dá dica de aposta. |
| `PLACAR_JOGO` (v3.15.0) | "qual o placar?", "quanto tá o jogo?", "quem ganhou?", "como ficou o jogo do Brasil?", "saiu o resultado?" | Busca no BANCO (fetch-results atualiza ~5min): jogos AO_VIVO + FINALIZADOS últimas 48h dos bolões do user, filtra por time se mencionado (via grounding), dedup multi-bolão. Fora-de-escopo (copa antiga/clube) delega pro fluxo LLM antigo que recusa. Precedência ANTES de PERGUNTA_GERAL_FUTEBOL. |
| `PONTOS_DETALHE` (v3.15.0) | "quantos pontos fiz ontem?", "acertei meu palpite?", "ganhei pontos?", "pontos de ontem" | Breakdown jogo a jogo (últimas 48h): placar real vs palpite do user + pontos obtidos (`PalpiteJogo.pontosObtidos`) + total no período. Mostra "⏳ calculando" se `Palpite.calculado=false`. Precedência ANTES de MEUS_PONTOS. |
| `STATUS_RODADA` (v3.15.0) | "quando atualiza o ranking?", "quando saem os pontos?", "cadê meus pontos?" | Explica o pipeline (placar ~5min, pontos ~10min após o jogo, ranking na sequência, recalcula sozinho em correção de VAR) + mostra jogo AO_VIVO se houver. |
| `DESABAFO_RANKING` (v3.15.0) | "tô em último", "fui mal demais", "tô perdendo", "nunca acerto", "desisto" | Acolhimento (análogo ao ACOLHIMENTO_NOVATO) + esperança REAL: conta jogos ainda abertos pra palpitar. Lookahead em DESPEDIDA evita "fui mal" ser engolido por "fui" (gíria de tchau). |
| `RECLAMACAO_BUG` (v3.15.0) | "meus pontos estão errados", "tá bugado", "calculou errado", "faltou ponto" | LOGA na MensagemNaoEntendida (motivo `reclamacao_bug` — ouro pra achar bugs reais) + acolhe sem ser defensivo + explica pontuação automática/recálculo + pede o jogo específico se persistir. Precedência ANTES de MEUS_PONTOS. |
| `ACOLHIMENTO_NOVATO` (v3.9.0) | "nao entendo de futebol", "to perdida/perdido", "é minha primeira vez", "nunca palpitei", "to com medo de errar", "vou errar tudo", "sou leiga em bolão" | Resposta acolhedora: "relaxa, não precisa entender nada de futebol" + validação (gente palpita no coração e ganha) + 3 passos básicos + CTAs leves (*dicas*, *regras*, *próximos jogos*). Cobre vulnerabilidade emocional sem cair em menu genérico. |
| `REGRAS` | "regras", "como pontua", "como funciona a pontuação" | `regrasTexto()` |
| `PALPITES_AMBIGUO` | "palpites" (sozinho) | pergunta entre 3 opções (ver/fazer/regras) |
| `INFO_SENHA` | "qual a senha", "esqueci a senha" | explica que bolão usa ID, não senha (ISSUE-005) |
| `EXCLUIR_BOLAO` | "excluir bolão", "encerrar bolão", "deletar" (admin) | fluxo de exclusão com confirmação textual (ISSUE-006) |
| `INFO_PRODUTO` | "o que é esse bot", "pra que serve", "sobre o var" | pitch curto sem LLM (ISSUE-009) |
| `INFO_PRECO` | "quanto custa", "é grátis", "tem que pagar" | "🆓 É grátis" (ISSUE-010) |
| `COMO_PALPITAR` | "como dou palpite", "formato do palpite" | exemplos + dica próximos jogos (ISSUE-017) |
| `QUANDO_COMECA` | "quando começa", "quando termina", "que dia abre rodada" | data próxima rodada (usa bolão padrão) (ISSUE-018) |
| `EDITAR_PALPITE` | "corrigir palpite", "mudar palpite", "errei palpite" + **(v3.7.0)** placar inline "corrigir Brasil 3x1 Marrocos" / "mudar pra Brasil 2x1" / "atualizar Brasil 3 a 1" / "alterar Brasil 2 por 0" | Fluxo: (1) detecta placar inline → atalho de 1 passo (registra direto, mostra "era X, virou Y"); (2) sem placar → pede placar no estado FSM. Fluxo de placar aceita regex + multi-palpite + LLM fallback. Valida jogo individual (recusa se já começou). |
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
| `CRIANDO_BOLAO_NOME` | "criar bolão" | `handleCriandoBolaoNome` → `finalizarCriacaoBolao` | `IDLE` (cria na hora, v3.28.0) |
| `CRIANDO_BOLAO_SENHA` | _(compat)_ sessão stale pré-v3.28.0 | `handleCriandoBolaoSenha` (cria com o nome do ctx) | `IDLE` |
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
| `ESCOLHENDO_FILTRO_PROXIMOS_JOGOS` | "próximos jogos" genérico (v3.27.0) | `handleEscolhendoFiltroProximosJogos` | `IDLE` (lista pendentes ou todos; palpite inline escapa) |
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
| `send-palpite-reveal` | `*/2 * * * *` | No kickoff, revela pros integrantes os palpites de todos do bolão pra aquele jogo. Time-driven, idempotente por `(user, jogo)`, conta no `MAX_AVISOS_DIA`. |
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
FOOTBALL_PROVIDER=hybrid             # hybrid (default) | openfootball | fifa-2026 | mock
FOOTBALL_API_KEY=mock
FOOTBALL_API_URL=https://www.api-futebol.com.br/v1
FIFA_SEASON_ID=285023                # default = FIFA World Cup 2026 (api.fifa.com)

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
| **3.37.1** | **2026-06-15** | **Palpites que falhavam no parse (achados na revisão diária 14/06).** (1) **Separador `×` (U+00D7, teclado de celular)** não era aceito — "Holanda 2 × 2 Japão" caía em "não entendi". (2) **`c` como separador** (typo de `x`, teclas vizinhas) — "Holanda 2 c 2 Japão". Ambos adicionados aos regexes de placar (`×` no char-class; `c`/`C` entre espaços, como o "a"/"por" já existentes). (3) **Palpite INCOMPLETO** (um time só, "Espanha 4x1") → novo `parecePalpiteIncompleto` + resposta pedindo o adversário (em vez de "não entendi"; não dá pra adivinhar — o time joga vários jogos). Os relatos de "Costa do Marfim não atualizou" eram o bug já corrigido na v3.37.0. **9 testes novos** (incl. não-regressão "as 2 da tarde"/"meus pontos"). **953 tests, simulador 116/116.** Sem migration. |
| **3.37.0** | **2026-06-15** | **Fix GRAVE: placar de Costa do Marfim x Equador (e jogos do Irã/RD Congo) nunca atualizava (caso 14/06).** O matcher da FIFA casa por `IdCountry → fifaCode → teams.json.nome (normalizado) → chave do fixture`. Mas o `nome` em `teams.json` divergia do nome nos fixtures/DB/display pra 3 times: **"Cote d'Ivoire"** vs "Costa do Marfim", **"IR Iran"** vs "Irã", **"Congo DR"** vs "RD Congo". Resultado: o par de códigos nunca achava o `apiJogoId` → o `fetch-results` ignorava esses jogos (ficavam "⏳ aguardando placar oficial" pra sempre) — e o grounding (`getTime`) também retornava null. **Fix:** alinhado o `nome` no `teams.json` aos nomes canônicos usados no resto do sistema (Costa do Marfim/Irã/RD Congo) + aliases dos nomes antigos. **Teste de consistência** (`dados-consistencia.test.ts`) trava a classe de bug: todo nome de fixture deve resolver no teams.json e via cadeia de fifaCode — quebra o build se um re-sync reintroduzir. **Auto-correção:** com o nome alinhado, o próximo tick do `fetch-results` (≤5min) casa o jogo, grava 1×0 FINALIZADO e recalcula os pontos — sem edição manual. **3 testes novos.** **944 tests.** Sem migration. |
| **3.36.0** | **2026-06-12** | **"Bom dia boleiros" agora em HORA FIXA, pra TODOS de uma vez (caso 12/06: jogo cedo fazia parte do pessoal ficar sem heads-up).** O bom-dia disparava em "kickoff−6h do 1º jogo" → pra jogo das 10h isso caía 22h da véspera (clamp), e só PARTE recebia; o resto só ouvia o bot no kickoff. Além disso, dividia a trava `aviso_jogo` 24h com a *chamada de palpites* → entrega desigual. **Fix:** bom-dia agora dispara na **hora fixa `HORARIO_BOM_DIA`** (default 09:00 BRT), uma vez/dia, pra **todos** os participantes com jogo nas próximas ~30h, com **flag própria** `bomdia:{waId}:{dia}` (SET NX, não divide trava). Conteúdo adaptativo (já existia): falta palpitar → lembra; palpitou tudo → "🎉 Boa sorte!". **Chamada de palpites (`send-palpite-call`) DESATIVADA** (`ENABLE_PALPITE_CALL` default→false) por ser redundante com bom-dia + lembrete de 30min. Régua do dia: bom-dia 9h (todos) → lembrete 30min (só quem falta um jogo) → revelação no kickoff. `HORARIO_BOM_DIA` voltou a ser usado. **5 testes novos.** **941 tests, simulador 116/116.** Sem migration. |
| **3.35.0** | **2026-06-12** | **Fix GRAVE: lista de palpites rotulada "Meus palpites:" virava MEU_PALPITE e era ignorada (caso +5531 12/06).** A usuária mandou "Meus palpites:\n<10 jogos com placar>" (copiando o formato do bot, com datas "11/06, 23:00 — Time NxN Time") e o bot respondeu "Palpites registrados: 0" — a intent de LEITURA `MEU_PALPITE` sequestrava antes da detecção de submissão. **Fix A (roteamento):** quando há um LOTE (2+ palpites parseáveis), a mensagem vira `PALPITE_INLINE` mesmo começando com frase de leitura — só sobrescreve intents de visualizar/navegar (`INTENTS_LEITURA_SOBRESCRITAS_POR_LOTE`), EDITAR/APAGAR/PLACAR/ações intactas. **Fix B (prefixo):** `stripPrefixoDataHora` remove "DD/MM, HH:MM —" / bullets que o usuário copia do formato do bot (data exige `/`, hora exige `:` → não confunde com o placar "1x1" do formato invertido). Preserva "meus palpites"/"ranking"/"próximos jogos" puros. **8 testes novos.** **936 tests, simulador 116/116.** Sem migration. |
| **3.34.0** | **2026-06-12** | **Fix GRAVE: palpites separados por VÍRGULA não registravam (caso Felipe 11/06 20:44).** Felipe mandou "Coreia 1x1 Tcheca, Canadá 0x2 Bósnia, EUA 1x0 Paraguai" (1 linha, vírgulas), o bot respondeu "Seus palpites foram registrados!" e **não registrou nada** (sumiu da revelação das 23h). Causa: `parseMultiplePalpitesDetalhado` e `parseIntencao` só dividiam por `\n` — vírgula (que o PRÓPRIO bot anuncia como separador!) virava `TEXTO_LIVRE` → 0 palpites extraídos. A mentira "registrados!" era a alucinação do LLM no smart-fallback. **Fix:** split agora por `\n`, `,` e `;` (nomes de seleção não têm vírgula). Verificado que o guard `parecePalpiteMasNaoEntendi` (2+ âncoras) JÁ bloqueia a mentira do LLM — defesa em camadas: (1) parse correto registra, (2) guard bloqueia LLM, (3) system prompt proíbe "registrei". Alinhado o simulador (drift pré-existente "quem ganhou copa de 94"→PLACAR_JOGO). **6 testes novos** (msg exata do Felipe, vírgula/`;`/misto, single intacto). **928 tests, simulador 116/116**. Sem migration. |
| **3.33.0** | **2026-06-12** | **Fix GRAVE de display (caso Humberto 12/06 00:22): "meus palpites" mostrava jogo AO VIVO como FINAL com "0 pts ❌".** O render testava `golsCasa != null` ANTES do status — como a FIFA grava placar PARCIAL ao vivo (ex: Coreia 0x1 enquanto rolava), o jogo aparecia como "oficial: 0x1 ❌ (0 pts)", induzindo o usuário a achar que zerou (quando o gate de pontuação corretamente NÃO pontua jogo não-finalizado, e ao apito 0x1 daria 3 pts / 1x1 daria 10). **A pontuação armazenada estava CERTA — só o display mentia.** Fix: novo renderizador puro `palpite-render.ts:montarStatusResultado` decide o rótulo pelo STATUS (FINALIZADO→"oficial X (N pts)" / "calculando…"; AO_VIVO ou kickoff-passou→"🔴 ao vivo: parcial X — pontua no apito"; ADIADO/CANCELADO/AGENDADO próprios). Rodapé novo no "meus palpites" quando há jogo em aberto. **8 testes novos** (cobrindo o caso exato). **922 tests**. Sem migration. |
| **3.32.0** | **2026-06-12** | **Correção ESTRUTURAL da classe "o bot sabe, mas diz que não sabe" (caso Humberto 11/06 23:49: "Quais jogos estao rolando?" → "não sei" com o jogo AO VIVO no banco).** Trace: regex não casava "estao rolando"; o classificador LLM até devolvia PLACAR_JOGO, mas a whitelist `INTENCOES_VALIDAS` estava congelada na era Sprint 4 e REJEITAVA tudo da v3.8+; o smart-fallback chamava `responderConversacional` SEM o `bloqueFatos` que a função já aceitava. **4 frentes:** (F1) whitelist completada com as 11 intents faltantes (PLACAR_JOGO, PONTOS_DETALHE, STATUS_RODADA, PALPITE_OUTROS, MAIS_JOGOS, PROGRESSO_PALPITES, CUTUCAR_PENDENTES, DICAS_PALPITE, ACOLHIMENTO_NOVATO, DESABAFO_RANKING, RECLAMACAO_BUG) + **teste anti-drift** (`intent.classifier.drift.test.ts`) que compara prompt↔whitelist↔enum e quebra o build se uma intent nova ficar de fora. (F2) **[DADOS AO VIVO]** — novo `llm/fatos-vivos.ts` injeta no smart-fallback um bloco com jogos rolando (placar parcial), finalizados 48h e próximos 5 dos bolões do user; RESPONDER_PROMPT ganhou a 3ª fonte de fatos — mesmo quando o roteamento falha, o LLM responde com o dado real. (F3) patterns "rolando agora" → PLACAR_JOGO ("quais jogos estão rolando/acontecendo", "tem jogo agora/ao vivo", "o que tá rolando"). (F4) **revisão diária automática** — novo `revisao-diaria.job.ts` (cron 09:00 BRT): manda pro(s) dono(s) (OWNER_WHATSAPP_IDS) o relatório das `mensagens_nao_entendidas` das últimas 24h (total por motivo + textos dedupados + intent/confiança tentada) — loop de melhoria sem depender de prints. Env nova `ENABLE_REVISAO_DIARIA`. **20 testes novos**. **914 tests**. Sem migration. |
| **3.31.0** | **2026-06-12** | **Lembrete de última hora POR JOGO (~30 min antes do kickoff) + `send-reminders` desativado.** Novo job `send-lembrete-30min.job.ts` (cron `*/5min`, com `comLockJob`): cutuca quem **ainda não palpitou aquele jogo** quando falta ~`LEMBRETE_30MIN_ANTECEDENCIA_MIN` (30) min. **Anti-spam em camadas:** idempotência por (user,jogo) `lembrete30:{wa}:{jogoId}` 2h + **cooldown por usuário** `lembrete30_cd:{wa}` (`LEMBRETE_30MIN_COOLDOWN_MIN`, default 90 min) + **coalescência** (jogos da janela viram 1 msg) + cap `MAX_AVISOS_DIA` (reserva atômica). NÃO honra a flag `aviso_jogo` 24h (de propósito — é aviso de natureza distinta, tem cooldown próprio). O antigo `send-reminders` (por-rodada, mira quem não palpitou nada) foi **desativado** (`ENABLE_REMINDERS` default→false) por ser redundante e mais propenso a spam — o aviso antecipado segue coberto por *bom-dia* + *chamada de palpites*. Novas envs `ENABLE_LEMBRETE_30MIN`, `LEMBRETE_30MIN_ANTECEDENCIA_MIN`, `LEMBRETE_30MIN_COOLDOWN_MIN`. **7 testes novos**. **894 tests**. Sem migration. |
| **3.30.0** | **2026-06-12** | **Fix: "sair do bolão" confuso pra quem é admin de um e participante de outro (caso Mauricio 11/06).** O usuário tinha 2 bolões (admin do "Bolão da Enter", participante do "Bolao kzados"); `handleSairBolao` filtra `elegiveis = não-admin`, sobrava 1 → confirmava o kzados **direto, sem explicar** que o outro não aparecia por ser admin. Usuário tentou "sair do bolao 2" (ignorado) e ficou em loop. **Fix:** (1) **nota de transparência** — quando há bolão-admin escondido, a confirmação/lista explica "_o bolão *X* não aparece porque você é o admin — pra encerrar, manda *excluir bolão*_"; (2) **nome inline** (`extrairNomeBolaoInlineSair`, novo `sair.helper.ts`) — "sair do bolão da firma" vai direto pra confirmação; se citar um bolão que ele admina, explica que admin não sai; (3) "0 elegíveis" e "nenhum bolão" com mensagens próprias. Lógica de >1 elegível (pergunta qual) e a confirmação sim/não inalteradas. **8 testes novos**. **887 tests**. Sem migration. |
| **3.29.0** | **2026-06-12** | **Fix: "Coreia 1 x 0 Rep Checa" → "Não achei jogo" (matching de abreviação/grafia).** Caso real (Mauricio 11/06): bot respondia "Não achei jogo" listando logo abaixo o jogo certo ("Coreia do Sul x República Tcheca"). Causa: o fast-path de palpite inline (`handlePalpiteInlineEmIdle`) casava times só por `includes` bidirecional (`encontrarJogo`/`acharJogoPorTimes`) → "republica tcheca".includes("rep checa")=false. **Camada 1 (determinística):** novo `timeCorresponde(input,oficial)` em `validators.ts` com 3 regras — includes (legado) + **alias canônico** (`normalizarNomeTime` da Copa, ex. "coreia"→"Coreia do Sul") + **token-match** conservador ("rep checa"⊂"republica tcheca"; "real madrid" NÃO casa). Usado em `encontrarJogo` (palpite.service) e `acharJogoPorTimes`. Aliases novos "checa/rep checa/republica checa". **Camada 2 (rede de segurança):** se o matcher determinístico falhar, o fast-path chama o extrator LLM existente (`extrairPalpites`, ground-truth = jogos abertos) só pra TRADUZIR os nomes pros oficiais, valida com `resolverPalpiteParaJogo` (exige 1 jogo) e reprocessa a linha corrigida (1x, anti-loop) — o LLM nunca fala com o usuário e o registro segue exigindo preview+"sim". Métricas `palpite.fastpath.llm_resolveu/_falhou`. **13 testes novos**. **879 tests**. Sem migration. |
| **3.28.0** | **2026-06-12** | **Auditoria do código — Tier 1 (bugs UX) + Tier 2 (robustez).** **T1.1** "meus palpites" agora **pagina** em mensagens de até 3500 chars (rodada de 72 jogos passava dos 4096 do WhatsApp e a Evolution cortava em silêncio) — novo helper puro `utils/paginar.ts`. **T1.2** criação de bolão **sem passo de senha**: cria direto após o nome (entrada é por ID `#ABCD12`; pedir senha confundia). `handleCriandoBolaoNome`→`finalizarCriacaoBolao`; `senhaHash` gerado interno/aleatório (schema exige); estado `CRIANDO_BOLAO_SENHA` vira compat pra sessões stale. **T1.3** lookahead de PROXIMOS_JOGOS bloqueia "próximos jogos quando/onde/que dia?". **T1.4** revelação de palpites avisa "mostrei 8 de N — cita um time" (antes cortava 8 em silêncio; `revelacoesParaUsuario` agora retorna `{blocos,total}`). **T1.5** multi-palpite com teto de 80 linhas (anti-abuso). **T2.1** cap de avisos atômico (`reservarCotaAviso`/`devolverCotaAviso` — INCR-then-compare; corrige TOCTOU em todos os 4 jobs de aviso). **T2.2** lock `SET NX` compartilhado entre `fetch-results` e `calculate-scores` (`utils/lock.ts`) contra recálculo concorrente. **T2.3** `send-ranking` com idempotência por-usuário + flag da rodada só quando ninguém falhou. **T2.4** `recalcularRanking` sem N+1 (1 `findMany` + agregação em memória, no lugar de 1+2N queries). **T2.5** índices aditivos `palpites(rodadaId,calculado)` e `rodadas(bolaoId,status)` (migration `20260612120000_indices_hot_paths`). **T2.6** try/catch na recursão do FSM-escape de criação. **16 testes novos** (paginar, lock, cap atômico, lookahead, teto multi-palpite). **866 tests**. _(Backlog: Tier 3 segurança + Tier 4 UX nova.)_ |
| **3.27.0** | **2026-06-12** | **UX pós-início da Copa: 4 melhorias de casos reais (11/06).** (1) **"meus palpites" ordenado e agrupado por data** — jogos saíam na ordem arbitrária do banco; agora ordenados por kickoff e agrupados por dia ("📅 qui., 11/06"), com hora no "ainda não rolou". Novo helper `formatarDataComDiaBR` em datetime.ts. (2) **"próximos jogos" pergunta o filtro** — novo estado FSM `ESCOLHENDO_FILTRO_PROXIMOS_JOGOS`: "1 - só os que faltam palpite / 2 - todos da Copa". Frases que já indicam pendência ("o que falta palpitar", "quero dar palpites") pulam a pergunta; resposta com palpite inline escapa pro fluxo de palpite; `mais jogos` continua no MESMO filtro (persistido em Redis, `pj_filtro:{waId}`, TTL 60min); `jogos de hoje` lista direto sem pergunta. (3) **Placar/finalizados sem cair na LLM** — "Qual foi placar de México e África?", "Quais jogos já finalizaram?", "jogos de ontem", "quem está ganhando?", "o que já rolou" agora casam PLACAR_JOGO (antes → LLM "checa no site da FIFA" com o dado no banco). (4) **"placares dos demais participantes" = palpites dos outros** — novos patterns PALPITE_OUTROS ("placar dos outros/galera", "o que cada um cravou"); revelação com filtro de time agora busca QUALQUER jogo já iniciado (sem janela de 24h — jogo finalizado é público pra sempre); fallback com time citado explica o que houve em vez da regra genérica de privacidade (bug real: bot dizia "só depois que o jogo começa" pra jogo FINALIZADO). **LLM**: exceção anti-"site da FIFA" pra placar (manda *placar*); classificador com descrições atualizadas de PLACAR_JOGO/PALPITE_OUTROS. **18 testes novos**. **850 tests**. Sem migration. |
| **3.26.2** | **2026-06-11** | **Fix: ranking sob demanda saía fora de ordem em empate (caso real "1,2,3,5,4").** `getRankingPorBolao` (comando *ranking*) lia `buscarRankingBolao` ordenado só por `pontuacaoTotal DESC` (ordem arbitrária no empate) mas exibia o número de `posicaoAtual` (desempate em cascata) → as duas ordens divergiam. Fix: novo helper puro `ranking.sort.ts:ordenarParticipacoesRanking` ordena pela cascata canônica (pontos DESC → posicaoAtual ASC → entradaEm ASC) e a posição exibida passa a ser derivada do índice (`i+1`), garantindo que o número SEMPRE bate com a ordem da lista. Secundário também adicionado no `orderBy` do repo (defesa em profundidade). O push do ranking (job, via `recalcularRanking`) já era consistente. **5 testes novos** (`ranking.sort.test.ts`). **832 tests**. Sem migration. |
| **3.26.1** | **2026-06-11** | **Mensagens de latência atualizadas pro placar AO VIVO (FIFA).** Antes várias respostas diziam "placar oficial chega em até ~1h após o apito" e "placar ao vivo NÃO existe" — herança da época do openfootball (v3.16–3.21). Com o provider `hybrid` (FIFA, v3.22) o placar é em tempo quase real, então a copy estava enganando o usuário. Varredura e atualização em: `command.router.ts` (handlers PLACAR_JOGO, PONTOS_DETALHE, STATUS_RODADA, RECLAMACAO_BUG, próximos-jogos-rolando), `llm/knowledge.produto.ts` (placar ao vivo existe; ranking atualiza em min; placares ~poucos min), `llm/conversational.responder.ts` (removida proibição de "placar ao vivo" — mantida só transmissão/TV/lance-a-lance), e comments em `utils/jogo-status.ts` e `command.router.ts`. Mensagem nova: placar atualiza **ao vivo**; pontos calculam **poucos minutos após o apito final**; ranking na sequência. Sem mudança de lógica. **827 tests** (knowledge mantido <6000 chars). |
| **3.26.0** | **2026-06-11** | **Broadcast administrativo — aviso pra todos os usuários.** O dono manda no WhatsApp uma mensagem começando com `#ENVIOPARAVARDOBOLAO#` e o texto seguinte é disparado pra todos os usuários (útil em instabilidade). Interceptado no TOPO de `handleIncomingMessage` (antes de anti-loop/usuário/parser/FSM) por `tentarBroadcastAdmin` (novo `src/whatsapp/broadcast.ts`): só número(s) dono(s) (`OWNER_WHATSAPP_IDS`, comparação por dígitos — waId vem como JID em prod) + marcador exato no início disparam; qualquer outra msg (inclusive do dono sem marcador) segue o fluxo normal. **Rollout em fases**: `BROADCAST_TEST_MODE=true` (default) envia SÓ pro próprio dono que disparou; trocar pra false (com `EVOLUTION_WEBHOOK_TOKEN` setado) envia pra todos. Envio com **throttle** (`notificarEmMassaThrottled`, default 1s entre envios, pula delay em DRY_RUN) aos `whatsappId` crus (dedup no valor cru). **Idempotência atômica** (`SET NX` em `broadcast:done:{messageId}`) + lock global contra disparo duplo/concorrente. Bypassa `MAX_AVISOS_DIA` (admin). Novas envs: `OWNER_WHATSAPP_IDS`, `BROADCAST_TEST_MODE`, `BROADCAST_MARKER`, `BROADCAST_THROTTLE_MS`. Plano revisado por subagente (3 correções aplicadas: token do webhook obrigatório em prod, `SET NX` atômico, envio ao whatsappId cru). **14 testes novos** (`broadcast.test.ts`). **827 tests (era 813, +14)**. Typecheck OK. Sem migration. |
| **3.25.0** | **2026-06-11** | **Palpite com times INVERTIDOS agora é entendido (caso B. 11/06 18:36).** User mandou *"República Tcheca 2x0 Coreia do Sul"* mas o fixture é *"Coreia do Sul x República Tcheca"* (mandante trocado) → bot respondia *"🤔 Não consegui entender nenhum palpite"*. O parser EXTRAÍA o palpite certo; a falha era no MATCHING: os dois `acharJogo` (fluxo single-bolão e multi-bolão em `command.router.ts`) só casavam na ordem canônica (`timeCasa↔timeCasa`). **Fix**: novo `acharJogoPorTimes` + `resolverPalpiteParaJogo` em `utils/validators.ts` — tenta CANÔNICO primeiro (prioridade absoluta = zero regressão) e, só se falhar, INVERTIDO (times trocados), TROCANDO o placar pra alinhar ao fixture (o gol que o user deu pro time que é mandante no fixture vira `golsCasa`). Os dois call sites passaram a usar o helper. Resultado: o palpite cai no fluxo de confirmação normal já com **nomes e placar arrumados** (*"Coreia do Sul 0 x 2 República Tcheca"*) — o user confirma e registra, como pedido. Cobre tanto o caminho regex quanto o LLM. **7 testes novos** em `validators.test.ts` (canônico, invertido=caso B., prioridade do canônico, sem match; `resolverPalpiteParaJogo` troca o placar corretamente). **813 tests (era 806, +7)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
| **3.24.0** | **2026-06-11** | **Revelação de palpites no kickoff — privacidade vira TEMPORAL.** Quando um jogo COMEÇA (palpite travado), o bot manda pros integrantes do bolão os palpites de TODOS daquele bolão pra AQUELE jogo — assim todo mundo acompanha sabendo o que cada um cravou. Antes, palpite era privado pra sempre; agora é privado ATÉ o kickoff e revelado depois (justo: ninguém copia, já que trava no início do jogo). **Escopo seguro por construção**: a revelação vem de `PalpiteJogo where jogoId` — escopada a 1 jogo × 1 bolão (porque `Jogo.apiJogoId` é único por rodada/bolão), impossível vazar palpite de outro jogo ou de bolão que a pessoa não participa. Quem não palpitou aparece como "não palpitou". Multi-bolão: 1 mensagem com 1 bloco por bolão. **Duas vias**: (1) **push automático** — novo `send-palpite-reveal.job.ts` (cron */2min, time-driven, NÃO depende da FIFA), idempotente por `reveal:{wa}:{apiJogoId}` em Redis, **conta no `MAX_AVISOS_DIA`** (subido 2→8 pra caber bom-dia+chamada+revelações de um dia de grupos); (2) **sob demanda** — `handlePalpiteOutros` agora REVELA se há jogo iniciado nos bolões do user (opcional filtro por time citado) e só explica a regra se nenhum começou — essa via **não conta no cap** (user pediu). Builder puro em `src/utils/palpite-reveal.ts` (montarBloco/montarMensagemRevelacao); query compartilhada em `src/modules/palpite/revelacao.service.ts`. **Privacidade reconciliada** (temporal) em `knowledge.produto.ts`, `system-prompts.ts` e `handlePalpiteOutros` — mantém "admin NÃO vê ANTES do kickoff". Nova env `ENABLE_PALPITE_REVEAL` (default true). Parser: `PALPITE_OUTROS` ganhou patterns "palpites de todos / do jogo" (aditivo). **9 testes novos** (`palpite-reveal.test.ts` 5 — ordenação Você/palpiteiros/não-palpitou, multi-bloco; `revelacao.service.test.ts` 4 — escopo, filtro por time, skip bolão solo / sem palpite). **806 tests (era 797, +9)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
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
| **3.23.0** | **2026-06-11** | **Janela de polling — DB é fonte de verdade pra finalizados, API só na janela ativa.** Antes, `buscarRodadasComJogosEmAndamento` retornava a rodada enquanto QUALQUER jogo estivesse `AGENDADO`/`AO_VIVO`. Pra Copa (1 rodada, 72 jogos em 15 dias) isso fazia o `fetch-results` bater na FIFA a cada 5 min por ~15 dias seguidos — inclusive de madrugada entre dias de jogo, com o próximo jogo a dias de distância. Agora a rodada só entra no polling se tem jogo realmente em andamento: `AO_VIVO` (até finalizar) OU `AGENDADO` com `dataHora <= agora` (kickoff já passou). Jogo FUTURO e jogo FINALIZADO NÃO disparam fetch — placar de finalizado é lido direto do banco (`handlePlacarJogo`/`PONTOS_DETALHE` já liam de `prisma.jogo`, nunca da API). Resultado: a API só é consultada durante/após o kickoff de cada jogo, até finalizar; zero chamadas entre dias de jogo. **Rede de segurança**: cláusula extra `FINALIZADO + golsCasa null` re-busca um eventual finalizado sem placar (anomalia que os adapters já previnem com null-guard) — garante "todo FINALIZADO tem placar no banco" de ponta a ponta. Finalização da rodada (`todosFinalizados`) e correção pós-VAR seguem intactas (durante a janela do último jogo a rodada é processada normalmente). **2 testes novos** em `polling-window.test.ts` (where-clause filtra AO_VIVO/AGENDADO-kickoff-passado/FINALIZADO-sem-placar; não inclui jogo futuro nem finalizado-com-placar). **797 tests (era 795, +2)**. Typecheck OK. Sem migration. |
| **3.22.0** | **2026-06-11** | **Placar AO VIVO via FIFA + provider `hybrid` (FIFA→openfootball).** Investigação ("dá pra bater no Google e pegar placar ao vivo?"): Google não tem API pública e scraping viola ToS/é frágil (processo Google×SerpApi). A fonte certa é a `api.fifa.com` (mesmo endpoint não-documentado que o site fifa.com consome) — confirmada AO VIVO no dia da abertura. Descobertos os IDs reais batendo na API: `idCompetition=17`, `idSeason=285023` (FIFA World Cup 2026, via `/api/v3/seasons?idCompetition=17`). **Reescrito `fifa.fetcher.ts`** corrigindo os 3 bugs que faziam o fetcher legado nunca funcionar (mesmo com `FIFA_SEASON_ID` setado): (a) lia `m.HomeTeam.Score` — campo inexistente; real é `m.Home.Score`/`m.HomeTeamScore`. (b) status codes INVERTIDOS — confirmado empiricamente (2026 ao vivo + 2022 finalizada): `0=FINALIZADO`, `1=AGENDADO`, `3=AO_VIVO` (o legado mapeava 1→AO_VIVO, 3→FINALIZADO e jogava FINALIZADO no default→AGENDADO, descartando todo resultado). (c) match por nome sem normalizar → agora casa por **par de código FIFA** (`Home.IdCountry`/`Away.IdCountry` → `teams.json fifaCode` → fixture), cobertura 100% das 48 seleções. + null-guard de placar + lança em falha de rede (sinal pro fallback). **Novo `hybrid.fetcher.ts` (`HybridFootballAdapter`, provider default)**: FIFA primário (AO VIVO, latência de segundos) com **fallback automático pro openfootball** se a FIFA cair — garante que placares continuam chegando. `FOOTBALL_PROVIDER` aceita `hybrid` (default) | `openfootball` | `fifa-2026` | `mock`; nova env `FIFA_SEASON_ID` com default `285023`. **Trava de pontuação** (`calcularPontuacaoRodada`): pontua SÓ `status=FINALIZADO` — com a FIFA gravando placar PARCIAL ao vivo (status `AO_VIVO`), sem o gate os pontos oscilariam durante o jogo; agora jogo não-finalizado conta 0 até o apito e recalcula na finalização. **Display**: `handlePlacarJogo` trata `AO_VIVO` mostrando o placar parcial real (`🔴 ROLANDO AGORA: Brasil 1 × 0 ...`) em vez de "placar parcial não disponível". Como TODOS os handlers de placar (`PLACAR_JOGO`, `PONTOS_DETALHE`, `STATUS_RODADA`, `PROXIMOS_JOGOS`) leem do Postgres alimentado por um único `footballApi.buscarResultados()`, a troca FIFA-primário cobre todas as frases/conversas automaticamente. **16 testes novos**: `fifa.fetcher.test.ts` (11: status 0/1/3/4, Home.Score + fallback HomeTeamScore, match por código FIFA MEX×RSA→WC2026_A_1, código a-definir pulado, null-guard, throw em HTTP 500/rede), `hybrid.fetcher.test.ts` (3: FIFA OK usa FIFA / FIFA 500 cai pro openfootball / exceção cai pro openfootball), `scoring-gate.test.ts` (2: AO_VIVO/AGENDADO não pontuam, FINALIZADO pontua). **795 tests (era 779, +16)**. Typecheck OK. Sem migration. |
| **3.21.0** | **2026-06-11** | **Trava de palpite por JOGO (não por rodada) + ambiguidade "placar" vs ranking — 2 prints reais durante a Copa.** Print 1 (R., 11/06 16:25): tentou palpitar Coreia do Sul x República Tcheca (kickoff 23h, ainda não rolou) e bot rejeitou com *"⚠️ Não rolou: rodada fechada"*. Causa raiz em `palpite.service.ts:46-48`: `if (new Date() > rodada.dataFechamento) throw new Error('rodada fechada')`. O `dataFechamento` é setado em `rodada.service.ts:32` como o **kickoff do PRIMEIRO jogo** da rodada (`primeiroJogo = min(jogos.dataHora)`). Pra Copa 2026 (1 rodada com 72 jogos em 15 dias), `dataFechamento = 11/06 16:00 BRT`. **Após 16:00, TODO palpite era rejeitado** — inclusive os 71 jogos futuros. A v3.13.0 corrigiu o TEXTO das regras dizendo "cada palpite trava no seu kickoff" mas o código continuou travando por rodada. A v3.14.0 corrigiu o PIPELINE (fetch-results/calculate-scores aceitarem rodada ABERTA) sem tocar na trava. A v3.20.0 (hoje cedo) confirmou que a trava por jogo individual nas linhas 63-68 funciona — mas o check da linha 46 vinha ANTES. Print 2 (Bruna, 11/06 16:39): mandou *"Placares de todos"* → bot deu resposta desconexa ("pra registrar palpites manda próximos jogos"); depois *"Qual o placar?"* (com México x África ROLANDO) → bot mentiu *"🤷 Não achei jogo rolando"* (esse já era o caso da v3.20.0 que ainda não tinha deployado). **Fix em 6 partes**: (1) `palpite.service.ts` — trocado check de `dataFechamento` por `rodada.status === 'FINALIZADA'` (defesa em profundidade contra rodada já terminou; trava por jogo individual nas linhas 63-68 continua intacta). Erros de domínio em `registrarComRetry` ganham "rodada finalizada"/"ja iniciou"/"ja terminou" pra não tentar retry transitório. (2) `command.router.ts:handleQuandoComeca` — mensagem *"🔒 Palpites aceitos até: HH:MM"* (mentira porque cada jogo trava no seu kickoff) substituída por *"🔒 Cada palpite trava no kickoff do jogo dele (fuso de Brasília 🇧🇷). Vai palpitando aos poucos!"*. (3) `PLACAR_JOGO_PATTERNS` ganha 7 termos curtos/ambíguos: `/^placar(es)?\??$/` (placar/placares sozinho), `/^placar(es)?\s+de\s+todos\b/` (caso Bruna), `/^mostrar (?:o |os )?placar/`, `/\bme mostra (?:o |os )?placar/`, `/^resultados?\??$/` (com anti-falso-positivo "resultados foram bons"), `/\bcomo (?:estao|estão|tao|tão|ta|tá) (?:o |os )?placar/`, `/^como (?:foram|estao|estão) os jogos\??$/`. (4) `handlePlacarJogo` — novo detector de "pergunta ambígua" (raw curto sem time mencionado) que adiciona à resposta um bloco **"📊 Quer ver o ranking do bolão? Manda *ranking* ..."** + sugestão de *meus pontos*. Em modo ambíguo o caso vazio (sem jogos achados) também sugere ranking. (5) Mensagem padrão do PLACAR_JOGO atualizada de *"~5min/10min"* (otimista demais) pra **"~1h após o apito final"** + **"~10 min depois — total ~1h10 do fim do jogo até atualizar o ranking"** — reflete a realidade do openfootball como fonte. (6) Knowledge `KNOWLEDGE_PRODUTO` ganha 1 linha sintética: *"Placar ao vivo NÃO existe. Oficial em ~1h após o apito; pontos do bolão em ~10min → ranking atualiza ~1h10 do fim. 'placares' → jogos. 'ranking' → bolão. Se ambíguo, oferecer ambos."*. Seção "TOM PRA NOVATO" condensada pra caber no limite de 6000 chars. **Garantias preservadas**: México x África (já iniciado) continua bloqueado pelo MOTIVO CERTO (linha 66: `new Date() >= jogo.dataHora` → "ja comecou") — sem regressão. Rodada FECHADA (modelo antigo, admin fechava manual) NÃO bloqueia mais palpite (compatibilidade com flexibilidade); só FINALIZADA bloqueia (todos os jogos terminaram = rodada acabou). **16 testes novos**: 9 patterns PLACAR_JOGO ambíguos (incluindo caso Bruna exato + anti-falso-positivo "resultados foram bons" e "quero ver placar do palpite" não crasha); 7 cenários `palpite.service` mockando Prisma — cenário R. EXATO reproduzido (rodada ABERTA + dataFechamento=16:00 + jogo das 23h → registra OK), México x África bloqueado por "ja comecou" (motivo certo), rodada FINALIZADA rejeita, rodada FECHADA não bloqueia mais, rodada inexistente / user não participa / jogo nome errado. **779 tests (era 763, +16)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
| **3.20.0** | **2026-06-11** | **Jogo em andamento — análise ao vivo com México x África ROLANDO (16:19, kickoff 16:00).** Auditoria de TODAS as funcionalidades que dependem de jogo em andamento revelou raiz comum: **o status `AO_VIVO` nunca é setado no banco durante o jogo** — o openfootball (provider v3.16.0) só publica placares ~30-60min após o fim, então o jogo fica `AGENDADO` enquanto rola. **✅ O que estava correto**: trava de palpite (`palpite.service.ts:66` compara `new Date() >= jogo.dataHora` — POR HORÁRIO, independente de status; palpite pro México x África durante o jogo era rejeitado com "ja comecou", e `registrarPalpitesConfirmados` reportava no "⚠️ Não rolou"); pipeline de placar final (v3.14.0/16.0). **🔴 BUG 1**: `handlePlacarJogo` buscava `status: 'AO_VIVO'` → "qual o placar?" durante o jogo respondia *"🤷 Não achei jogo rolando agora"* COM JOGO ROLANDO — mentira por omissão, o bot sabia o kickoff e não usava. **🔴 BUG 2**: `handleStatusRodada` — bloco "🔴 Agora mesmo" idem, nunca aparecia. **🟡 BUG 3**: `handleProximosJogos` filtrava `dataHora >= agora` → jogo iniciado SUMIA da lista sem explicação. **🟡 BUG 4**: `iniciarConfirmacaoPalpites` incluía jogos já iniciados no ground truth → preview mostrava o palpite, user confirmava, e SÓ DEPOIS do "sim" via o erro "ja comecou". **Fix central**: novo `src/utils/jogo-status.ts` com helpers puros que derivam estado POR HORÁRIO — `jogoEstaRolandoPorHorario` (kickoff ≤ agora < kickoff + 2.5h, status não-final; janela cobre 1h55 de jogo + acréscimos), `jogoEncerradoAguardandoPlacar` (passou da janela mas openfootball não commitou — estado transitório 30-60min) e `jogoAindaNaoComecou`. Aplicado: (a) `handlePlacarJogo` agora inclui AGENDADOS com kickoff passado e renderiza 3 estados: *"🔴 ROLANDO AGORA: México x África do Sul (começou às 16:00 — placar parcial não disponível)"*, *"⏳ encerrado, aguardando placar oficial"* e *"✅ placar final"*. (b) `handleStatusRodada` deriva o bloco "Agora mesmo" pela mesma janela, com fallback honesto quando não há placar parcial. (c) `handleProximosJogos` ganha seção *"🔴 ROLANDO: ... (começou 16:00 — palpites encerrados)"* no topo de cada bolão; jogos rolando NÃO contam no "falta palpitar"; edge tratado: se TODOS os jogos visíveis estão rolando (lote futuro vazio), mostra só o bloco rolando em vez de pular o bolão. (d) `iniciarConfirmacaoPalpites` separa palpites de jogos já iniciados e avisa NO PREVIEW (*"⏰ Já começou (palpite travado, não entra): ..."*) — confirmação só pros válidos; se TODOS já iniciaram, mensagem dedicada "jogo já começou" em vez de "não entendi". (e) `iniciarConfirmacaoPalpitesMultiBolao` filtra kickoff futuro no ground truth (trava do service continua como 2ª defesa). **15 testes novos** em `jogo-status.test.ts`: caso REAL (16:19 com kickoff 16:00 e status AGENDADO → rolando), 1min antes do kickoff, exatamente no kickoff, bordas da janela 2.5h (2h29 dentro / 2h31 fora), AO_VIVO explícito vence janela, FINALIZADO/ADIADO/CANCELADO nunca rolando, aguardando placar (3h depois sim / 1h depois não / FINALIZADO não), palpite aberto/travado/ADIADO. **763 tests (era 748, +15)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
| **3.19.0** | **2026-06-11** | **BUG CRÍTICO: caminho de palpite registrava SEM confirmação — caso Natane 11/06.** Print real (14:02): user mandou 5 palpites no formato `<gols> Time X <gols> Time` (*"1 México X 2 África do Sul"*) → bot respondeu em 2s *"✅ Palpite registrado! Registrei 5 palpite(s) em linguagem natural!"*. Sem preview. Sem sim/não/refazer. Sem possibilidade da user verificar o que foi registrado. **Violava a regra estabelecida na v3.10.0 (caso Valéria 22/05: "NUNCA mentir 'registrei' sem confirmar")**. Risco: LLM pode ter alucinado placares ou trocado time casa/visitante; user nunca saberia. Causa raiz (rastreada): `command.router.ts:tentarPalpiteLivreViaLLM` era o ÚNICO caminho de palpite no codebase que chamava `palpiteService.registrarPalpiteEmRodada` em loop direto sem mostrar preview. Era ativado pela "janela de palpite livre" pós-`próximos jogos` (TTL 5min em Redis) quando o parser regex falhava. O formato da Natane (`N Time X N Time`) era único — não casava `PALPITE_REGEX` (canônico `Time NxN Time`) nem `PALPITE_INVERTIDO_REGEX` (`NxN Time x Time`) nem o tokenizer — caía em `TEXTO_LIVRE`, janela aberta → caminho silencioso. Fix em 5 frentes. (1) **Refatoração do `tentarPalpiteLivreViaLLM`**: agora **detecta** quais bolões têm jogos correspondentes via `extrairPalpites` (LLM, mantido pra cobertura) mas em vez de registrar, **delega** ao pipeline canônico — `iniciarConfirmacaoPalpites` (1 bolão) ou `iniciarConfirmacaoPalpitesMultiBolao` (>1). Esses pipelines mostram preview "📝 Vou registrar N palpite(s) em ... Confirma?" + exigem sim/não/refazer. Zero registro direto. Log estruturado `[palpite-livre] waId=X candidatos=N`. Removida a resposta enganosa *"Registrei N palpite(s) em linguagem natural!"*. (2) **Novo `PALPITE_GOLS_SEPARADOS_REGEX`**: `/^(\d+)\s+(.+?)\s+[xX]\s+(\d+)\s+(.+)$/` cobre o formato da Natane no parser regex (sem LLM), entra no fluxo canônico de confirmação direto. Posicionado DEPOIS de canônico/invertido/extenso (regex é genérico). Anti-lixo agressivo: (a) `timeComecaComDigito` — bloqueia "12 anos x 2 vitorias" onde "anos" começa OK mas o resto é lixo; (b) `timeEhStopwordSemantica` com lista de ~30 palavras (anos/jogos/derrotas/vitorias/horas/vezes/pontos/gols/etc) que NUNCA são nomes de time — bloqueia "3 jogos x 5 derrotas". Multi-linha integrado com `parseMultiplePalpites` (caso real: 5 palpites separados por `\n`). (3) **Script `scripts/auditar-recuperar-palpite.ts`**: dois modos. `audit <waId>` — mostra usuário, bolões, rodadas abertas, palpites registrados com placares, calculado/pontuação — pra verificar o estado real. `registrar <waId> "1x2 Mexico x Africa" "3x1 Brasil x Marrocos" ...` — parseia (3 formatos aceitos), busca jogos via fuzzy match e chama `palpiteService.registrarPalpitesEmTodosBoloes` (UPSERT, idempotente). Idempotência: rodar 2× não duplica; placar diferente sobrescreve (correção). Doc `docs/recuperacao-manual.md` com exemplos e cenários (user reportou não registrado / placar errado / bug em massa). (4) **Teste de contrato** `palpite-livre-contrato.test.ts`: parsing estático do `command.router.ts` — falha se `tentarPalpiteLivreViaLLM` voltar a chamar `palpiteService.registrarPalpite*` direto OU se a string *"palpite(s) em linguagem natural!"* reaparecer. Anti-regressão estrutural: novo desenvolvedor que tentar adicionar atalho que pula confirmação tem teste vermelho. (5) **Logs estruturados** `[palpite-livre]` pra observar o caminho em produção. **13 testes novos** (8 PALPITE_GOLS_SEPARADOS cobrindo as 5 frases da Natane + canônico/invertido anti-regressão + 2 anti-falso-positivo "12 anos x 2 vitorias"/"3 jogos x 5 derrotas" + multi-linha do print completo; 3 contrato; 2 novos no test antigo). **748 tests (era 735, +13)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. Script de recuperação corre dentro do container sem mudança de schema. |
| **3.18.0** | **2026-06-11** | **Anti-loop em 4 camadas — caso Lucas 11/06: loop de 8 mensagens em 60s por auto-reply do WhatsApp Business.** Print real mostrou: bot mandou bom-dia → WhatsApp do Lucas tinha auto-reply *"Agradeço seu contato, respondo em breve"* → bot interpretou como `AGRADECIMENTO` (pattern `/^agrade[cç]o\b/`) → respondeu com variante "Imagina! Tamo junto" → auto-reply disparou de novo → loop. 8 respostas em ~60s. Risco real: hoje viola termos do WhatsApp (derruba número); amanhã (Meta Cloud API) ~$0.008-0.063 por conversa × 8/min = custo absurdo + ban da conta API. Patterns `/^obrigad[ao]/` e `/^thanks?\b/` tinham o mesmo problema com auto-replies em PT e EN. **Zero proteção** contra ping-pong existia — flag `aviso_jogo:` só protegia jobs push, rate-limit de mídia (v3.15.0) só pra áudio/imagem. **Fix em 4 camadas independentes** (cada uma sozinha resolve; combinadas = defesa de Lego). **Camada 1 — Detector de auto-reply**: novo `src/whatsapp/auto-reply.detector.ts:parecAutoReply(texto)` com keywords clássicas em PT-BR ("agradeço seu contato", "respondo em breve", "estou ausente", "fora do horário", "mensagem automática", "no momento não posso atender", "assim que possível" — 40+ frases catalogadas) + filtro de tamanho mínimo (25 chars, mensagens curtas como "obrigado" não casam). Aplicado em `handleIncomingMessage` ANTES do parser; quando detecta, bot SILENCIA (sem responder, sem registrar "não entendi"). **Camada 2 — Patterns AGRADECIMENTO endurecidos**: `AGRADECIMENTO_PATTERNS` reescritos pra exigir final-de-mensagem (`$`) ou pontuação após a palavra-chave. *"Agradeço seu contato, respondo em breve"* não casa porque tem texto depois. Cap adicional no `matchIntent`: mensagem > 30 chars NÃO casa AGRADECIMENTO mesmo que pattern aceitasse. Anti-regressão: `"obrigado"`, `"valeu"`, `"vlw"`, `"muito obrigado mesmo!"`, `"Agradeço!"` continuam funcionando normal. **Camada 3 — Rate-limit reativo por waId**: novo `src/utils/resposta-cap.ts:verificarAntiLoop(waId, texto)` + `registrarResposta(waId, texto)`. Conta `resposta:count:{waId}:{bucket-60s}` Redis; cap **8 respostas/60s** (= exato número do print do Lucas). Acima do cap: bot silencia + Redis `silenciado:{waId}` TTL 5min impede reentrada imediata. Aplicado em toda mensagem processada. Não confunde com `aviso-cap` (v3.17.0) que limita jobs push — este é defesa reativa. **Camada 4 — Detector de mensagem repetida**: em `verificarAntiLoop`, SHA-1 truncado da última mensagem do user (TTL 60s); se MESMA string chega 2+ vezes em <60s, silencia. Mata 100% dos auto-replies que mandam exatamente o mesmo texto. Telemetria nova: `msg.auto_reply.detectada`, `msg.anti_loop.repetida`, `msg.anti_loop.cap_60s`, `msg.anti_loop.silenciado`. Logs estruturados `[anti-loop] waId=X motivo=Y texto="..."` pra revisão offline (rastrear quem está em loop). Doc nova `docs/anti-loop.md` com diagrama das 4 camadas + comandos pra observar via Redis + limitações conhecidas (auto-replies em outras línguas não cobertas, falsos positivos aceitáveis se user humano mandar exatamente mesma string 2×). **34 testes novos**: 21 em `auto-reply.detector.test.ts` (12 positivos cobrindo Lucas exato + variantes "Obrigado pelo contato", "Estou ausente", "Mensagem automática" etc; 9 negativos garantindo que "obrigado" / "valeu" / "Agradeço!" / palpite normal não viram falso positivo), 6 em `resposta-cap.test.ts` com mocks de Redis (1ª permite, 8 ok + 9ª bloqueada, silenciado 5min mantém bloqueio, repetida detectada, isolamento entre users, **cenário EXATO do Lucas reproduzido** — 8 respostas seguidas com as variantes reais "Imagina!"/"Disponha!"/"Magina!", 9ª bloqueada), 7 anti-regressão no parser (auto-reply do Lucas → não vira AGRADECIMENTO; "Obrigado pelo contato, retorno em breve" idem; "Thanks for reaching out..." idem; "valeu cara, muito obrigado pelo bom dia" frase longa idem; mas "Agradeço!"/"obrigado mesmo"/"muito obrigado!" curtas continuam casando). **735 tests (era 701, +34)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. Cap 8/60s hardcoded por simplicidade (raríssimo user legítimo precisar de mais; vira env se aparecer caso real). |
| **3.17.0** | **2026-06-11** | **3 bugs de UX/comportamento descobertos em uso real (Copa rolando dia 1).** 3 prints de conversas reais revelaram problemas que testes não pegavam. (1) **Conversa de privacidade defensiva (Camila 11/06)**: user perguntou "vai mostrar palpites dos outros?" → bot respondeu "não" duas vezes em sequência sem distinguir o que é público (total no ranking) vs privado (placar individual), sem oferecer alternativa útil. Era confuso porque o ranking JÁ mostra "Maria 80 pts" — natural pensar que vai detalhar por jogo. Nova intent `PALPITE_OUTROS` com 10 patterns regex cobrindo "palpites dos outros/fulano/galera", "quem acertou Brasil x Marrocos?", "quem pontuou no jogo de ontem?", "como vejo o palpite do Fulano?", "lista de palpites". Posicionada **antes** de `PERGUNTA_GERAL_FUTEBOL` (pattern "jogos de ontem" capturava antes), `PROGRESSO_PALPITES` (contagem agregada, não é o que pede) e `MEU_PALPITE` (próprio user). Handler `handlePalpiteOutros` responde calibrado em 3 blocos: 🔓 **Público** (ranking total — necessário pro ranqueamento funcionar), 🔒 **Privado** (placar específico de cada palpite individual), e oferece *pontos de ontem* como alternativa útil pro próprio user ver seus acertos jogo a jogo. Não é defensivo — explica a lógica. (2) **Medalhas 🥇🥈🥉 em ranking 0×0×0 (Bolao kzados)**: print mostrou André Zonaro 🥇 0 pts / Lucas T.M. 🥈 0 pts / João Arruda 🥉 0 pts — todos zerados mas com medalhas sugerindo conquista. Gerou confusão social no grupo ("por que tem campeão se ninguém marcou?"). Causa: `formatRanking` em `src/utils/formatting.ts` chamava `medalha(posicao)` cegamente, exibindo critério de desempate (mais palpites/entrada anterior) como se fosse pontuação. Fix: quando `entries[0].pontuacaoTotal === 0` (líder zerado = todos zerados), usa numeração simples `1. 2. 3.` + nota *"_(Empate técnico em 0 pts — o ranking começa a se formar quando os jogos terminarem.)_"*. Medalhas voltam normalmente quando o líder tem ≥1 pt. (3) **3 mensagens em 3.5h (Camila — bom-dia 10:00 + palpite-call 13:00 + reminder 13:30)**: risco real de spam + custo direto na futura migração Meta Cloud API (~$0.008 USD por mensagem business-initiated fora de janela 24h; pra 1000 users × 3 msgs × 30d = ~$720/mês). Fix em 3 frentes: (a) **Cross-job flag estendida**: `send-reminders` agora honra `aviso_jogo:{waId}` TTL 24h (antes só bom-dia + palpite-call honravam — gap explicava a 3ª msg). (b) **Cap absoluto cross-job**: novo `src/utils/aviso-cap.ts` com `podeEnviarAvisoHoje(waId)` + `registrarAvisoEnviado(waId)` em Redis (`avisos:count:{waId}:{YYYY-MM-DD-BRT}` TTL 30h). Default `MAX_AVISOS_DIA=2` (configurável via env). Os 3 jobs (bom-dia, palpite-call, reminders) checam ANTES de enviar e incrementam DEPOIS — defesa de profundidade caso a flag de 24h falhe. (c) **Rodapé BRT explícito**: bom-dia ganha `_(horários em fuso de Brasília 🇧🇷)_` e palpite-call idem — caso real Camila perguntou se "11/06, 16:00" era BRT (no chat ela tinha mandado o user pergunto isso 3 mensagens antes). Nova doc `docs/custo-meta-api.md` com tabela de custo Meta por escala (100/1k/10k users), recomendações por fase (dev/staging/prod), e comandos pra observar via Redis. Knowledge `KNOWLEDGE_PRODUTO` ganha 1 linha sobre "Público vs privado (caso Camila 11/06)" e "Max 2 avisos/dia por user". `system-prompts.ts` ganha PALPITE_OUTROS no classifier com distinção explícita de PROGRESSO_PALPITES. **17 testes novos**: 9 patterns PALPITE_OUTROS (com 2 anti-regressão pra MEU_PALPITE e PROGRESSO_PALPITES); 4 cenários formatRanking (zerado SEM medalhas, líder ≥1 SUSamedalhas, líder único pontuador, lista vazia); 4 cenários aviso-cap (zerado permite, cap 2, isolamento entre users, cenário Camila exato). **701 tests (era 684, +17)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. `MAX_AVISOS_DIA` opcional (default já cobre o caso). |
| **3.16.0** | **2026-06-11** | **Provider de placares trocado: openfootball substitui FifaWorldCup2026Adapter como padrão.** A v3.14.0 destravou o **pipeline** (`Palpite.calculado` resetando incremental), mas a **fonte** ainda era frágil. Investigação puxou o fio: o `FifaWorldCup2026Adapter` retornava `[]` silenciosamente em produção. **5 bugs encadeados** confirmados lendo o código: (1) `FIFA_SEASON_ID` veio VAZIO no `.env.example` → `if (!seasonId) return []` → nenhum placar entra; promessa "~5min" quebra. (2) `api.fifa.com` é endpoint não-documentado e instável — sem garantia de uptime. (3) `mapFifaApiIdToOurId` compara nomes com `.toLowerCase().trim()` SEM remover acentos e SEM traduzir EN→PT: `"Mexico"` (API) vs `"México"` (fixture) nunca casava — mesmo se a API funcionasse, jogo nunca seria atualizado. (4) `golsCasa: m.HomeTeam?.Score ?? 0` — Score `null` em jogo FINALIZADO virava `0×0` no banco, contaminando pontuação de **todos** os participantes daquele jogo. (5) Todo erro/exceção caía em `return []` com log warning genérico, sem métricas — admin operava cego. **Fix**: novo `OpenFootballAdapter` (`src/modules/resultado/openfootball.fetcher.ts`) usando `openfootball/worldcup.json` — mesma fonte do `sync-copa-2026.mjs` que já vinha alimentando o fixture local. Vantagens: sem API key, sem `SEASON_ID`, nomes 100% consistentes com o JSON local. Cache em memória 60s (placar muda devagar) reduz fetch redundante. Score `null` em FINALIZADO agora **pula** o jogo em vez de virar 0×0 (com log estruturado pra admin investigar). Match usa nova tabela canônica `PT_BR_TIMES` em `src/modules/copa-2026/traduzir-time.ts` — **fonte única da verdade** EN→PT, espelhada no `sync-copa-2026.mjs` (manter sincronizado). Log estruturado por fetch: `[openfootball] placares recebidos: sucesso=N sem_score=K sem_match=M total_no_json=T` — admin vê de relance se está cego ou recebendo dados. `FOOTBALL_PROVIDER` default mudou de `'fifa-2026'` pra `'openfootball'` em `env.ts` e `.env.example` (legacy `fifa-2026` mantido pra fallback opcional). Latência real esperada: **30–60min** após o apito final (depende dos commits da comunidade openfootball). Mensagens do bot **ajustadas** pra refletir realidade: `STATUS_RODADA` agora diz *"placar costuma chegar em até 1h após o apito final (base pública mantida por voluntários)"*; `PLACAR_JOGO` cita "1h" em vez de "5 min"; `RECLAMACAO_BUG` idem. Promessa otimista anterior ("~5 min") quebrava confiança quando user reportava — agora é honesto. **10 testes novos** em `openfootball.fetcher.test.ts` cobrindo cada um dos 5 bugs (B1-B5) com mocks de `fetch`: happy path, FINALIZADO detectado via `score.ft` sem campo `status`, normalização "Mexico"↔"México", Score `null` pula em vez de virar 0×0, log estruturado com contadores, HTTP 500 → `[]`, exceção de rede → `[]`, payload sem `matches`, jogos AGENDADOS ignorados. **684 tests (era 674, +10)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. Em produção: ao subir, primeiro tick do `fetch-results` (5 min) já tenta openfootball; logs `[openfootball] sucesso=...` confirmam fonte ativa. |
| **3.15.0** | **2026-06-11** | **Varredura pós-estreia: 3 bugs + 5 intents novas pra Copa rolando.** Varredura completa do código (3 agents Explore + verificação manual de CADA achado — 6 falsos positivos dos agentes descartados após leitura direta: `rodada.bolao` null [relação obrigatória], setHours timezone em reminders [+3h é tz-independent], `entradaEm` null [@default(now())], `getBolaoPadrao` inválido [já valida], ordem de regex PROXIMOS_JOGOS [mesmo intent], estado PIX órfão [legacy documentado]). **Bugs reais corrigidos**: (1) Catch top-level enviava `error.message` CRU pro usuário — erro de Prisma/rede vazava detalhe técnico. Novo helper `mensagemSeguraParaUsuario` encaminha só erros de domínio (curtos, sem assinatura técnica `prisma|invocation|ECONN|...`), senão genérica. (2) `send-palpite-call` chamava `setSession(PALPITANDO)` incondicionalmente — ATROPELAVA sessão de user no meio de outro fluxo (criar bolão, confirmar palpites). Agora `getSession` antes: só seta se IDLE; quem está em fluxo ainda recebe a mensagem mas mantém o contexto. (3) Mensagem de mídia (áudio/figurinha/imagem/vídeo/documento) era ignorada em SILÊNCIO TOTAL no webhook (`if (!text) return`). Público não-técnico manda áudio direto. Novo `detectouMidia` + `responderMidiaNaoSuportada` com rate-limit Redis 1h ("só entendo texto — me manda digitando"). Eventos de protocolo (reação, delete) continuam silenciosos. (4) Limpeza: var morta `inicioHoje` no palpite-call. **5 intents novas** (gaps mapeados pensando em mensagens REAIS durante a Copa): `PLACAR_JOGO` ("qual o placar?"/"quem ganhou?" — o banco TEM os placares via fetch-results ~5min, mas a pergunta caía na LLM que respondia "checa na FIFA"; handler busca AO_VIVO + FINALIZADOS 48h, filtra por time via grounding, delega fora-de-escopo pro fluxo antigo), `PONTOS_DETALHE` ("quantos pontos fiz ontem?" — breakdown jogo a jogo com palpite vs placar real + pontos, marca "⏳ calculando" se pendente), `STATUS_RODADA` ("quando atualiza o ranking?"/"cadê meus pontos?" — explica pipeline), `DESABAFO_RANKING` ("tô em último"/"fui mal demais" — acolhimento com esperança REAL: conta jogos abertos; lookahead em DESPEDIDA evita conflito "fui"/"fui mal"), `RECLAMACAO_BUG` ("meus pontos estão errados"/"tá bugado" — LOGA com motivo dedicado `reclamacao_bug` na MensagemNaoEntendida pra revisão offline + acolhe + explica recálculo automático). Knowledge ATUALIZADO: linha "Bot NÃO mostra placar ao vivo" estava DESATUALIZADA (v3.15.0 mostra; squads desde v3.11.0) — reescrita; + notas trapaça ("pontuação 100% automática, palpites privados, NUNCA mostrar palpite de outro") e mudar nome ("vem do WhatsApp"). Classifier LLM ganhou as 5 intents. 2 testes antigos atualizados ("qual o placar do jogo?" agora → PLACAR_JOGO por design; comportamento fora-de-escopo preservado via delegação no handler). **674 tests (era 646, +28)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
| **3.14.0** | **2026-06-11** | **EMERGÊNCIA pré-Copa — pipeline de pontuação INERTE descoberto e corrigido.** Investigação (3 agents Explore em paralelo + leitura direta do código) descobriu 3 bugs **bloqueantes** que tornariam o sistema completamente inerte durante a Copa 2026 (começava em 11/06 às 16h BRT, no dia seguinte). **Bug 1**: `fetch-results.job` filtrava `WHERE status='FECHADA'`. Função `rodadaService.fecharRodada` existe mas é **chamada por NINGUÉM** (sem comando admin, sem auto-fechamento). Rodada ficaria `ABERTA` o tempo todo, `fetch` retornaria `[]` indefinidamente, **placares nunca atualizariam**. **Bug 2**: `calculate-scores.job` filtrava `WHERE status='FINALIZADA'`. Rodada só vira FINALIZADA quando TODOS os jogos terminam (via `if (todosFinalizados)` em fetch-results). Fase de grupos da Copa 2026 tem **72 jogos em 15 dias**: **pontos do dia 1 só sairiam dia 26**. Usuário ficaria 2 semanas sem ver pontuação. **Bug 3**: `regras.text.ts` diz "em caso de empate, vence quem registrou mais palpites e/ou entrou primeiro" mas `recalcularRanking` só ordenava por `pontuacaoTotal DESC` — empates em ordem aleatória do banco. **Fix**: pipeline incremental por jogo. (a) `buscarRodadasComJogosEmAndamento` aceita `status IN ('ABERTA', 'FECHADA')` — trava de palpite por jogo individual (`palpite.service.ts:66` ja existente) garante UX (ninguém palpita em jogo já iniciado). (b) `atualizarResultadoJogoComResetCalc` (da v3.13.0) agora reseta `Palpite.calculado=false` SEMPRE que jogo vira FINALIZADO (antes só em correções pós-VAR). Garante que primeiro placar dispara recálculo. (c) `fetch-results.job` chama `calcularPontuacaoRodada + recalcularRanking` SEMPRE que `palpitesResetados > 0` (cálculo incremental por jogo), além do branch `if (todosFinalizados)` (ranking final). `calcularPontuacaoRodada` é idempotente — jogo sem placar retorna 0 e na próxima vez recalcula. (d) `calculate-scores.job` aceita `status IN ('ABERTA', 'FECHADA', 'FINALIZADA')` — backup pra qualquer caso onde o fetch falhar. (e) `recalcularRanking` faz desempate em cascata: `pontuacaoTotal DESC → totalPalpitesJogo DESC → entradaEm ASC` (1 extra query por participante via `prisma.palpiteJogo.count`). **59 testes novos** em `tests/unit/pontuacao.cenarios.test.ts` cobrindo EXAUSTIVAMENTE: 12 cenários de placar exato (incl 0x0, 9x0, 5x3), 4+4 cenários vencedor+gols casa/visitante, 9 cenários só resultado, 7 cenários só gols, 5 cenários errou tudo, 8 cenários inspirados na rodada inicial da Copa, 3 edge cases de placar `null`, 3 testes de simetria casa↔visitante. **Doc nova**: `docs/copa-2026-readiness.md` com diagrama do pipeline + checklist de banco/env vars/smoke test + plano de contingência se FIFA API falhar (admin pode UPDATE direto no SQL + reset manual de `calculado`). **646 tests (era 587, +59)**. Typecheck OK. `audit:prompts` 0 warnings. Sem migration. |
| **3.13.0** | **2026-06-11** | **Auditoria pré-Copa — 7 fixes em batch.** (1) **Correção de palpite em N bolões**: extensão direta da v3.12.0 (registro) para EDIÇÃO. Nova função service `corrigirPalpiteEmTodosBoloes` (reusa pipeline idempotente via UPSERT — "registrar" e "corrigir" são a mesma operação no banco). Novo branch em `handleEscolhendoBolaoEditarPalpite` detecta `ehEscolhaTodos` quando há `palpiteInline` guardado no ctx, chama nova função `registrarEdicaoEmTodosBoloes` no router que reporta consolidado ("VAR confirmou: palpite atualizado pra Brasil 3×1 Marrocos em 2 bolão(ões)!"). Apagar em TODOS NÃO incluído (decisão: destrutivo, risco médio). (2) **Texto de regras corrigido**: `regras.text.ts` dizia *"palpites travam quando o primeiro jogo da rodada começa"* — MENTIRA. Código (`palpite.service.ts:66`) trava cada jogo no seu kickoff individual. Verdade reescrita: *"Cada palpite trava quando o jogo dele começa — depois de um jogo começar, você ainda pode palpitar nos próximos"*. Adiciona explicitamente "Horários em fuso de Brasília 🇧🇷". (3) **BASE_CONTEXT do LLM com pontuação errada**: `system-prompts.ts` dizia *"5 pts placar exato, 3 pts vencedor, 2 pts empate"* — pontuação antiga. Corrigido pra 10/7/5/3/0 + adiciona "admin NÃO vê palpite individual" (v3.11.0) + "multi-bolão TODOS" (v3.12.0). Afetava classifier, extractor, matchers — toda LLM herdava o erro. (4) **`send-bom-dia.job.ts` reescrito** com janela adaptativa "6h antes do próximo jogo + cooldown 24h" (decisão de design com o user). Substitui horário fixo 09:00 BRT que perdia jogos noturnos (Copa 2026 sede Costa Oeste EUA pode ter jogos 23h-04h BRT). Clamp [07:00-22:00 BRT] garante hora civilizada. Lista TODOS jogos das próximas 30h marcando ✅ palpitado / ⚪ pendente. Cross-job flag Redis `aviso_jogo:{waId}` TTL 24h compartilhada com `send-palpite-call` — máximo 1 aviso de jogo por user por dia. Header adaptativo por horário (☀️ Bom dia / ⚽ Tem Copa / 🌙 Boa noite madrugada vai ter). (5) **Reset de scoring quando placar é corrigido**: `Palpite.calculado=true` bloqueava recálculo se API corrigia resultado pós-VAR/gol anulado. `rodadaRepo.atualizarResultadoJogoComResetCalc` agora lê placar antes, compara com novo, se mudou faz `updateMany Palpite SET calculado=false WHERE jogos.some(jogoId)`. `resultado.service.atualizarResultados` deixa passar jogos FINALIZADOS se placar mudou, e loga `[scoring-reset] jogoId placarAntes placarDepois palpitesResetados=N`. Próximo tick de `calculate-scores.job` recalcula automaticamente. (6) **ENABLE_* env vars** (`ENABLE_BOM_DIA`, `ENABLE_PALPITE_CALL`, `ENABLE_REMINDERS`, defaults `true`) pra desligar canais isoladamente em staging sem mexer em `DRY_RUN_WHATSAPP` global. (7) **Script `npm run audit:prompts`**: novo `scripts/audit-prompts.mjs` faz grep cross-reference em `regras.text.ts` + `knowledge.produto.ts` + `system-prompts.ts` validando 8 fatos críticos (pontuação 10/7/5/3/0, prazo por jogo, admin NÃO vê, Brasília mencionada, TODOS). Exit 1 se discrepância. Doc completa em `docs/jobs.md` com pipeline visual e tabela de jobs. **28 testes novos** (7 ranking edge cases incluindo 0x0 + 5x3 + placar inverso, 13 regras.text.test, 8 system-prompts.test). **Fact-check confirmado direto do openfootball/worldcup.json/2026**: 72 jogos fase de grupos (12 × 6) + 32 mata-mata (Round of 32: 16, R16: 8, QF: 4, SF: 2, 3º: 1, Final: 1) = 104 total. Bot já mostrava "72 da rodada" corretamente. **587 tests (era 559)**. Typecheck OK. `audit:prompts` passa 0 warnings. Sem migration, sem env var obrigatória. |
| **3.12.0** | **2026-06-11** | **Lote de palpites em N bolões com opção TODOS (caso Bruna 10/06).** Conversa real: Bruna participa de 2 bolões com mesma rodada de amistosos. Hoje precisava mandar 10 palpites + escolher bolão + confirmar — repetir tudo igual pro outro bolão = 36 mensagens pra 20 palpites. ISSUE-015 (v3.1.3) já resolvia esse caso pra UM palpite (estado `CONFIRMANDO_PALPITE_MULTI_BOLAO`), mas não foi estendido pra LOTE. Fix: (a) novo helper `ehEscolhaTodos(texto, totalNaLista)` em `lista.helper.ts` que aceita "todos"/"ambos"/"tudo"/"all"/índice N+1. (b) `handlePalpiteInlineEmIdle` (`command.router.ts:1838`) agora detecta lote (2+ âncoras `NxN`) com >1 bolão e adiciona opção EXTRA "N+1. ⭐ *TODOS*" na lista, junto de dica `_(responda *N+1* ou *todos*)_`. (c) `handleEscolhendoBolaoParaPalpitar` ganha branch pra `ehEscolhaTodos` → chama `iniciarConfirmacaoPalpitesMultiBolao`. (d) Novo fluxo `iniciarConfirmacaoPalpitesMultiBolao`: extrai palpites usando UNIÃO dos jogos abertos de todos os bolões selecionados (dedup por `normalizeTeamName`), monta preview *"📝 Vou registrar 10 palpite(s) em 2 bolões: Bolão A, Bolão B"* + lista de palpites + "sim/não/refazer". (e) Novo state FSM `CONFIRMANDO_PALPITES_INLINE_MULTI_BOLAO` (em `session.manager.ts:74`) com ctx `palpitesParaConfirmarMultiBolao`. (f) Novo handler `handleConfirmandoPalpitesInlineMultiBolao` consome o novo service plural. (g) Nova função service `registrarPalpitesEmTodosBoloes` em `palpite.service.ts:285`: recebe lista de palpites, itera **por bolão em paralelo** com `Promise.all`, dentro de cada bolão sequencial (evita race de transação), tenta `registrarComRetry` (wrapper com 1 retry de 200ms pra erro transitório — não retenta erro de domínio "ja comecou"/"placar"/"rodada fechada"). Retorna relatório consolidado `{porBolao: [{bolaoNome, registrados, naoAplicaveis, erros}], totalPalpitesDoLote}`. Idempotência garantida pelo UPSERT já existente em `palpiteRepo.registrarPalpiteJogo` — reenvio sobrescreve silenciosamente. (h) Mensagem de confirmação **transparente**: mostra X/Y por bolão + indica jogos que não estão no bolão (`_(3 jogos não estão neste bolão)_`) + lista até 6 erros específicos se houver, com instrução *"manda de novo — registros já feitos não duplicam"*. (i) Knowledge atualizado citando o caso. (j) Adicionado `CONFIRMANDO_PALPITES_INLINE_MULTI_BOLAO` à lista de `ESTADOS_PROIBIDOS_CODIGO` (impede que "1"/"todos"/"sim" sejam tratados como código de bolão acidentalmente). **13 testes novos** (11 patterns `ehEscolhaTodos` + 1 anti-falso-positivo + 1 knowledge cobertura). **559 tests (era 546)**. Typecheck OK. UX reduzida: 36 → 4 mensagens. |
| **3.11.0** | **2026-06-11** | **3 fixes da conversa Jeni 11/06 + ingestão de convocações.** (a) **Fuso horário do display**: bot listou "13/06, 22:00 — Brasil x Marrocos" em VPS UTC, mas o jogo é às 19h Brasília. JSON tava certo (`2026-06-13T19:00:00-03:00`), sync script convertia certo, banco certo, trava de palpite certa por acaso (ambos UTC) — **só o display mentia** porque `toLocaleString` sem `timeZone` usa o fuso do servidor. Criado helper `src/utils/datetime.ts` com `formatarDataHoraCurtaBR/ComDiaBR/formatarDataBR/formatarHoraBR` que SEMPRE força `America/Sao_Paulo`. Aplicado nos 3 callsites do `command.router.ts` (`PROXIMOS_JOGOS`, `MAIS_JOGOS`, `QUANDO_COMECA`). Audit confirmou que jobs já estavam corretos. Teste robusto: roda sob `TZ=UTC` simulando VPS de produção e prova que display vira 19:00. (b) **Knowledge ambíguo sobre admin ver palpites**: bot deu respostas contraditórias em 2 conversas reais — pra um disse "ninguém vê", pra outro disse "admin vê". Verdade técnica: ZERO handlers/queries/intents permitem admin ver palpite individual. Knowledge tinha *"ninguém vê o seu palpite (nem outros participantes)"* — ambíguo, não citava admin. LLM alucinou exceção. Texto reescrito como "Palpite é 100% privado. Admin NÃO vê o placar — vê só X/Y palpites por pessoa". Também adicionado bloco "🔒 Privacidade" no `formatAjuda`. (c) **Ingestão de squads.json**: openfootball publica convocações em `openfootball/worldcup/master/more/2026_squads.txt` (formato txt regular). Adicionado parser `parseSquadsTxt` no sync script — 48 seleções, 1245 jogadores parseados. Novos tipos `Jogador`/`SquadTime` + funções `getJogadoresDoTime(busca)` e `buscarJogador(nome)` no módulo copa-2026. Grounding ganha motivo `SQUAD`, detector regex (`convoca/elenco/squad/escalação/jogadores`), `blocoJogadores(time)` lista convocados agrupados por posição, e `blocoJogadorEspecifico(nome)` pra perguntas tipo "Neymar foi convocado?". SQUAD tem precedência sobre `TERMOS_FORA_ESCOPO` (que tinha "neymar"/"mbappe"/etc como recusa porque antes o bot não tinha dados de jogador). **19 testes novos**: 6 datetime (rodando sob `TZ=UTC` pra provar robustez); 7 squads no módulo; 5 SQUAD no grounding; 1 knowledge. **546 tests (era 527)**. Também respondida pergunta de design sobre enviar histórico de mensagens pro LLM: NÃO recomendado (5 contras críticos: privacidade [palpite vazar entre features], prompt injection, custo, latência, complexidade; ganho marginal ~5%). Alternativa que já existe e cobre 95%: sessão FSM (`session.manager.ts`). |
| **3.10.0** | **2026-05-22** | **BUG CRÍTICO de mentira do LLM — bot disse "palpites registrados" sem registrar (caso Valéria 22/05 11:23).** Análise da conversa: (1) Valéria mandou 10 palpites em UMA linha só "1x1 México x África do Sul 1x0 Coreia do Sul x República Tcheca..." — `PALPITE_REGEX = /^(.+?)\s+(\d+)\s*[xX-]\s*(\d+)\s+(.+)$/` casou via backtracking time1="1x1 México x África do Sul" e time2="Coreia do Sul x ... Japão" (sequestrando 9 palpites como timeVisitante). `acharJogo` permissivo (`normTc.includes()` OR `normTv.includes()`) bateu UM jogo qualquer com "México" como casa e "Coreia do Sul" mencionado, mostrou 1 palpite errado. (2) Estado de confirmação rejeitou a 2ª submissão de 10 palpites com sim/não/refazer. (3) Após "refazer", Valéria mandou 10 palpites em LINHAS SEPARADAS no formato invertido "1x1 México x África do Sul" (placar antes dos times) — `PALPITE_REGEX` não suporta esse formato e falhou em todas as linhas. Caiu em `TEXTO_LIVRE` → `responderConversacional` (smart-fallback LLM) que **mentiu**: "Entendi! Seus palpites foram registrados. Bora pra Copa 2026! ⚽️". Nada foi salvo, mas user acreditou. Depois bot mostrou "0 palpites" e "Você ainda não palpitou em nenhum jogo". **Confiança destruída.** Fix em 5 frentes: (a) Novo regex `PALPITE_INVERTIDO_REGEX` aceita "NxN Time1 x Time2"/"NxN Time1 vs Time2"/"NxN Time1 - Time2", tentado em `tentarParsearPalpiteInline` depois do canônico, antes do extenso. (b) Validador anti-match-ruim em `tentarParsearPalpiteInline`: descarta match se time1/time2 contém placar embutido (regex `PLACAR_ANCHOR_REGEX`) OU se time >40 chars — impede sequestro de palpites concatenados. (c) Novo `tokenizarPalpitesEmUmaLinha`: detecta 2+ âncoras `NxN` numa linha, separa em palpites individuais usando os trechos entre âncoras como "T1 x T2". Chamado em `parseMultiplePalpitesDetalhado` quando linha falha parser mas tem 2+ âncoras — recupera os 10 palpites da Valéria. (d) Novo módulo `palpite.heuristics.ts` com `parecePalpiteMasNaoEntendi(texto)`: detecta 2+ âncoras `NxN` em texto que falhou todos os parsers, **bloqueia** chamada de `responderConversacional` no smart-fallback, responde com instrução de formato (não com LLM). Esse é o guard CRÍTICO: mesmo que parser falhe em casos futuros que não previmos, o guard impede LLM de mentir "registrei". (e) Reforço duplo no system prompt: `RESPONDER_PROMPT` ganha proibição explícita citando o bug real ("NUNCA escreva 'registrei', 'palpites foram registrados', 'está feito' — voce NAO tem ferramenta de registro"); `knowledge.produto.ts` ganha seção "PROIBIÇÃO ABSOLUTA" com referência ao incidente Valéria 22/05. **20 testes novos** (10 parser cobrindo formato invertido, tokenizer, anti-validação, mistura; 10 da heurística cobrindo positivos e negativos; 1 knowledge cobrindo a proibição). **527 tests (era 507)**. Typecheck OK. |
| **3.9.0** | **2026-05-22** | **Onboarding leve pra novato — 2 intents acolhedoras.** Análise da conversa Valéria Midon 22/05 (11:09-11:10) expôs 2 lacunas distintas: (1) Valéria mandou *"você tem dicas de como montar os palpites?"* — bot respondeu com pitch de INFO_PRODUTO (que era resposta a "o que é isso?", não a "tem dicas?"). Causa raiz: nenhum pattern cobria "dica/estratégia/como monto" pra palpite, e a fallback LLM mal-classificou como INFO_PRODUTO. (2) Valéria mandou *"nao entendo de futebol"* (expressão de vulnerabilidade) — bot caiu em fallback genérico "Não peguei essa, craque" com menu numerado. Resposta tecnicamente correta (não conseguiu casar) mas péssima de UX. Toda gente nova passa por isso. **Fix**: (a) Nova intent `DICAS_PALPITE` com 15 patterns ("tem dicas", "dicas pra palpitar", "como monto/decido/escolho", "qual placar comum", "tem estratégia", "me ensina") + handler `handleDicasPalpite` com resposta determinística cobrindo pontuação resumida, placares mais comuns em Copa (1x0, 2x1, 2x0, 1x1 — fato histórico, não predição), e 4 dicas práticas de uso (palpita em tudo, foco em vencedor que dá 3pts e é mais fácil, vai no coração se não souber, dá pra editar). Não dá dica de aposta. (b) Nova intent `ACOLHIMENTO_NOVATO` com 15 patterns ("nao entendo/sei/manjo de futebol", "futebol não é minha praia", "to perdid[oa]", "primeira vez/novato", "nunca palpitei", "to com medo de errar", "vou errar tudo", "sou leiga/iniciante") + handler `handleAcolhimentoNovato` com tom acolhedor sem condescendência: "Relaxa! Não precisa entender nada — gente palpita no aleatório/coração/cor da camisa e ganha" + 3 passos básicos + CTAs leves (*dicas*, *regras*, *próximos jogos*) ajustados se user já tá em bolão ou não. (c) Ambos posicionados ANTES de `COMO_PALPITAR` e `INFO_PRODUTO` no INTENT_RULES (são mais específicos). (d) Classifier LLM (`system-prompts.ts`) ganha definição explícita das duas, distinguindo de COMO_PALPITAR/INFO_PRODUTO. (e) Knowledge ganha seção `TOM PRA NOVATO / INSEGURO` explicando à LLM como acolher se cair em smart-fallback, com proibição explícita de dar predição de jogo. (f) `formatAjuda` ganha bloco "Tá perdido(a)?" no guia completo, mencionando *dicas* e dizendo "se não entende de futebol, manda isso mesmo — eu explico". **23 testes novos** (10 DICAS_PALPITE incluindo as duas frases reais da Valéria; 11 ACOLHIMENTO_NOVATO; 2 anti-falsos-positivos garantindo que "como dou palpite" continua COMO_PALPITAR e "perdi minha senha" não vira ACOLHIMENTO_NOVATO). **507 tests (era 484)**. |
| **3.8.0** | **2026-05-22** | **Visibilidade de progresso pro admin + legenda de emoji no knowledge.** Bug Jeniffer 22/05: ela perguntou "Mais gente registrou Palpites?" e "Quero ver se as pessoas que entraram registram algum palpite" — bot respondeu "essa eu não sei te responder direito" (recusa correta da v3.6.0 porque a feature não existia). Também perguntou "Pq a Melissa e eu estamos com emoji e as outras não?" — bot deu pitch do produto. **Fix em 3 frentes**: (1) Nova intent `PROGRESSO_PALPITES` (qualquer participante) com handler `handleProgressoPalpites` que mostra "Já palpitaram (N)" com X/Y palpites por pessoa, ordem desc + "Ainda não palpitaram (M)" ordem alfabética. Não revela placar individual — só quantidade. 15 patterns regex cobrindo "quem palpitou", "mais gente registrou", "progresso", "status", "quem ta atrasado", etc. (2) Nova intent `CUTUCAR_PENDENTES` (admin only) com handler `handleCutucarPendentes` que itera os pendentes e manda DM personalizada citando o admin: "*<Nome>* (admin do *<bolão>*) pediu pra te lembrar de palpitar". Idempotente: flag Redis `cutucar_admin:{bolaoId}` TTL 30min impede spam. (3) Knowledge `LEGENDA DE EMOJI NAS LISTAS` adicionada — explica 👑 (admin, bot adiciona), ⭐ (bolão padrão), 🏁 (finalizado), ✅/⚪ (palpitou/não palpitou), e que outros emojis no nome de pessoas (🍀, 🏆, etc.) são parte do nome cadastrado pelo próprio usuário. Resolve perguntas tipo "por que fulano tem emoji?" sem precisar de intent dedicada. (4) Ambos `PROGRESSO_PALPITES` e `CUTUCAR_PENDENTES` adicionados ao prompt do classifier LLM. **484 tests (era 468), 16 novos** (10 patterns PROGRESSO + 5 CUTUCAR + 1 anti-falso-positivo em MEU_PALPITE + 2 knowledge tests). Privacidade: o handler NÃO mostra placar de palpite — só "X palpitou em Y/Z jogos". |
| **3.7.0** | **2026-05-22** | **Edição de palpite robusta: inline em 1 passo, LLM fallback, validação por jogo, "era X virou Y".** Auditoria do fluxo `EDITAR_PALPITE` (ISSUE-011 da v3.1) identificou 4 gaps: (1) `corrigir Brasil 3x1` perdia o placar inline e exigia 2 passos; (2) "muda meu palpite pra 3 a 1 pro Brasil" caía no fallback do smart porque regex falhava; (3) `palpite.service:registrarPalpiteEmRodada` só checava `rodada.dataFechamento` mas na Copa cada jogo tem kickoff próprio — user podia editar palpite de jogo que já tinha começado; (4) confirmação genérica "palpite atualizado" sem mostrar de qual valor pra qual. **Fix**: (a) novo helper `extrairPlacarInlineDoComando` strip de "corrigir/mudar/etc." e tenta `parseIntencao` no resto — atalho de 1 passo aceita "corrigir Brasil 3x1 Marrocos" / "mudar pra Brasil 2x1" / "atualizar Brasil 3 a 1" / "alterar Brasil 2 por 0" / "refazer Brasil 1-1". (b) `handleEditandoPalpiteNovoPlacar` ganhou cadeia regex → `parseMultiplePalpites` → LLM `extrairPalpites` com lista de jogos da rodada como contexto. (c) `palpite.service` agora rejeita palpite se `jogo.dataHora <= now()` ou `jogo.status !== 'AGENDADO'` — mensagem amigável "esse jogo já começou". (d) Retorna `RegistrarPalpiteResult` com `anterior` (placar antigo) — handlers usam pra mostrar "Era *Brasil 2x1 Marrocos*, virou *Brasil 3x1 Marrocos*". (e) Novo `palpiteInline` em `ConversaContext` pra guardar placar entre escolha de bolão e registro. (f) Novos patterns regex em `EDITAR_PALPITE_PATTERNS` exigindo placar embutido (N x N / N a N / N por N / N-N) pra evitar falsos positivos como "mudar de bolão" / "atualizar senha". Mensagens de erro amigáveis pra "jogo já começou" e "jogo não encontrado". **468 tests (era 461), 7 novos cobrindo placar inline (5 positivos) + 2 anti-falso-positivo.** |
| **3.6.0** | **2026-05-22** | **Knowledge base do produto no LLM conversacional — fim das dúvidas mal respondidas sobre o bolão.** Sintoma reportado: usuário perguntou "posso mandar vários palpites de uma vez?" e o bot não soube responder corretamente. Diagnóstico: o `responderConversacional` (smart-fallback do IDLE + handler de PERGUNTA_GERAL_FUTEBOL) não tinha fato nenhum sobre o produto no system prompt — LLM chutava ou dizia "não sei". **Fix**: novo arquivo `src/llm/knowledge.produto.ts` exporta `KNOWLEDGE_PRODUTO` (~1500 chars) com bullets verificáveis: pontuação 10/7/5/3/0 com exemplos, prazo de palpite (até kickoff de cada jogo), MULTI-PALPITE (várias por mensagem com vírgula/linhas), editar/apagar palpite + comandos exatos, ranking + critério de desempate, multi-bolão + bolão padrão, admin/convite/ID curto (não senha), custo grátis, escopo Copa 2026 + lista do que NÃO cobre, comandos rápidos, privacidade. Injetado SEMPRE no system prompt do `responderConversacional` (sem detector — robustez supera economia de ~500 tokens). `RESPONDER_PROMPT` ganhou seção "DUAS FONTES DE FATOS" diferenciando [REGRAS DO BOT] (produto) de [FATOS VERIFICADOS] (Copa 2026). Regra-ouro anti-alucinação ampliada pra cobrir regras do produto. Novo `tests/unit/knowledge.produto.test.ts` com 14 testes anti-drift (bate o knowledge contra `PONTUACAO_PADRAO` do código + verifica cobertura de cada área). **461 tests (era 447), 14 novos.** |
| **3.5.0** | **2026-05-22** | **Paginação honesta de PROXIMOS_JOGOS + nova intent MAIS_JOGOS.** Bug reportado (Joao Arruda, 21/05): bot mostrou 10 jogos com o rótulo "Todos os palpites desta rodada já estão registrados! 🍀" depois que ele palpitou nos 10 — **falso**, porque a rodada da fase de grupos tem 72 jogos e ele só viu os 10 mais cedo (filtro `take: 10` no `command.router.ts:3414`). **Fix**: (1) `handleProximosJogos` removeu o `take` da query, busca toda a rodada e faz slice no JS com offset persistido no Redis (`pj_offset:{waId}:{bolaoId}`, TTL 60min). (2) Nova intent `MAIS_JOGOS` com 12 padrões regex ("mais jogos", "mais palpites", "próximos 10", "outros jogos", "tem mais jogos?", "ver mais", "continuar palpitando", etc.) — handler avança offset +10, volta pro topo quando estoura. (3) Mensagem reescrita com **contador honesto**: "Mostrando jogos X–Y de Z. Palpites seus neste lote: N/lote. Faltam W palpite(s) no bolão." (4) **Cutucada inline automática** (`talvezOferecerMaisJogos`): após registrar palpite, se o user fechou todos os jogos do último lote visto E ainda há pendentes na rodada, bot oferece o próximo lote ("Fechou esses 10 👏 Ainda tem X jogos abertos. Manda *mais jogos*"). Idempotente via flag Redis (`pj_oferta:`, TTL 30min). (5) Dica de multi-palpite enfatizada: "Pode mandar VÁRIOS palpites de uma vez separados por vírgula". (6) Patterns `MAIS_JOGOS` colocados antes de `PROXIMOS_JOGOS` no `INTENT_RULES` pra ter precedência. **447 tests (era 438), 9 novos cobrindo todos os patterns de `MAIS_JOGOS` + garantia de precedência sobre `PROXIMOS_JOGOS`.** |
| **3.4.0** | **2026-05-22** | **Grounding da Copa 2026 — fim da alucinação em perguntas gerais de futebol.** Bug reportado da VPS em 21/05: usuário perguntou "Quais próximos jogos da Inglaterra?" e bot respondeu "Inglaterra tá no grupo C da Copa 2026, junto com EUA, Irã e uma equipe que ainda vai se classificar" — tudo errado (Inglaterra está no Grupo L com Croácia/Gana/Panamá; Grupo C é Brasil/Marrocos/Haiti/Escócia). Gemini-flash-lite alucinava porque o prompt 3.3.0 autorizava "conhecimento próprio + disclaimer". **Fix**: (1) Novo snapshot canônico em `src/data/copa-2026/` com 4 JSONs do openfootball/worldcup.json (matches.json — 104 jogos grupos+mata-mata; teams.json — 48 seleções com bandeira/código FIFA; stadiums.json — 16 estádios; metadata.json). (2) Novo módulo `src/modules/copa-2026/` com API consultada por código: `getGrupoDoTime`, `getComposicaoGrupo`, `getProximosJogosDoTime`, `getEstadios`, `normalizarNomeTime` (dicionário PT↔EN+aliases). (3) Novo `src/llm/copa.ground.ts` — detector regex/dict pré-LLM monta bloco `[FATOS VERIFICADOS]` injetado na user message; recusa fora-de-escopo (Libertadores/Brasileirão/clube/jogador) ANTES de chamar Gemini via `respostaForaDeEscopo()`. (4) `RESPONDER_PROMPT` reescrito com regra-ouro anti-alucinação: "só pode afirmar fatos da Copa 2026 que estejam no bloco". (5) `responderConversacional` ganhou 2º param `bloqueFatos?`. (6) `handlePerguntaGeralFutebol` agora chama o grounding antes da LLM. (7) Novo `scripts/sync-copa-2026.mjs` (npm run sync:copa-2026) — baixa do GitHub do openfootball, regenera os 4 JSONs + o legacy `fifa-2026-fixtures.json`. **438 tests (era 400), 38 novos testes em `copa-2026.test.ts` (23) + `copa-ground.test.ts` (15) cobrindo bug original, todos os 12 grupos, fora-de-escopo, normalização PT/EN/alias.** |
| **3.3.1** | **2026-05-18** | **Hotfix Gemini 503 + timeout apertado.** Após deploy do 3.3.0 na VPS, usuário recebeu mensagem fallback "assistente fora do ar" mesmo com o caminho LLM correto — porque o **Gemini 2.5 Flash Lite estava retornando HTTP 503 ("This model is currently experiencing high demand")** com frequência alta no Google. Diagnóstico via novo `scripts/test-conversational.ts`. **Fix:** (1) `chatGemini` agora faz **retry automático com backoff** (400ms, 1200ms) em status retryable: HTTP 503, 429, 408, timeouts (até 3 tentativas total). (2) `LLM_TIMEOUT_MS` default subiu de **5000→8000ms** — Gemini sob carga responde em 4-7s; 5s causava abort prematuro. (3) Logs ANTES silenciosos quando `LLM_ENABLED=false` ou `GEMINI_API_KEY` vazia agora geram `[llm] gemini SKIP` — diagnóstico de config errado fica óbvio. (4) Mensagem fallback no `handlePerguntaGeralFutebol` reescrita pra explicar congestionamento momentâneo + sugerir retry. (5) Fallback automático pra Ollama Cloud continua funcionando — se VPS tiver `LLM_API_KEY` real da Ollama configurada, perguntas que falham no Gemini caem nele transparentemente. **400 tests (era 397), 116 cenários, novo `scripts/test-conversational.ts` pra smoke test do fluxo completo.** (este documento) |
| 3.2.0 | 2026-05-18 | **Expansão de cordialidade + histórico persistente.** **4 novos intents de cordialidade**: `DESPEDIDA` (tchau/flw/abraço/fui), `CUMPRIMENTO_CASUAL` (tudo bem?/blz?/como vai?), `CONCORDANCIA_CASUAL` (ok/beleza/show/perfeito — só em IDLE; em CONFIRMANDO_* o FSM pega antes), `RISADA` (kkk/rsrs/hahaha/😂). Cada um com handler dedicado e variantes randomizadas — não reabrem menu. **Nova tabela Prisma `MensagemNaoEntendida`** substitui a antiga lista Redis (TTL 30d) por persistência indefinida queryable via SQL. Captura também casos `low_confidence` (LLM tentou classificar mas ficou < 0.55) com `llmIntent` + `llmConfianca` — ouro pra descobrir variantes que merecem virar regex. `classificarIntencao` mudou de retornar `Intencao\|null` para `ClassificationOutcome` com `intencao` + `intencaoTentada` + `confianca`. LGPD: `whatsappId` nunca em claro — só hash sha256-16; FK `usuarioId` com `ON DELETE SET NULL`; job mensal de limpeza derruba registros antigos via `MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS` (default 180). **377 tests (era 342), 102 cenários (era 85).** (este documento) |
