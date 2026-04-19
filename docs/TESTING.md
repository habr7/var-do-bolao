# Como testar o bot SEM token da Meta

Este guia mostra como exercitar 100% das funcionalidades do VAR do Bolão antes
de ter `WHATSAPP_ACCESS_TOKEN`, `PHONE_NUMBER_ID` e afins. Quando o token real
chegar, basta trocar as envs e o bot já está funcional.

A estratégia tem **três camadas**:

1. **Unit tests** (`npm test`) — lógica pura, sem rede nem DB
2. **REPL de simulação** (`npm run sim`) — conversa interativa no terminal com o bot, usando banco real mas sem enviar nada pro WhatsApp
3. **Dry-run end-to-end** — rodar o servidor apontando para um webhook fake, disparando payloads de teste

---

## 1. Unit tests

```bash
npm test
```

Cobre:
- `message.parser` — reconhecimento de intenção em pt-BR
- `password` — hash bcrypt + validação
- `signature` — HMAC SHA256 do webhook da Meta
- `ranking/pontuacao.calc` — 10/7/5/3/0 pontos
- `pix.adapter` — mock, força pagamento, auto-pay
- `meta.client` (em dry-run) — captura de mensagens, listener
- `validators` — scores, JID format

Rápido (~4s), não precisa de nada externo.

---

## 2. REPL de simulação (o "modo dev")

Este é o teste mais valioso antes de ter token real. Você **conversa com o bot
no terminal** como se fosse um usuário real. Todas as funcionalidades passam
pelo mesmo código que vai rodar em produção — webhook handler, FSM, services,
jobs — mas nenhuma mensagem sai da máquina.

### Pré-requisitos

```bash
# Infra local (postgres + redis)
docker compose up -d

# Migrations
npx prisma migrate dev
```

Não precisa preencher `WHATSAPP_*` no `.env` — os defaults já servem para
dry-run.

### Iniciar o REPL

```bash
npm run sim
```

Você verá algo como:

```
⚽ VAR do Bolão — REPL local
DRY_RUN_META=true — nenhuma mensagem real eh enviada

╔═══ VAR do Bolão — modo simulacao ═══╗

Comandos:
  /as <nome> <waId>   troca o remetente atual
  /users             lista usuarios ja criados na sessao
  /pix               forca PAGO em todos os pagamentos pendentes
  /tick-results      roda job fetch-results manualmente
  /state             mostra sessao FSM do usuario atual
  /clear             limpa fila de mensagens capturadas
  /help              mostra este menu
  /quit              sair

» voce eh Humberto (5511999999999) — /as troca
Humberto>
```

A cada mensagem que você envia, o bot "responde" — a resposta aparece no
terminal formatada (com prefixo `🤖 bot →`). Você pode alternar entre vários
"usuários simulados" usando `/as`.

### Roteiro completo — fluxo do admin criando bolão

```text
Humberto> oi
🤖 bot → Humberto (5511999999999)
  │ 👋 Opa Humberto! Sou o *VAR do Bolão* ⚽
  │ ...
  │ *O que você quer fazer?*
  │ • *criar bolão* — crio um novo bolão (R$ 99,90 via PIX)
  │ • *entrar em bolão* — entro num bolão existente
  │ ...

Humberto> criar bolão
🤖 bot → Humberto (5511999999999)
  │ ⚽ Criar novo bolão!
  │ Como quer chamar o bolão?

Humberto> Firma FC
🤖 bot → Humberto (5511999999999)
  │ ✅ Nome: *Firma FC*
  │ Agora define uma *senha* (mínimo 6 caracteres).

Humberto> cerveja123
🤖 bot → Humberto (5511999999999)
  │ 💰 *Pagamento pra criar o bolão "Firma FC"*
  │ Valor: R$ 99,90
  │ 📱 *PIX Copia e Cola:*
  │ ...

Humberto> /state          # confere estado atual do usuario
» sessao de Humberto:
  state: CRIANDO_BOLAO_AGUARDANDO_PIX
  ctx: { ... }

Humberto> /pix            # simula PIX recebido
» 1 cobranca(s) marcada(s) como PAGO no mock
» rodando job validate-pix...
🤖 bot → Humberto (5511999999999)
  │ ✅ Pagamento confirmado!
  │ 🏆 Bolão *Firma FC* criado com sucesso!
  │ 👑 Você é o admin.
```

### Roteiro completo — outro usuário pedindo pra entrar

```text
Humberto> /as Maria 5511988888888
» agora enviando como Maria (5511988888888)

Maria> entrar em bolão
🤖 bot → Maria (...)
  │ 🎯 Qual o nome do bolão que você quer entrar?

Maria> Firma FC
🤖 bot → Maria (...)
  │ 🔒 Bolão *Firma FC* encontrado.
  │ Qual a senha?

Maria> cerveja123
🤖 bot → Maria (...)
  │ ✅ Senha correta!
  │ 📤 Seu pedido foi enviado ao admin do bolão.

🤖 bot → Humberto (5511999999999)
  │ 🔔 *Novo pedido de entrada!*
  │ 👤 Maria quer entrar no bolão *Firma FC*.
  │ Pra aprovar: *!aprovar Maria*

Maria> /as Humberto 5511999999999
» agora enviando como Humberto (5511999999999)

Humberto> !aprovar Maria
🤖 bot → Humberto (...)
  │ ✅ Maria aprovado no bolão Firma FC!
🤖 bot → Maria (5511988888888)
  │ 🎉 Boa notícia! Você foi aprovado no bolão *Firma FC*! ⚽
```

### Roteiro completo — simular envio diário de jogos e palpites

Pra isso, o job precisa ter dados. Duas opções:

**A) Criar jogos manualmente via Prisma Studio:**
```bash
npx prisma studio
# abra Rodada → New record → escolha bolaoId, numero=1, status=ABERTA
# depois Jogo → New → rodadaId, times, dataHora=hoje
```

**B) Rodar o job diretamente no REPL:**
```text
Humberto> /tick-results    # se tiver API futebol mockada, traz jogos
```

(a API de futebol real tem adapter em `resultado.fetcher.ts` — em dev ela
usa dados mockados; ver `FOOTBALL_API_KEY=mock` no `.env`)

Com rodada criada e jogos agendados para hoje, rode `sendDailyGamesJob()`
manualmente (futura melhoria: adicionar `/send-daily-games` no REPL).

### Comandos úteis do REPL

| Comando | O que faz |
|---------|-----------|
| `/as NomeDoUsuario 5511XXXXXXXXX` | Troca o remetente — todas as mensagens a seguir sao como esse usuario |
| `/users` | Lista usuários criados na sessão |
| `/pix` | Marca todas cobranças PIX pendentes como pagas e roda o job — útil pra não esperar o auto-pay de 45s |
| `/tick-results` | Roda o job `fetch-results` agora (útil pra testar cálculo de pontuação e ranking) |
| `/state` | Mostra o estado atual da FSM do usuário (qual "tela" ele está) |
| `/clear` | Limpa a fila de mensagens capturadas (cosmético) |
| `/help` | Mostra menu completo |
| `/quit` | Sai |

---

## 3. Testando o webhook HTTP (sem Meta real)

Quando quiser exercitar o handler HTTP (e não só o router em memória), rode
o servidor em dry-run e dispare payloads no webhook com curl:

```bash
# terminal 1
DRY_RUN_META=true npm run dev

# terminal 2 — simula mensagem "oi" do usuario 5511999999999
curl -X POST http://localhost:3000/webhook/whatsapp \
  -H 'Content-Type: application/json' \
  -d '{
    "object": "whatsapp_business_account",
    "entry": [{
      "id": "WABA_ID",
      "changes": [{
        "field": "messages",
        "value": {
          "messaging_product": "whatsapp",
          "metadata": {"display_phone_number": "+5511988887777", "phone_number_id": "1"},
          "contacts": [{"profile": {"name": "Humberto"}, "wa_id": "5511999999999"}],
          "messages": [{
            "from": "5511999999999",
            "id": "wamid.test1",
            "timestamp": "1700000000",
            "type": "text",
            "text": {"body": "oi"}
          }]
        }
      }]
    }]
  }'
```

Em dev (`NODE_ENV=development`) a validação HMAC é pulada, então não precisa
assinar o body. No log do servidor você vê as mensagens "enviadas" (capturadas
pelo dry-run do meta.client). Em produção, a validação HMAC é obrigatória.

---

## 4. Quando o token da Meta chegar

1. Preenche no `.env`:
   ```ini
   DRY_RUN_META=false
   WHATSAPP_ACCESS_TOKEN=EAAD...
   WHATSAPP_PHONE_NUMBER_ID=1234567890
   WHATSAPP_VERIFY_TOKEN=uma-string-sua
   WHATSAPP_APP_SECRET=abc...
   ```
2. Expõe o webhook publicamente (ngrok em dev, domínio HTTPS em prod):
   ```bash
   ngrok http 3000
   ```
3. No Meta Developer Portal → App → WhatsApp → Configuration:
   - Callback URL: `https://seu-host/webhook/whatsapp`
   - Verify token: o mesmo de `WHATSAPP_VERIFY_TOKEN`
   - Assine os eventos: `messages`
4. `npm run dev` — pronto. O mesmo código que rodou no REPL agora responde
   de verdade.

Nenhuma linha de código muda entre dry-run e produção — só as envs.
