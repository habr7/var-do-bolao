# Como testar o VAR do Bolão

O bot pode ser exercitado em **três níveis** sem precisar de conexão real do WhatsApp:

1. **Unit tests** (`npm test`) — lógica pura, sem rede nem DB
2. **Simulação determinística** (`npx tsx scripts/simulate-conversation.ts`) — 55+ cenários reais
3. **REPL interativo** (`npm run sim`) — conversa no terminal, banco real, sem mandar mensagem

Mais um nível **com WhatsApp real**:

4. **Dev no celular** — Docker Compose sobe Evolution API + você escaneia QR

---

## 1. Unit tests (`npm test`)

```cmd
npm test
```

**1015+ tests** distribuídos em `tests/unit/`. Cobre:

| Arquivo | O que testa |
|---------|-------------|
| `bolao-codigo.test.ts` | Geração + extração de códigos curtos (inclui legados ISSUE-001) |
| `convite.helper.test.ts` | Link wa.me, normalização de número, fallback sem env |
| `lista.helper.test.ts` | `formatarBoloesNumerados`, `parseEscolhaBolao` |
| `message.parser.test.ts` | 155+ casos de intent regex (saudação, palpite, multi-palpite, todas as 29 intents incl. Sprint 2) |
| `admin.parser.test.ts` | Aprovação/recusa em NL (todos/nomeado/genérico) |
| `palpite.extractor.test.ts` | LLM extrator mockado |
| `bolao.matcher.test.ts` | Escolha de bolão (índice → código → fuzzy → LLM) |
| `intent.classifier.test.ts` | LLM classifier mockado |
| `gemini.client.test.ts` | Cliente Gemini (conversão de payload, JSON mode, thinking off, error handling) |
| `ollama.client.test.ts` | Cliente Ollama (fallback) |
| `evolution.client.test.ts` | Cliente Evolution (sendText, dry-run) |
| `password.test.ts` | bcrypt hash + compare |
| `validators.test.ts` | placar, normalizeTeamName, **validarPlacar absurdo (ISSUE-013)**, **acharJogoPorTimes/resolverPalpiteParaJogo — ordem invertida (v3.25.0)**, **`timeCorresponde` — abreviação/grafia "Rep Checa"/"Coreia" + anti-falso-positivo (v3.29.0)** |
| `broadcast.test.ts` | **(v3.26.0)** Broadcast admin: `ehDono` (JID vs dígitos), `parseBroadcast` (marcador/corpo/vazio/mid-text/case), destinatários TEST (só dono) vs PROD (todos+dedup), idempotência `SET NX`. 14 testes. |
| `ranking.service.test.ts` | Pontuação 10/7/5/3/0 |
| `estatistica-pontos.test.ts` | **(v3.38.0/v3.39.0)** `getEstatisticaPontos`: contagem por faixa (cravadas/7/5/3/0) + total, query filtra só calculado=true + FINALIZADO. **`getJogosPorFaixa` (v3.39.0)**: lista jogos da faixa com palpite + resultado real, filtro `pontosObtidos`, régua de faixas no rodapé (mock prisma) |
| `paginar.test.ts` | **(v3.28.0)** `paginarBlocos`: páginas ≤ limite, não quebra bloco no meio, rodada de 72 jogos vira N páginas <3500 |
| `lock.test.ts` | **(v3.28.0)** `comLockJob`: executa+libera, pula quando tomado, libera no `finally` mesmo se `fn` lança |
| `aviso-cap.test.ts` | cap diário de avisos + **(v3.28.0)** reserva atômica `reservarCotaAviso`/`devolverCotaAviso` (corrige TOCTOU) |
| `copa-2026.test.ts` | **(v3.4.0)** Dados oficiais da Copa: 48 seleções em 12 grupos, composição correta (Inglaterra/L, Brasil/C, etc.), normalização PT/EN/aliases (EUA, canarinha, albiceleste, BRA), `getProximosJogosDoTime` |
| `copa-ground.test.ts` | **(v3.4.0)** Grounding `construirFatosCopa2026`: bug original ("Inglaterra grupo L, não C"), motivos TIME/GRUPO/DATA/ESTADIO_SEDE/GERAL_COPA, recusa fora-de-escopo (Libertadores/Brasileirão/Flamengo/Vinicius Jr/Real Madrid/Copa de 94) |
| `knowledge.produto.test.ts` | **(v3.6.0)** Knowledge base do produto: bate pontuação contra `PONTUACAO_PADRAO` (anti-drift), garante que cobre multi-palpite, editar/apagar, prazo, ranking+desempate, multi-bolão+padrão, admin+convite+ID curto, grátis, escopo Copa 2026, privacidade, lista de comandos. 14 testes. |
| `openfootball.fetcher.test.ts` | **(v3.16.0)** Adapter openfootball: parse de FINALIZADO, normalização "Mexico"↔"México", score null não vira 0×0, robustez de rede. |
| `fifa.fetcher.test.ts` | **(v3.22.0)** Adapter FIFA (`api.fifa.com`): status codes 0/1/3/4, lê `Home.Score`/`HomeTeamScore`, match por par de código FIFA (MEX×RSA→WC2026_A_1), código a-definir pulado, null-guard, throw em HTTP 500/rede. 11 testes. |
| `hybrid.fetcher.test.ts` | **(v3.22.0)** `HybridFootballAdapter`: FIFA OK usa FIFA; FIFA fora (500/rede) cai pro openfootball. 3 testes. |
| `scoring-gate.test.ts` | **(v3.22.0)** `calcularPontuacaoRodada` pontua só `FINALIZADO` — jogo AO_VIVO (placar parcial) e AGENDADO contam 0 até o apito. 2 testes. |
| `polling-window.test.ts` | **(v3.23.0)** Janela de polling do `fetch-results`: API só consulta jogo AO_VIVO ou AGENDADO com kickoff passado (finalizado lê do banco); rede de segurança re-busca FINALIZADO sem placar. 2 testes. |
| `palpite-reveal.test.ts` | **(v3.24.0)** Builder da revelação de palpites no kickoff: ordenação (Você → palpiteiros → "não palpitou"), placar parcial null vira "não palpitou", multi-bloco por bolão. 5 testes. |
| `revelacao.service.test.ts` | **(v3.24.0)** `revelacoesParaUsuario` (sob demanda): escopo por jogo/bolão, filtro por time, skip bolão solo (<2) e jogo sem palpite. 4 testes. |
| `sair.helper.test.ts` | **(v3.30.0)** `extrairNomeBolaoInlineSair`: nome inline no "sair do bolão X", número puro/artigo → null. 8 testes. |
| `send-lembrete-30min.test.ts` | **(v3.31.0)** Lembrete por jogo: janela, idempotência (user,jogo), cooldown, coalescência, cap, rollback de cota em falha. 7 testes. |
| `intent.classifier.drift.test.ts` | **(v3.32.0)** ANTI-DRIFT: toda intent descrita no INTENT_CLASSIFIER_PROMPT ∈ INTENCOES_VALIDAS ∈ enum (bug "não sei" do caso Humberto 11/06). 5 testes. |
| `fatos-vivos.test.ts` | **(v3.32.0)** `construirFatosVivos`: rolando/finalizado/próximo, dedup multi-bolão, teto de tamanho, null em vazio/erro. 7 testes. |
| `palpite-render.test.ts` | **(v3.33.0)** `montarStatusResultado`: jogo AO VIVO com placar parcial NÃO vira "oficial 0 pts ❌" (bug Humberto 12/06); finalizado+calculado/calculando; adiado/cancelado/agendado. 8 testes. |
| `bracket-2026.test.ts` | **(v3.41.0 mata-mata)** Integridade da chave: 32 jogos (73–104), apiJogoId por fase, ligações de avanço (cada slot 1 alimentador), R32→oitavas confirmados, semis→final+3º lugar, Sede→IANA. 11 testes. |
| `pontuacao-mata-mata.test.ts` | **(v3.41.0)** `pontuarJogoMataMata`: casos A–G dos 16-avos (placar+bônus separados), valores por fase, inferência no decisivo, bônus só no empate quando acerta, crava preservada ao errar classificado, erro=0. 19 testes. |
| `classificado-palpite.test.ts` | **(v3.41.0)** `registrarClassificadoPalpite`: grava `classificadoPalpite` por usuário/rodadas/jogo (single e multi-bolão) via updateMany. 2 testes. |
| `advance-bracket.test.ts` | **(v3.41.0)** `advanceBracketComClient` (mock prisma): finalizar 73+75 abre a oitava 90, idempotência (não sobrescreve time real), perdedor das semis → 3º lugar. 3 testes. |
| `seed-mata-mata.test.ts` | **(v3.41.0)** `parsearR32`/`ehTimeReal`: parse das 16 linhas, portão por times reais, conversão de fuso, erros (sede/número/data/faltando). 10 testes. |
| `regras.text.test.ts` (+) | **(v3.41.0)** `regrasMataMata`/`regrasCompletas`: destaca prorrogação/pênalti, bônus, crava garantida, grade por fase (de `TABELA_PONTOS`), ranking cumulativo. |
| `datetime.test.ts` (+) | **(v3.41.0)** `horaLocalSedeParaUtc`: local da sede → UTC tz-aware/DST (LA/NY/México), rejeita malformado. |
| `message.parser.test.ts` (+) | **(v3.41.0)** 14 frases dos intents de mata-mata (INFO_* + ADVERSARIO_TIME/HORARIO_JOGO/VER_CHAVE). |
| `mata-mata-hardening.test.ts` | **(v3.42.0)** `timeCorresponde` rejeita placeholder; `montarStatusResultado` mostra pênaltis + bônus; revelação mostra o classificado cravado no empate. 6 testes. |
| `admin-classificado.test.ts` | **(v3.42.0)** `parseClassificadoCmd`/`resolverLadoClassificado`: parse do comando admin `#CLASSIFICADO` (apiJogoId/lado/flag PENALTIS, nome com espaço, faltando args) + resolução de lado por CASA/VISITANTE/1/2/nome. 8 testes. |
| `fifa.fetcher.test.ts` (+) | **(v3.42.0)** disputa de pênaltis: empate FINALIZADO com placar de pênaltis infere classificado (placar segue o de 90'); sem pênaltis mantém o shape mínimo. |
| `advance-bracket.test.ts` (+) | **(v3.42.0)** `escreverSlot` via `updateMany` atômico (guarda no WHERE). |
| `fifa-knockout.fetcher.test.ts` | **(v3.43.0)** `parseFixturesMataMata`: ignora grupos, mapeia número/fase/kickoff-UTC/times, placeholder quando sem time, classificado do `Winner` (decisivo e pênaltis), todas as fases. 6 testes. |
| `mata-mata-sync.test.ts` | **(v3.43.0)** `sincronizarMataMata` (prisma em memória): cria as 6 rodadas + jogos, abre rodada com confronto real, trava time após abrir, corrige enquanto fechada, reseta cálculo no resultado. 4 testes. |
| `empate-classificado-inline.test.ts` | **(v3.44.0)** Captura do classificado na mesma mensagem do empate ("Brasil 1x1 Japão e o Brasil passa"): 11 frases (e/mas/com/vírgula/parênteses, "quem passa é X", "vai o X", "X avança"), CASA/VISITANTE, decisivo ignora o hint, ambíguo não captura, nome não poluído, e palpite real não vira INFO_PENALTI. 8 testes. |
| `message.parser.test.ts` (+) | **(v3.44.0)** Bateria de QA: "jogos de hoje"→JOGOS_HOJE, "tabela"→RANKING, conjugações/typos do mata-mata, lookahead da chave não vaza pra CUMPRIMENTO. |
| `palpite-repository-classificado.test.ts` | **(v3.45.0)** `registrarPalpiteJogo` zera `classificadoPalpite` quando o placar vira decisivo; em empate não mexe. 2 testes. |
| `telegram.format.test.ts` | **(v3.59.0)** Conversor WhatsApp→HTML do Telegram: `*b*`/`_i_`/`~s~`/`` `c` ``/```pre```, escape `<>&`, marcador solto fica literal, par não cruza linha, mensagem real do bom-dia, quebra >4096 em `\n`. 15 testes. |
| `channel-router.test.ts` | **(v3.59.0)** Decisão de rota por flags: default = WhatsApp SEM query no banco; migração (só Telegram) = linkado→telegram, sem vínculo→drop; ambos = `canalPreferido` decide; cache 60s + invalidação; variantes de waId (JID/dígitos); DB fora não derruba envio. 13 testes. |
| `telegram.identity.test.ts` | **(v3.59.0)** `normalizarNumeroBR` (formatos comuns, DDD+8/9, rejeita lixo) e `variantesNumeroBR` (9º dígito, sufixo JID, sem duplicata). 6 testes. |
| `telegram.inbound.test.ts` | **(v3.59.0)** Onboarding ponta a ponta: /start pede número; número conhecido → confirma nome → vincula (recupera pontuação); desconhecido → cria do zero; número já vinculado a outro chat → recusa; vinculado roteia pro command.router com `waId` certo; /start vira "oi"; dedup por update_id; grupo ignorado; mídia → aviso com rate-limit. 10 testes. |
| `conversa.service.test.ts` | **(v3.60.0)** Histórico de conversas: resolve usuarioId por variantes do waId; `tg:` não busca usuário; trunca em 2000 chars; NUNCA lança (fire-and-forget); contexto de auditoria set/get/sobrescrita. 9 testes. |
| `admin-conversas.test.ts` | **(v3.60.0)** Comandos de dono: parse (#CONVERSASGLOBAL/#CONVERSAS/#AUDITORIA com N, caps, nome composto), não-dono ignorado, listagem global com nome, busca por número (variantes 9º dígito) e nome fuzzy (vários → refino), formatação da auditoria (EDITOU a→b + msg original + canal). 13 testes. |

Tempo: ~8s. Não toca rede nem DB. **1245 tests.**

### Watch mode
```cmd
npm run test:watch
```

---

## 2. Simulação determinística (`scripts/simulate-conversation.ts`)

Roda **116+ cenários** que cobrem todos os bugs reais já vistos em conversas
com usuários. Não toca DB/Redis nem rede — só testa o parser e o admin parser
(que é onde mora a maioria dos bugs).

```cmd
npx tsx scripts/simulate-conversation.ts
```

Output esperado:
```
RESULTADO: 55 ✅  0 ❌  (total 55)
```

Cobre:
- Saudações + intents principais
- Multi-palpite com preposição ("México 2 a 0 na África")
- Palpite com "perde de" / "ganha por"
- Palpites com extenso ("dois a um")
- Códigos legados (`#AD71F3` — ISSUE-001)
- Variantes de "quero dar palpites" → PROXIMOS_JOGOS
- "qual a senha" → INFO_SENHA (ISSUE-005)
- "excluir bolão" → EXCLUIR_BOLAO (ISSUE-006)
- Regressões dos 7 bugs originais

Quando criar nova intent ou regex pattern, **adicione um cenário aqui**.

---

## 3. REPL interativo (`npm run sim`)

Conversa com o bot no terminal **como se fosse um usuário real**. Toda a
lógica passa pelo código de produção (parser, FSM, services, jobs), mas
mensagens "enviadas" são capturadas em memória — nada vai pro WhatsApp.

### Pré-requisitos

```cmd
:: infra
docker compose up -d postgres redis
:: migrations
npx prisma migrate dev
```

Não precisa de Evolution rodando nem QR escaneado — `DRY_RUN_WHATSAPP=true`
captura sendText em memória.

### Iniciar

```cmd
npm run sim
```

Você verá:
```
⚽ VAR do Bolão — REPL local
DRY_RUN_WHATSAPP=true — nenhuma mensagem real é enviada

» você é Humberto (5511999999999) — /as troca
Humberto>
```

### Comandos do REPL

| Comando | O que faz |
|---------|-----------|
| `/as Nome 5511XXXXXXXXX` | Troca o usuário corrente — mensagens seguintes vêm desse waId |
| `/users` | Lista usuários criados na sessão |
| `/pix` | (legado, PIX desativado) Marca cobranças pendentes como pagas |
| `/tick-results` | Roda job `fetch-results` manualmente |
| `/state` | Mostra a FSM atual do usuário (state + ctx) |
| `/clear` | Limpa fila de mensagens capturadas |
| `/help` | Menu |
| `/quit` | Sai |

### Roteiro exemplo — fluxo de criação

```text
Humberto> oi
🤖 bot → Humberto
  │ 👋 Opa Humberto! Sou o *VAR do Bolão* ⚽
  │ ...

Humberto> criar bolão
🤖 bot → Humberto
  │ ⚽ Bora criar um bolão novo!
  │ Como você quer chamar?

Humberto> Firma FC
🤖 bot → Humberto
  │ ✅ Nome: *Firma FC*
  │ Agora define uma *senha* (mínimo 6 caracteres).

Humberto> cerveja123
🤖 bot → Humberto
  │ 🏆 Bolão *Firma FC* criado, craque!
  │ 👑 Você é o admin.
  │ 🎟️ ID do bolão: `#K3MZ8P`
  │ 📨 Pra convidar gente é fácil: ...

🤖 bot → Humberto
  │ Bora pro bolão *Firma FC* 🏆
  │ Entra clicando aqui: https://wa.me/...
```

### Roteiro exemplo — outro usuário entra via ID

```text
Humberto> /as Maria 5511988888888
» agora enviando como Maria

Maria> oi
🤖 bot → Maria
  │ 👋 Opa Maria! ...

Maria> Quero entrar no bolão Firma FC 🏆 ID: *#K3MZ8P*
🤖 bot → Maria
  │ ✅ Pedido enviado pro bolão *Firma FC* (`#K3MZ8P`).
  │ 📤 Mandei pro admin aprovar. ...

🤖 bot → Humberto
  │ 🔔 *Novo pedido de entrada!*
  │ 👤 *Maria* quer entrar no bolão *Firma FC*.
  │ Responde com: *aprovado* / *recusar*

Maria> /as Humberto 5511999999999

Humberto> aprovado Maria
🤖 bot → Humberto
  │ ✅ Maria aprovado no bolão Firma FC!
🤖 bot → Maria
  │ 🎉 Boa notícia! Você foi aprovado no bolão *Firma FC*! ...
```

---

## 4. Testar com WhatsApp real (Evolution + QR code)

### Pré-requisitos

```cmd
:: infra completa (postgres + redis + Evolution)
docker compose up -d

:: aguarde Evolution subir (~15s no primeiro boot)
docker logs var_do_bolao-evolution-1 --tail 30
```

### Parear instância

```cmd
:: gera QR code
curl -H "apikey: var_do_bolao_MelhorDoMundo" http://localhost:8080/instance/connect/varbolao
```

Escaneie o QR no WhatsApp do número que vai ser o bot. Verifique que parou:

```cmd
curl -H "apikey: var_do_bolao_MelhorDoMundo" http://localhost:8080/instance/fetchInstances
:: procure "connectionStatus":"open"
```

> Se ficar em loop "connecting", o WhatsApp Web atualizou a versão. Edita
> `docker-compose.yml` → `CONFIG_SESSION_PHONE_VERSION` pra versão nova que
> aparece nos logs e roda `docker compose up -d evolution`.

### Subir o bot

```cmd
:: edita .env com DRY_RUN_WHATSAPP=false e LLM_ENABLED=true (+ GEMINI_API_KEY)
npm run dev
```

Aparece:
```
📨 Webhook WhatsApp: http://localhost:3000/webhook/whatsapp
🚀 Server listening on port 3000
```

### Mandar mensagem real

Manda `oi` pro número pareado pelo seu celular. O bot responde no chat.

### Logs filtrados

```powershell
:: PowerShell — filtra eventos do bot
Get-Content -Wait -Tail 50 .\log.txt |
  Select-String "\[llm\]|\[smart-fallback\]|\[fsm-escape\]|\[multi-palpite\]|\[nao-entendi\]|\[timing\]"
```

Ou só olhar a saída do `npm run dev` direto.

---

## 5. Smoke test do Gemini real (`scripts/test-gemini.ts`)

Útil pra validar que a `GEMINI_API_KEY` no `.env` funciona e a cota não estourou:

```cmd
npx tsx scripts/test-gemini.ts
```

Roda 3 testes contra a API real:
1. Chat simples ("oi")
2. Intent classifier ("quero ver a tabela do bolão")
3. Palpite extractor ("Brasil perde de 1 a 0 do Marrocos")

Esperado: latência ~400-800ms cada. Se der HTTP 429 = cota grátis estourou
(reset diário). Se der 200 = Gemini OK.

### 5.0 Sync de dados oficiais da Copa 2026 (`scripts/sync-copa-2026.mjs`)

Adicionado em v3.4.0 — baixa os 4 JSONs oficiais do openfootball/worldcup.json
e regenera `src/data/copa-2026/*` + o legacy `src/data/fifa-2026-fixtures.json`:

```cmd
npm run sync:copa-2026
```

Saída esperada:
```
🌐 Baixando dados do openfootball/worldcup.json (2026)...
✅ teams.json — 48 seleções
✅ stadiums.json — 16 estádios
✅ matches.json — 104 jogos
✅ metadata.json
✅ src/data/fifa-2026-fixtures.json (legacy) — 72 jogos da fase de grupos
```

**Quando rodar**: depois que o openfootball publicar mudanças (sorteio do
mata-mata, ajustes de data/estádio). Rodar manualmente antes do mata-mata;
diariamente durante a Copa via cron se necessário. **Sem API key**, só
fetch HTTP do GitHub raw.

### 5.1 Smoke test conversacional (`scripts/test-conversational.ts`)

Adicionado em v3.3.1 — valida que **perguntas gerais sobre futebol** são
respondidas naturalmente pelo LLM (sem cair em "assistente fora do ar"):

```cmd
npx tsx scripts/test-conversational.ts
```

Testa 4 perguntas reais reportadas em produção:
- "Quais próximos jogos da Inglaterra?"
- "Qual canal posso assistir o Brasil hoje?"
- "Quem ganhou a Copa do Mundo de 1994?"
- "Em que grupo o Brasil está na Copa 2026?"

Cada uma com até 3 retries internos (porque Gemini 503 é comum em pico de
demanda). Output mostra latência + resposta — se todas vierem ✅, o pipeline
LLM→conversational tá saudável. Em algumas tentativas pode aparecer
`[llm] gemini HTTP 503` + `[llm] gemini retry #1` — isso é esperado e prova
que o retry funciona.

**Quando rodar**: depois de mexer em qualquer coisa no `src/llm/`,
`system-prompts.ts`, ou quando o usuário reportar "bot não respondeu
pergunta geral de futebol".

---

## 6. Bateria de testes manuais no WhatsApp (após deploy)

### Bloco A — Sanity geral
| Mensagem | Esperado |
|---|---|
| `oi` | Saudação + menu |
| `regras` | Texto das regras 10/7/5/3/0 |
| `meus bolões` | Lista com 👑 admin + IDs (e seções 🏆 ativos / 🏁 encerrados se aplicável) |
| `criar bolão` → nome → senha | Cria + ID + **link wa.me clicável** |
| (outro telefone clica no link) | Abre WhatsApp do bot com mensagem pronta → bot cria solicitação |
| `aprovado Fulano` (admin) | Aprova + notifica solicitante |
| `qual a senha?` | Handler INFO_SENHA — não chama LLM |
| `excluir bolão` (admin) | Pede `confirmar` textual |
| `quero dar palpites` | Lista próximos jogos abertos |
| `Brasil 2x1 Marrocos` | Confirma palpite inline |
| (>1 bolão) `Brasil 2x1 Marrocos` | Pergunta qual bolão |
| `meus palpites` | Mostra histórico |
| `ranking` | Ranking do bolão (ou pergunta qual) |
| `xpto blablabla` | Smart fallback Gemini (não "não entendi" cru) |
| `Bolão da jeni` (com acento errado) | Busca fuzzy encontra "Bolão da Jeni" |

### Bloco B — Hotfix `apiJogoId` unique-por-rodada (3.1.1)

Criar **dois** bolões em sequência (pelo mesmo admin, nomes diferentes)
e verificar que ambos recebem os 72 jogos da Copa.

| Mensagem | Esperado |
|---|---|
| `criar bolão` → `Teste A` → `senha123456` | ✅ Bolão criado + ID. |
| `próximos jogos` | Lista os jogos da Copa do Teste A. |
| `criar bolão` → `Teste B` → `senha123456` | ✅ Bolão criado + ID (antes do hotfix, daqui em diante o segundo ficava com rodada vazia). |
| `próximos jogos` | Pergunta qual bolão; escolher Teste B → mostra os 72 jogos. |
| (no banco) `SELECT b.codigo, COUNT(j.id) FROM boloes b LEFT JOIN rodadas r ON r."bolaoId"=b.id LEFT JOIN jogos j ON j."rodadaId"=r.id WHERE b.status='ATIVO' GROUP BY b.codigo;` | Cada bolão deve ter 72 jogos. |

### Bloco C — Hotfix bolões encerrados (3.1.1)

| Mensagem | Esperado |
|---|---|
| (no admin de um bolão) `excluir bolão` → `confirmar` | Notifica participantes "O admin encerrou..." |
| (no participante encerrado, sem outros bolões) `ranking` | Mostra ranking final + sufixo "🏁 Este bolão foi encerrado — ranking final guardado pra consulta." |
| (mesmo) `próximos jogos` | Mensagem auto-diagnóstica: "Você tem 1 bolão(ões) encerrado(s). Manda *ranking* pra ver o resultado final..." (não o genérico "você não participa") |
| (mesmo) `meus bolões` | Seção "🏁 Bolões encerrados:" com o bolão + dica de ranking |
| (mesmo) `meus palpites` | Funciona normalmente — pede confirmação pra ver detalhe |
| (usuário com 1 ativo + 1 encerrado) `ranking` | Bot pergunta qual; encerrado marcado com 🏁 + legenda explicativa |

### Bloco D — Job de reparo (3.1.1)

Se houver bolões legados quebrados (rodada vazia ou sem rodada), o
`repair-broken-boloes` roda no boot do servidor:

```cmd
:: depois do npm run dev (ou primeiro deploy), procurar nos logs:
Get-Content -Wait -Tail 50 log.txt | Select-String "\[repair-broken-boloes\]"
```

Esperado:
- `[repair-broken-boloes] iniciando varredura`
- `[repair-broken-boloes] encontrados: N sem rodada, M com rodada vazia`
- `[repair-broken-boloes] reparado #ABCD12 (Nome) — ...`
- DM pro admin: "✅ Acabei de carregar os jogos da Copa pro seu bolão *X*..."

#### Disparar o reparo sob demanda (sem subir o servidor)

Quando a porta 3000 já está ocupada (outro `npm run dev` rodando) ou
você só quer testar o job isolado:

```cmd
npx tsx scripts/run-repair-once.ts
```

Roda uma única vez e sai. Útil também pra forçar o reparo logo após
aplicar uma migration nova sem ter que reiniciar o servidor.

### Bloco I — Perguntas gerais de futebol via LLM (3.3.0)

Cenário: usuário pergunta sobre futebol em geral (não sobre o bolão dele).

| Mensagem | Esperado |
|---|---|
| `Quais próximos jogos da Inglaterra?` | LLM responde com info da seleção inglesa na Copa 2026 (grupo, fixtures conhecidos) — NÃO mostra jogos do bolão do user |
| `Qual canal posso assistir o Brasil hoje?` | LLM responde com info de transmissão (Globo/SporTV/FIFA+/Cazé) — disclaimer "normalmente passa em" |
| `Quem ganhou copa de 94?` | LLM responde "Brasil, contra Itália nos pênaltis" |
| `Em que grupo o Brasil está?` | LLM responde com grupo da Copa 2026 |
| `Onde vai ser a final?` | LLM responde (Estados Unidos, MetLife Stadium) com disclaimer |
| `Que horas joga a França?` | LLM responde se souber, com disclaimer "info geral; pra ver seu bolão manda *meus bolões*" |
| **Regressão**: `próximos jogos` sozinho | Continua sendo PROXIMOS_JOGOS (lista jogos do bolão do user) |
| **Regressão**: `quero palpitar` | Continua sendo PROXIMOS_JOGOS |
| **Regressão**: `ranking` sozinho | Continua sendo RANKING (do bolão) |
| **Regressão**: `quando começa?` | Continua sendo QUANDO_COMECA (sobre rodada do bolão) |

Validação técnica:
```cmd
:: Verifica que a intent foi classificada e métrica incrementada
docker exec var_do_bolao-redis-1 redis-cli HGET "metrics:$(date +%Y-%m-%d)" intent.PERGUNTA_GERAL_FUTEBOL
docker exec var_do_bolao-redis-1 redis-cli HGET "metrics:$(date +%Y-%m-%d)" llm.conversational.hit
```

### Bloco H — Hotfix 4 bugs Humberto (3.2.1)

| Mensagem | Esperado |
|---|---|
| `Pontuação` (capitalizado) | MEUS_PONTOS — bot lista bolões e pede qual |
| `pontuacao` (sem til) | MEUS_PONTOS |
| `score` / `quanto pontuei` | MEUS_PONTOS |
| `Ajuda` | Texto novo com linguagem natural — sem `!comandos` |
| (Após "meus bolões" mostrar lista) `Bolao teste oficial` | Bot oferece **menu contextual** ("você já participa, quer: 1.ranking, 2.meus palpites, 3.meus pontos, 4.próximos jogos, 5.criar bolão novo?") — NÃO inicia criação |
| (No estado CRIANDO_BOLAO_NOME) `próximos jogos` | Bot **auto-cancela** criação + processa próximos jogos |
| (No estado CRIANDO_BOLAO_SENHA) `quero ver os próximos jogos` | Idem — cancela criação + processa |
| (No estado CRIANDO_BOLAO_NOME) `Bolão da Firma` (nome legítimo) | Continua aceitando como nome (não é intent forte) |

### Bloco G — Cordialidade expandida + histórico persistente (3.2.0)

#### Cordialidade

| Mensagem | Esperado |
|---|---|
| `tchau` / `flw` / `até mais` / `abraço` | Resposta curta de saída ("🤙 Falou, *Nome*! Tamo junto.") — **não** reabre menu |
| `tudo bem?` / `blz?` / `como vai?` | Bot responde + sugere ações leves ("Manda *ranking*, *palpitar* ou *meus bolões*") — **não** menu cru |
| `oi tudo bem?` (saudação encadeada) | Vira CUMPRIMENTO_CASUAL (não SAUDACAO pura) — stripSaudacao + matchIntent |
| `ok` / `beleza` / `show` / `perfeito` / `top` | Resposta curta sem menu ("👍 Show! Tô por aqui.") |
| `blz` (sem `?`) | CONCORDANCIA_CASUAL |
| `blz?` (com `?`) | CUMPRIMENTO_CASUAL — `?` é o diferenciador |
| `kkkk` / `rsrs` / `hahaha` / `😂` | Emoji minimalista — não menu |
| (dentro de `sair do bolão` → "ok") | **Vira SIM** (continua saindo) — regressão crítica |
| (admin com pendentes → "ok") | **Vira aprovação** (admin parser pega antes) — regressão crítica |
| `ok eu quero criar bolão` (frase longa) | NÃO vira CONCORDANCIA_CASUAL (pattern restritivo `^...$`) — vira CRIAR_BOLAO |

#### Histórico persistente

Após mandar algumas mensagens não-entendidas pro bot:

```cmd
:: Ver últimas 10 amostras
docker exec var_do_bolao-postgres-1 psql -U varbolao -d varbolao -c "SELECT motivo, \"llmIntent\", \"llmConfianca\", texto FROM mensagens_nao_entendidas ORDER BY \"criadoEm\" DESC LIMIT 10;"

:: Agregado por motivo dos últimos 7d
docker exec var_do_bolao-postgres-1 psql -U varbolao -d varbolao -c "SELECT motivo, COUNT(*) FROM mensagens_nao_entendidas WHERE \"criadoEm\" > NOW() - INTERVAL '7 days' GROUP BY motivo;"

:: Variantes que o LLM "achou que era RANKING" mas <0.55 (ouro pra regex novo)
docker exec var_do_bolao-postgres-1 psql -U varbolao -d varbolao -c "SELECT texto, \"llmConfianca\" FROM mensagens_nao_entendidas WHERE motivo='low_confidence' AND \"llmIntent\"='RANKING' ORDER BY \"criadoEm\" DESC LIMIT 20;"
```

Esperado:
- `low_confidence` aparece quando você manda mensagens borderline tipo "me passa a tabela aí brother"
- `final_fallback` aparece em mensagens completamente fora de domínio ("xpto blablabla")
- `whatsappIdHash` é hex 16 chars — nunca o número em claro
- Job manual: `npx tsx scripts/limpar-mensagens-antigas.ts`

### Bloco F — Hotfixes UX pós-feedback Jeni (3.1.3)

| Mensagem | Esperado |
|---|---|
| `Quero ver o ranking` | Ranking direto (1 bolão) ou pergunta numerada qual bolão. NÃO responde "bolão 'Quero ver o ranking' não encontrado". |
| `Ver o ranking` | Mesmo. |
| `me mostra a tabela` | Mesmo. |
| `ranking Firma FC` | Continua funcionando — busca pelo nome real. |
| `obrigada` (depois de qualquer ação) | Resposta curta amigável tipo "🤙 Magina, *Jeniffer*! Tamo junto. Precisando, só chamar. ⚽" — **NÃO** reabre o menu completo. |
| `vlw` | Idem. |
| `thanks` | Idem. |
| (multi-bolão, mesmo jogo em vários) `Brasil 2x1 Marrocos` | Bot mostra preview "📝 Vou registrar... Aplicado em *3* bolões: ..." + pede `sim/não/refazer`. **NÃO** registra direto sem perguntar. |

### Bloco E — Migrations Prisma (3.1.2)

Sempre que o schema Prisma muda, **aplicar todas as migrations pendentes** no
banco local antes de boot:

```cmd
npx prisma migrate deploy   :: aplica todas as migrations não aplicadas
npx prisma migrate status    :: verifica que esta tudo em dia
npx prisma generate          :: regenera o client com schema atual
```

Erros tipo `Unique constraint failed on ...` em jobs após `migrate deploy`
podem indicar que um índice/constraint antigo não foi totalmente derrubado
(`DROP CONSTRAINT IF EXISTS` é no-op se o `@unique` original foi criado
como `CREATE UNIQUE INDEX`). Verifique com:

```cmd
docker exec var_do_bolao-postgres-1 psql -U varbolao -d varbolao \
  -c "SELECT indexname FROM pg_indexes WHERE tablename='jogos';"
```

Se houver índice unique órfão, drope explicitamente via nova migration
com `DROP INDEX IF EXISTS "nome_do_indice";`.

---

## Quando algo quebra

1. **Confere os logs filtrados** (`[timing]` mostra onde o gargalo está)
2. **Roda `npm test` + `npx tsx scripts/simulate-conversation.ts`** — se ambos passam, o bug é integração (DB, Evolution, Gemini)
3. **Reproduz no REPL** (`npm run sim`) — se reproduz lá, é lógica
4. **Adiciona o cenário em `simulate-conversation.ts`** antes de corrigir — vira regressão

---

## Quando o bug é da Evolution

Sintomas: instância em loop `connecting`, webhook não chega, sendText
retorna 400/500.

```cmd
:: logs da Evolution
docker logs var_do_bolao-evolution-1 --tail 100

:: status
curl -H "apikey: var_do_bolao_MelhorDoMundo" http://localhost:8080/instance/fetchInstances

:: recriar instância
docker compose stop evolution
docker volume rm var_do_bolao_evolution_instances
docker compose up -d evolution
curl -H "apikey: var_do_bolao_MelhorDoMundo" -X POST http://localhost:8080/instance/create \
  -H 'Content-Type: application/json' \
  -d '{"instanceName":"varbolao","integration":"WHATSAPP-BAILEYS"}'
```
