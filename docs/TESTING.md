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

**322+ tests** distribuídos em `tests/unit/`. Cobre:

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
| `validators.test.ts` | placar, normalizeTeamName, **validarPlacar absurdo (ISSUE-013)** |
| `ranking.service.test.ts` | Pontuação 10/7/5/3/0 |

Tempo: ~5s. Não toca rede nem DB.

### Watch mode
```cmd
npm run test:watch
```

---

## 2. Simulação determinística (`scripts/simulate-conversation.ts`)

Roda **75+ cenários** que cobrem todos os bugs reais já vistos em conversas
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
