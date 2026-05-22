# ⚽ VAR do Bolão

> Bot de WhatsApp brasileiro pra gerenciar bolões de futebol em **conversa
> direta (DM)** — sem grupo, sem app, sem fricção. Foco atual: Copa do Mundo
> FIFA 2026.

[![Tests](https://img.shields.io/badge/tests-400%20passing-green)]()
[![Node](https://img.shields.io/badge/node-20%2B-blue)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)]()
[![LLM](https://img.shields.io/badge/LLM-Gemini%202.5%20Flash%20Lite-orange)]()

---

## O que é

Cada usuário adiciona o número do bot como contato. Tudo acontece em DM:

- **Admin** cria bolão (gratuito nesta fase). Recebe um *ID curto* (`#K3MZ8P`)
  e um *link wa.me clicável* pra encaminhar pros convidados.
- **Convidado** clica no link → WhatsApp abre conversa com bot já preenchida
  → manda → admin recebe e aprova em linguagem natural.
- **Palpites**: usuário manda `Brasil 2x1 Marrocos` (ou variantes em PT-BR
  coloquial) a qualquer momento. Bot detecta o(s) bolão(ões) com rodada
  aberta, mostra preview e pede confirmação.
- **Ranking**: enviado automaticamente de hora em hora durante a Copa.

---

## Por que é interessante

- **DM-only** = privacidade de palpites + janela de 24h da WhatsApp Business
- **Híbrido regex → LLM**: 80% das mensagens resolvem com regex (latência
  <100ms, custo zero). O resto cai no Gemini Flash Lite (~400ms, ~$0.00002/msg).
- **PT-BR coloquial nativo**: entende "bora dar uns palpites", "Brasil perde
  de 1 a 0 do Marrocos", "qual a senha?" (com handler dedicado pra não
  gastar LLM).
- **FSM por usuário em Redis (TTL 30min)**: fluxos de criação, entrada,
  palpite multi-turno funcionam sem confundir mensagens.
- **Auto-recuperação**: 3 tentativas em entrada por nome, FSM escape pra
  intents fortes, fast-path de código em quase todos os estados.

---

## Stack

| Camada | Tech |
|---|---|
| Runtime | Node.js 20 + TypeScript 5 (ESM) |
| HTTP | Fastify 5 |
| Banco | PostgreSQL 16 + Prisma 6 |
| Cache/FSM | Redis 7 (ioredis) |
| WhatsApp | Evolution API v2.x (fork `evoapicloud`) |
| LLM | Google Gemini `gemini-2.5-flash-lite` (Ollama Cloud fallback) |
| Scheduler | `node-cron` (jobs hourly + */5min) |
| Tests | Vitest (280+ unit + 55 simulação) |

---

## Quick start (dev)

### Requisitos
- Node.js 20+
- Docker + Docker Compose
- Conta em [aistudio.google.com](https://aistudio.google.com/apikey) (Gemini grátis até 1500 req/dia)

### Setup

```cmd
:: clone + deps
git clone https://github.com/habr7/var-do-bolao.git
cd var-do-bolao
npm install

:: env
cp .env.example .env
:: editar .env: GEMINI_API_KEY, EVOLUTION_API_KEY, POSTGRES_PASSWORD

:: infra
docker compose up -d
npx prisma migrate dev

:: dev
npm run dev
```

Bot escuta em `http://localhost:3000`. Webhook em `/webhook/whatsapp`.

### Parear WhatsApp

```cmd
:: gera QR code
curl -H "apikey: <EVOLUTION_API_KEY>" http://localhost:8080/instance/connect/varbolao
```

Escaneia o QR no WhatsApp do número que vai ser o bot.

### Testar sem WhatsApp real

```cmd
npm run sim              :: REPL interativo
npm test                 :: unit tests (~5s)
npx tsx scripts/simulate-conversation.ts    :: 55 cenários
```

---

## Deploy / Produção (VPS + Docker)

Produção roda em **VPS (Contabo, Ubuntu 24.04)** via Docker Compose com perfil
`full` (todos os containers, incluindo o `app`), atrás de Nginx + HTTPS.

**Atualização padrão** (no VPS, após `git pull`):

```bash
cd ~/var-do-bolao && git pull && docker compose --profile full up -d --build
```

O `--build` é obrigatório (o Dockerfile compila TS→JS no build; sem ele o
container roda o código antigo). Se o commit mexeu em `prisma/`, rode também
`docker compose exec app npx prisma migrate deploy`.

Runbook completo (migrations, rollback, rodar scripts em prod, troubleshooting,
o que **nunca** rodar): ver **[DEPLOY.md](DEPLOY.md)**.

---

## Estrutura

```
src/
├── whatsapp/         FSM + parser regex + handlers (command.router.ts)
├── llm/              Gemini + Ollama + 4 prompts especializados
├── modules/          bolao, palpite, ranking, solicitacao, rodada, ...
├── jobs/             cron jobs (fetch-results, send-bom-dia, ranking, etc)
└── utils/            códigos curtos, métricas Redis, validators

scripts/
├── sim.ts                       REPL local
├── simulate-conversation.ts     55+ cenários determinísticos
├── seed-fifa-2026.ts            popula Copa
├── sync-copa-2026.mjs           baixa dados oficiais do openfootball + regenera src/data/copa-2026/*
├── test-gemini.ts               smoke test API real
└── test-conversational.ts       smoke test do conversacional+grounding

prisma/schema.prisma  Usuario, Bolao, Pagamento, Solicitacao, Rodada, Jogo, Palpite
```

Ver **[VAR_DO_BOLAO_ARQUITETURA.md](VAR_DO_BOLAO_ARQUITETURA.md)** para
detalhes completos (pipeline, intents, FSM states, jobs, métricas, deploy).

---

## Comandos do bot

Ver **[docs/commands.md](docs/commands.md)** para a cheatsheet completa.

Resumão:

| O que mandar | O que o bot faz |
|---|---|
| `oi`, `menu` | Boas-vindas + menu |
| `criar bolão` | Inicia fluxo (nome → senha → ID + link wa.me) |
| `entrar em bolão` ou `#K3MZ8P` | Cria solicitação de entrada |
| `Brasil 2x1 Marrocos` | Registra palpite (confirma antes) |
| `ranking` | Ranking do bolão |
| `meus pontos` | Pontuação pessoal |
| `meus palpites` | Histórico de palpites |
| `próximos jogos` | Jogos abertos pra palpitar |
| `regras` | Regras de pontuação (10/7/5/3/0) |
| `como convido` | Link wa.me pra encaminhar (admin) |
| `excluir bolão` | Encerra bolão (admin, confirmação textual) |
| `pendentes` | Lista pedidos pendentes (admin) |
| `aprovado Fulano` / `recusar Fulano` | Aprova/recusa em NL (admin) |
| `cancelar` | Sai de qualquer fluxo |

---

## Testes

```cmd
npm test                                           :: 280+ unit tests
npm run test:watch                                  :: watch mode
npx tsx scripts/simulate-conversation.ts            :: 55+ cenários
npx tsx scripts/test-gemini.ts                      :: smoke Gemini real
```

Ver **[docs/TESTING.md](docs/TESTING.md)** pra estratégia completa.

---

## Pontuação

Função pura `calcularPontos` em `src/modules/ranking/pontuacao.calc.ts`:

| Caso | Pontos |
|------|--------|
| Placar exato | **10** |
| Resultado certo + gols de um time | **7** |
| Apenas resultado certo | **5** |
| Apenas gols de um time | **3** |
| Errou tudo | **0** |

---

## Observabilidade

Logs estruturados (filtra com `grep` ou `Select-String`):

| Tag | Quando |
|-----|--------|
| `[timing]` | toda mensagem — `total=Xms` |
| `[llm]` | toda chamada Gemini/Ollama |
| `[smart-fallback]` | LLM responder respondeu fora das intents |
| `[nao-entendi]` | tudo falhou (gold mine pra criar handlers novos) |
| `[fsm-escape]` | estado interrompido por intent forte |
| `[multi-palpite]` | parse multilinha |

Contadores agregados em Redis (`metrics:YYYY-MM-DD`, TTL 30d). Amostras de
mensagens não-entendidas em `metrics:YYYY-MM-DD:nao-entendi` (top 500).

---

## Roadmap

Ver **[BUGS_E_CENARIOS_VAR_DO_BOLAO.md](BUGS_E_CENARIOS_VAR_DO_BOLAO.md)** —
47 issues organizadas em 3 sprints.

✅ **Sprint 1 concluído (2026-05-17)**: ISSUES 001-008 (códigos legados,
busca fuzzy, entrada sem senha, INFO_SENHA, EXCLUIR_BOLAO, fast-path
expandido, métricas Redis) + link wa.me (ISSUE-040 antecipado).

✅ **Sprint 2 concluído (2026-05-17)**: ISSUES 009-023 (handlers
INFO_PRODUTO/INFO_PRECO/COMO_PALPITAR/QUANDO_COMECA, editar/apagar
palpite, validação de placar absurdo, palpite com time errado, palpite
multi-bolão auto-apply, bolão padrão com migration nova, "meus bolões"
sempre com ID, renomear bolão admin, remover participante admin, texto
detalhado em "sair", RESUMO_BOLOES). 322 tests.

🟡 **Sprint 3 / restante** (P2): cutucar, mudar nome próprio, transferir
admin, palpites passados de outros, atalhos numerados, undo, rate limits,
sanitização (033-038, 024-032).

---

## Contribuindo

1. Branch do `main`: `claude/<nome>-<hash>`
2. Toda mudança estrutural (intent, FSM, módulo, env) **atualiza a doc**
   — ver `.claude/skills/manter-docs-atualizada/SKILL.md`
3. Add cenário em `scripts/simulate-conversation.ts` pra bug novo
4. `npm test` + simulação + `npx tsc --noEmit` antes do PR
5. PR pro `main` com descrição clara

---

## Licença

Privado — uso interno até decisão de open-source.

---

## Histórico curto

- **v3.8.0** (2026-05-22) — Visibilidade de progresso pro admin + legenda de emoji no knowledge. Bug Jeniffer 22/05: bot recusava "Mais gente registrou palpites?" porque a feature não existia. Agora 2 intents novas: `PROGRESSO_PALPITES` (qualquer participante vê quem palpitou X/Y) e `CUTUCAR_PENDENTES` (admin manda DM citando-se pra cada pendente, idempotente 30min). Privacidade preservada — bot mostra quantidade, não placar. Knowledge ganha LEGENDA DE EMOJI explicando 👑 (admin, bot adiciona), ⭐ (bolão padrão), e que 🍀/✨/etc no nome são do cadastro do próprio usuário. 484 tests.
- **v3.7.0** (2026-05-22) — Edição de palpite robusta. Auditoria identificou 4 gaps no fluxo `EDITAR_PALPITE`: (1) placar inline "corrigir Brasil 3x1" era ignorado e exigia 2 passos; (2) linguagem natural ("muda pra 3 a 1 pro Brasil") falhava no regex e caía no smart-fallback; (3) sem validação por jogo individual — user editava palpite de jogo que já tinha começado; (4) confirmação genérica sem mostrar valor anterior. Agora: atalho inline em 1 passo (5 novos patterns regex), LLM fallback no fluxo de placar com lista de jogos como contexto, trava se `jogo.dataHora ≤ now()`, confirmação "Era X, virou Y". 468 tests.
- **v3.6.0** (2026-05-22) — Knowledge base do produto no LLM conversacional. Bug: usuário perguntou "posso mandar vários palpites de uma vez?" e bot não soube responder porque o `responderConversacional` não tinha fato nenhum do produto no system prompt. Agora `src/llm/knowledge.produto.ts` (~500 tokens com pontuação, multi-palpite, editar/apagar, prazo, ranking, multi-bolão, admin/convite, custo, escopo, comandos, privacidade) fica sempre embutido no prompt. 14 testes anti-drift garantem que o knowledge bate com `PONTUACAO_PADRAO` do código. 461 tests.
- **v3.5.0** (2026-05-22) — Paginação honesta de PROXIMOS_JOGOS + nova intent `MAIS_JOGOS`. Bug Joao Arruda 21/05: bot afirmou "Todos os palpites desta rodada já estão registrados" depois que ele palpitou nos 10 mostrados — falso, porque a rodada de Copa tem 72 jogos e o `take: 10` cortava silenciosamente. Agora a mensagem mostra contador honesto ("Mostrando jogos 1–10 de 72, faltam 62 no bolão"), nova intent `MAIS_JOGOS` (12 padrões: "mais jogos", "próximos 10", "ver mais", "continuar palpitando", etc) avança a paginação com offset persistido em Redis, e bot cutuca automaticamente quando o user fecha um lote inteiro oferecendo o próximo. Multi-palpite enfatizado na dica. 447 tests.
- **v3.4.0** (2026-05-22) — Grounding da Copa 2026 — fim da alucinação. Bug VPS 21/05: bot afirmou "Inglaterra está no Grupo C com EUA e Irã" — tudo errado (Inglaterra/Grupo L com Croácia/Gana/Panamá). Gemini-flash-lite alucinava porque o prompt 3.3.0 autorizava "conhecimento próprio + disclaimer". Agora perguntas sobre Copa 2026 (PERGUNTA_GERAL_FUTEBOL) passam por um grounding determinístico (`src/llm/copa.ground.ts`) que monta `[FATOS VERIFICADOS]` do JSON oficial (openfootball, `src/data/copa-2026/`) antes da LLM, e o prompt proíbe afirmar fatos fora do bloco. Fora-de-escopo (Libertadores/Brasileirão/clube/jogador) é recusado com elegância antes da LLM. Novo `npm run sync:copa-2026` baixa do GitHub do openfootball. 438 tests (38 novos cobrindo o módulo e o grounding).
- **v3.3.1** (2026-05-18) — Hotfix Gemini sob carga: retry automático em HTTP 503/429/408 + timeout default 5s→8s. Após deploy do 3.3.0 na VPS, usuário via "assistente fora do ar" pois Gemini 2.5 Flash Lite estava sobrecarregado no Google. Logs antes silenciosos agora geram `[llm] gemini SKIP` quando config errada. Novo `scripts/test-conversational.ts` pra smoke test. 400 tests.
- **v3.3.0** (2026-05-18) — Nova intent `PERGUNTA_GERAL_FUTEBOL` + LLM responder reescrito. Usuário VPS perguntava "Quais próximos jogos da Inglaterra?" e bot respondia "não faz parte de nenhum bolão". Agora perguntas gerais sobre futebol (times/canais/grupos da copa) são roteadas pra LLM conversacional autorizado a responder com conhecimento próprio. Regex `\bproximos? jogos?\b` ganhou negative lookahead pra não matchar "X da [time]". 397 tests, 116 cenários.
- **v3.2.1** (2026-05-18) — Hotfix 4 bugs Humberto: (1) "Pontuação" sozinho ia pra RANKING("pontuacao") — patterns ampliados em MEUS_PONTOS (pontos/pontuacao/score/quanto pontuei); (2) "Ajuda" mostrava texto legado com `!comandos` — `formatAjuda` reescrito; (3) Nome de bolão sozinho ("Bolao teste oficial") virava CRIAR_BOLAO espúrio — fuzzy match contextual antes de iniciar criação + LLM prompt restritivo; (4) "Proximos jogos" no estado CRIANDO_BOLAO_NOME virava nome do bolão — FSM escape detecta intent forte e auto-cancela criação. 384 tests, 106 cenários.
- **v3.2.0** (2026-05-18) — Expansão de cordialidade + histórico persistente. 4 novos intents (DESPEDIDA/CUMPRIMENTO_CASUAL/CONCORDANCIA_CASUAL/RISADA) com respostas curtas randomizadas. Nova tabela Prisma `MensagemNaoEntendida` substitui lista Redis (TTL 30d) por persistência queryable, captura também `low_confidence` (LLM < 0.55). LGPD: whatsappId hashado sha256-16, retenção 180d via cron mensal. 377 tests, 102 cenários.
- **v3.1.3** (2026-05-18) — Hotfixes UX pós-feedback Jeni: (a) RANKING aceita "Quero ver o ranking" / "Ver o ranking" / "me mostra a tabela" — antes virava nome de bolão; (b) Nova intent AGRADECIMENTO ("obrigada", "valeu", "vlw"...) com resposta curta amigável — não reabre o menu; (c) Multi-bolão auto-apply (ISSUE-015) agora pede confirmação com preview. 342 tests, 85 cenários.
- **v3.1.2** (2026-05-17) — Patch da migration: `@unique` original foi criado como UNIQUE INDEX, então o `DROP CONSTRAINT IF EXISTS` da migration anterior era no-op. Nova migration `drop_jogos_apijogoid_unique_index` derruba o índice órfão; bolão `#K6VCCJ` reparado. Novo script `scripts/run-repair-once.ts` pra disparar o reparo sob demanda.
- **v3.1.1** (2026-05-17) — Hotfix pós-Sprint 2: (a) `Jogo.apiJogoId` unique-por-rodada + `criarBolao` atômico + job de reparo (corrige "rodada vazia" do 2º bolão em diante); (b) bolões encerrados visíveis em consultas (ranking/meus palpites/meus bolões) — honra a promessa "fica guardado" feita no encerramento
- **v3.1** (2026-05-17) — Sprint 2 completo: ISSUES 009-023 (handlers de info, editar/apagar palpite, bolão padrão, renomear, remover participante, RESUMO_BOLOES) + 322 tests
- **v3.0** (2026-05-17) — Sprint 1 completo: ISSUES 001-008 + wa.me link
- **v2.8** (2026-05-15) — Gemini 2.5 Flash Lite + thinking off sempre
- **v2.7** (2026-05-14) — Multi-palpite com confirmação + FSM escape geral
- **v2.6** (2026-05-13) — Aprovação NL + smart fallback LLM + REGRAS/PALPITES_AMBIGUO
- **v2.5** (2026-05-12) — Códigos curtos + admin parser NL
- **v2.1** (2026-04) — Migração Meta → Evolution API
- **v2.0** (2026-04) — DM-only + Meta Cloud API
- **v1.0** (2026-03) — Versão inicial baseada em grupos
