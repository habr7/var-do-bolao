# VAR do Bolão — Arquitetura Técnica

> Bot de WhatsApp para bolão de futebol que opera em **conversa direta** (DM) com
> cada usuário. Não depende de grupos. Inclui pagamento via PIX para criação de
> bolões e fluxo de aprovação manual para entrada em bolões existentes.

**Versão do documento:** 2.0
**Última atualização:** 2026-04
**Integração WhatsApp:** Meta WhatsApp Cloud API (oficial)

---

## 1. Visão geral do produto

### 1.1 O que é
O usuário adiciona o número do bot como contato. Toda interação acontece nessa
conversa individual. O bot é o único ponto de contato:

- **Criador do bolão** (admin): conversa com o bot, escolhe nome e senha, paga
  R$ 99,90 via PIX. O bot valida o pagamento e cria o bolão.
- **Participante**: pede pro bot entrar num bolão, informa o nome do bolão e a
  senha. O bot encaminha o pedido para o admin via DM. Admin aprova e a pessoa
  passa a receber os jogos do dia direto na conversa com o bot.
- **Jogos do dia**: diariamente, o bot envia em DM para cada participante a
  lista de jogos daquele dia e coleta palpites ali mesmo.

### 1.2 Por que DM (e não grupo)

1. **Privacidade dos palpites** — cada um palpita sem ver o dos outros
2. **Escala/custo** — futuramente na WhatsApp Cloud API, DMs iniciadas pelo
   usuário (janela de 24h) são mais baratas que mensagens template em grupos
3. **UX de fluxo** — permite FSM (máquina de estados) por usuário para guiar
   ações como criação e entrada em bolão
4. **Aprovação de admin** — o admin recebe o pedido direto dele, responde sim/não

### 1.3 Fluxos principais resumidos

```
[criar bolão]
  usuário → bot: "criar bolão"
  bot: "qual o nome?"               ← estado: CRIANDO_BOLAO_NOME
  usuário: "Firma FC"
  bot: "defina uma senha"           ← estado: CRIANDO_BOLAO_SENHA
  usuário: "cerveja123"
  bot: envia chave PIX + QR          ← estado: CRIANDO_BOLAO_AGUARDANDO_PIX
  usuário: (paga no banco)
  (cron valida PIX a cada 30s)
  bot: "pagamento recebido! Bolão criado. Você é admin."

[entrar em bolão]
  usuário → bot: "entrar em bolão"
  bot: "qual o nome do bolão?"      ← estado: ENTRANDO_NOME
  usuário: "Firma FC"
  bot: "qual a senha?"              ← estado: ENTRANDO_SENHA
  usuário: "cerveja123"
  bot: "pedido enviado ao admin"    ← cria SolicitacaoEntrada PENDENTE
  bot → admin: "Fulano quer entrar. Aprovar? (!aprovar Fulano / !recusar Fulano)"
  admin: "!aprovar Fulano"
  bot → Fulano: "aprovado! você está no bolão Firma FC"

[palpite diário]
  cron 09:00 → para cada participante com jogos hoje:
    bot → participante: lista de jogos + "envie seus palpites"
  participante: "Flamengo 2x1 Palmeiras\nCorinthians 0x0 São Paulo"
  bot: confirma cada palpite, contabiliza faltantes

[resultado/ranking]
  cron a cada 5min → busca resultados
  quando rodada finaliza → calcula pontos → envia ranking em DM para cada um
```

---

## 2. Stack

| Camada | Tecnologia | Observação |
|--------|------------|-------------|
| Runtime | Node.js 20 LTS + TypeScript 5 | ESM, strict mode |
| HTTP server | Fastify 4 | Recebe webhook do WhatsApp |
| Banco | PostgreSQL 16 | Via Docker em dev |
| ORM | Prisma 6 | Migrations versionadas |
| Cache / FSM | Redis 7 | Estado de conversa por usuário |
| Scheduler | `node-cron` | Jobs de resultados, ranking, jogos diários, validação PIX |
| WhatsApp | **Meta WhatsApp Cloud API** (graph.facebook.com) | API oficial, sem Evolution |
| Pagamento | PIX — abstração com adapter (mock em dev, provider real em prod) | |
| Imagens | `sharp` + SVG | Cards de ranking/resultados |
| Testes | Vitest | Unit + integração |
| Container | Docker + docker-compose | Apenas infra; app roda no host em dev |

---

## 3. Diagrama de alto nível

```
                          ┌──────────────────────────────┐
                          │  Meta WhatsApp Cloud API     │
                          │   graph.facebook.com/v18.0   │
                          └──────────────┬───────────────┘
                                         │ webhooks (HTTPS)
                                         │ + sendMessage (HTTPS)
                                         ▼
     ┌───────────────┐       ┌─────────────────────────────┐       ┌──────────────┐
     │  PIX Provider │◀──────│  VAR do Bolão (Fastify)    │──────▶│ PostgreSQL   │
     │  (mock/real)  │       │  - /webhook/whatsapp       │       │  Prisma      │
     └───────────────┘       │  - /webhook/pix            │       └──────────────┘
                             │  - Jobs (cron)             │
                             │  - FSM de conversa         │       ┌──────────────┐
                             │                            │──────▶│ Redis (FSM)  │
                             └─────────┬──────────────────┘       └──────────────┘
                                       │
                                       ▼
                             ┌───────────────────────┐
                             │ api-futebol (HTTP)    │
                             │ resultados dos jogos  │
                             └───────────────────────┘
```

---

## 4. Estrutura de pastas

```
var_do_bolao/
├── prisma/
│   └── schema.prisma              # Usuario, Bolao(senhaHash), Pagamento,
│                                  # SolicitacaoEntrada, Participacao, Rodada,
│                                  # Jogo, Palpite, PalpiteJogo
├── src/
│   ├── index.ts                   # bootstrap Fastify + jobs + healthcheck
│   ├── config/
│   │   ├── env.ts                 # Zod-validated env (dotenv/config)
│   │   ├── database.ts            # PrismaClient
│   │   └── redis.ts               # ioredis singleton
│   ├── whatsapp/
│   │   ├── webhook.handler.ts     # GET (verify) + POST (mensagens Meta)
│   │   ├── meta.client.ts         # Cliente HTTP Cloud API (sendText, sendImage, markRead)
│   │   ├── signature.ts           # Valida X-Hub-Signature-256 (HMAC com APP_SECRET)
│   │   ├── message.parser.ts      # Parser de comandos "!xxx" + texto livre
│   │   ├── session.manager.ts     # FSM por usuário (Redis)
│   │   └── command.router.ts      # Router que reage ao estado + comando
│   ├── modules/
│   │   ├── bolao/
│   │   │   ├── bolao.types.ts
│   │   │   ├── bolao.repository.ts
│   │   │   └── bolao.service.ts   # criar(nome, senha, adminId, pagamentoId)
│   │   ├── pagamento/
│   │   │   ├── pagamento.types.ts
│   │   │   ├── pagamento.repository.ts
│   │   │   ├── pagamento.service.ts   # gerarCobranca, validarPix, marcarPago
│   │   │   └── pix.adapter.ts         # interface + MockPixAdapter + (futuro) real
│   │   ├── solicitacao/
│   │   │   ├── solicitacao.types.ts
│   │   │   ├── solicitacao.repository.ts
│   │   │   └── solicitacao.service.ts # criar, aprovar, recusar, listarPendentes
│   │   ├── rodada/
│   │   │   ├── rodada.repository.ts
│   │   │   └── rodada.service.ts
│   │   ├── palpite/
│   │   │   ├── palpite.repository.ts
│   │   │   └── palpite.service.ts
│   │   ├── ranking/
│   │   │   ├── ranking.repository.ts
│   │   │   ├── ranking.service.ts
│   │   │   └── pontuacao.calc.ts   # função pura (testada isoladamente)
│   │   ├── resultado/
│   │   │   ├── resultado.fetcher.ts
│   │   │   └── resultado.service.ts
│   │   └── notificacao/
│   │       └── notificacao.service.ts # envia DM pra um ou muitos
│   ├── jobs/
│   │   ├── index.ts                  # registra todos crons
│   │   ├── fetch-results.job.ts      # */5min
│   │   ├── calculate-scores.job.ts   # */10min
│   │   ├── send-daily-games.job.ts   # 09:00 — jogos do dia por DM
│   │   ├── send-reminders.job.ts     # */30min — quem não palpitou
│   │   ├── send-ranking.job.ts       # hora em hora
│   │   └── validate-pix.job.ts       # */30s — confirma pagamentos pendentes
│   ├── image/
│   │   ├── ranking.card.ts
│   │   └── result.card.ts
│   ├── types/global.d.ts
│   └── utils/
│       ├── football.terms.ts
│       ├── formatting.ts
│       ├── validators.ts
│       └── password.ts            # hash + compare (bcrypt)
├── tests/unit/…
├── docker-compose.yml              # postgres + redis (SEM evolution)
├── Dockerfile
├── .env.example
└── VAR_DO_BOLAO_ARQUITETURA.md
```

---

## 5. Integração com Meta WhatsApp Cloud API

### 5.1 Pré-requisitos no lado Meta
- Conta Meta Business + app
- Número de telefone verificado no WhatsApp Business
- `PHONE_NUMBER_ID` e `ACCESS_TOKEN` (gerar token permanente via Graph API)
- `APP_SECRET` (para validar assinatura do webhook)
- `VERIFY_TOKEN` (string escolhida pelo dev — usada no handshake do webhook)
- Webhook público HTTPS configurado para `{APP_URL}/webhook/whatsapp`
  apontando para o nosso endpoint

### 5.2 Webhook (entrada de mensagens)

**Handshake (GET):**
```
GET /webhook/whatsapp?hub.mode=subscribe&hub.verify_token=XXX&hub.challenge=YYY
```
A app devolve `hub.challenge` em texto puro se o `verify_token` bater com
`WHATSAPP_VERIFY_TOKEN` do `.env`.

**Mensagens (POST):**
Corpo do webhook v18.0:
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "...", "phone_number_id": "..." },
        "contacts": [{ "profile": { "name": "Fulano" }, "wa_id": "5511..." }],
        "messages": [{
          "from": "5511999999999",
          "id": "wamid.HBgN...",
          "timestamp": "1700000000",
          "type": "text",
          "text": { "body": "criar bolão" }
        }]
      }
    }]
  }]
}
```

A app:
1. Valida `X-Hub-Signature-256` com HMAC-SHA256 usando `APP_SECRET`
2. Extrai `from` (wa_id) e `text.body`
3. Marca como lida via `messages/{id}/read` (opcional, mas melhora UX)
4. Entra no FSM (`session.manager`) + roteia em `command.router`

### 5.3 Envio de mensagens

```
POST https://graph.facebook.com/v18.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {ACCESS_TOKEN}
Content-Type: application/json

{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "5511999999999",
  "type": "text",
  "text": { "body": "Olá, craque!" }
}
```

Para imagens:
```json
{
  "messaging_product": "whatsapp",
  "to": "5511999999999",
  "type": "image",
  "image": { "link": "https://.../ranking.png", "caption": "Ranking da rodada" }
}
```

### 5.4 Janela de 24h e templates
- Resposta a uma mensagem do usuário: cabe na **customer service window (24h)**
  — mensagem de texto livre é permitida e barata.
- Mensagens iniciadas pelo bot fora da janela de 24h (ex.: "jogos do dia")
  precisam ser **templates aprovados**. Templates: `daily_games_notification`,
  `approval_request`, `ranking_final` — ficam listados em
  `docs/whatsapp-templates.md` (criar no futuro).

### 5.5 Migração Evolution → Meta Cloud
Diferenças que o código esconde atrás da interface `WhatsAppClient`:

| Aspecto | Evolution (antes) | Meta Cloud (agora) |
|---------|-------------------|--------------------|
| `to` format | `5511999999999@s.whatsapp.net` | `5511999999999` (só dígitos) |
| Webhook shape | `data.message.conversation` | `entry[].changes[].value.messages[].text.body` |
| Auth | `apikey` header | `Authorization: Bearer` |
| Envio de imagem | base64 inline | URL pública ou media_id prévio |
| Assinatura | — | `X-Hub-Signature-256` (HMAC) |

---

## 6. Fluxos de negócio (FSM)

### 6.1 Estados por usuário
Armazenados em Redis (`session:{wa_id}`), TTL 30min:

```ts
type ConversaState =
  | 'IDLE'
  | 'CRIANDO_BOLAO_NOME'
  | 'CRIANDO_BOLAO_SENHA'
  | 'CRIANDO_BOLAO_AGUARDANDO_PIX'
  | 'ENTRANDO_NOME'
  | 'ENTRANDO_SENHA'
  | 'PALPITANDO';

interface Session {
  state: ConversaState;
  ctx?: {
    nomeBolao?: string;
    senhaBolao?: string;
    pagamentoId?: string;
    bolaoId?: string;
    rodadaId?: string;
    jogosPendentes?: string[];
  };
}
```

### 6.2 Criar bolão (happy path)
1. `IDLE` + comando `criar bolão` → `CRIANDO_BOLAO_NOME`, pergunta nome
2. `CRIANDO_BOLAO_NOME` + texto livre → valida único por admin, salva em ctx,
   vai para `CRIANDO_BOLAO_SENHA`
3. `CRIANDO_BOLAO_SENHA` + texto livre (≥6 chars) → hash bcrypt, chama
   `pagamento.service.gerarCobranca({bolaoNome, adminId, valor: 9990})`,
   envia chave PIX + QR code (imagem), vai para `CRIANDO_BOLAO_AGUARDANDO_PIX`
4. Estado persiste. Job `validate-pix` (cada 30s) consulta o provider. Quando
   confirmar pagamento → `bolao.service.criar({…, pagamentoId, senhaHash})` +
   envia confirmação + volta para `IDLE`.

### 6.3 Entrar em bolão
1. `IDLE` + `entrar em bolão` → `ENTRANDO_NOME`
2. `ENTRANDO_NOME` + texto → busca `findFirst({nome, status:ATIVO})`. Se não
   achar: mensagem e volta `IDLE`. Se achar: guarda em ctx e vai `ENTRANDO_SENHA`
3. `ENTRANDO_SENHA` + texto → `bcrypt.compare`. Se errada: "senha incorreta" +
   `IDLE`. Se certa: `solicitacao.service.criar()`, DM para admin com botão
   texto `!aprovar Fulano` / `!recusar Fulano`, confirma ao solicitante
4. Admin responde `!aprovar NOME` — `solicitacao.service.aprovar(id)` cria
   `Participacao`, bot DM ao solicitante "aprovado!"

### 6.4 Palpite diário
1. Cron `send-daily-games` (09:00):
   - Lista participantes com rodada aberta e jogos hoje
   - Para cada: envia mensagem com lista numerada de jogos e instrução
   - Seta `state: PALPITANDO`, `ctx.rodadaId`, `ctx.jogosPendentes`
2. Usuário envia `Flamengo 2x1 Palmeiras` (uma ou várias linhas)
   - Parser `parseMultiplePalpites` → para cada jogo válido:
     `palpite.service.registrarPalpite(…)`
   - Remove jogo de `jogosPendentes`. Se vazio → "todos palpites registrados!"
     + `IDLE`
3. Cron `send-reminders` (30min antes do fechamento) cutuca quem ainda tem
   `jogosPendentes`

---

## 7. Modelo de dados (Prisma)

Mudanças principais vs v1:

- `Bolao`: adiciona `senhaHash String`, remove obrigatoriedade de
  `grupoWhatsappId` (agora é opcional/legado — removido)
- `Usuario`: sem mudanças conceituais (`whatsappId` agora é o `wa_id` da
  Meta, só dígitos)
- **Novo:** `Pagamento` — uma linha por tentativa de criação de bolão
  ```prisma
  model Pagamento {
    id            String   @id @default(cuid())
    usuarioId     String
    valorCentavos Int      @default(9990)
    status        PagamentoStatus @default(PENDENTE)
    pixExternalId String?  @unique
    pixCopiaCola  String?
    pixQrCodeUrl  String?
    nomeBolaoPretendido String
    senhaBolaoHashPretendido String
    pagoEm        DateTime?
    expiraEm      DateTime
    criadoEm      DateTime @default(now())
    usuario       Usuario  @relation(fields: [usuarioId], references: [id])
    bolao         Bolao?
  }
  enum PagamentoStatus { PENDENTE PAGO EXPIRADO CANCELADO }
  ```
- **Novo:** `SolicitacaoEntrada` — uma linha por pedido de entrada
  ```prisma
  model SolicitacaoEntrada {
    id          String @id @default(cuid())
    usuarioId   String
    bolaoId     String
    status      SolicitacaoStatus @default(PENDENTE)
    respondidoEm DateTime?
    criadoEm    DateTime @default(now())
    usuario     Usuario  @relation(fields:[usuarioId], references:[id])
    bolao       Bolao    @relation(fields:[bolaoId],   references:[id])
  }
  enum SolicitacaoStatus { PENDENTE APROVADA RECUSADA }
  ```

---

## 8. Variáveis de ambiente

```ini
# App
NODE_ENV=development
PORT=3000
APP_URL=https://abc123.ngrok.app    # precisa ser público para Meta entregar webhook

# Database
DATABASE_URL=postgresql://varbolao:senha_segura@localhost:5433/varbolao
POSTGRES_PASSWORD=senha_segura

# Redis
REDIS_URL=redis://localhost:6380/0

# Meta WhatsApp Cloud API
WHATSAPP_ACCESS_TOKEN=EAAD...            # Graph API token (permanente)
WHATSAPP_PHONE_NUMBER_ID=1234567890
WHATSAPP_VERIFY_TOKEN=uma_string_qualquer # precisa bater com o config no Meta
WHATSAPP_APP_SECRET=abcdef...            # valida X-Hub-Signature-256
WHATSAPP_API_VERSION=v18.0

# API de futebol
FOOTBALL_API_KEY=mock                     # "mock" usa adapter fake
FOOTBALL_API_URL=https://www.api-futebol.com.br/v1

# PIX
PIX_PROVIDER=mock                         # "mock" | "mercadopago" | "gerencianet"
PIX_ACCESS_TOKEN=
PIX_CHAVE=varbolao@exemplo.com
PIX_VALOR_CENTAVOS=9990                   # 99,90

# Bot
BOT_PREFIX=!
TIMEZONE=America/Sao_Paulo
DEFAULT_CAMPEONATO=brasileirao-serie-a
HORARIO_ENVIO_JOGOS_DIA=09:00
```

---

## 9. Pontuação

Mantida da v1. Função pura em `modules/ranking/pontuacao.calc.ts`:

| Caso | Pontos |
|------|--------|
| Placar exato | 10 |
| Resultado certo + gols de um time | 7 |
| Apenas resultado certo | 5 |
| Apenas gols de um time | 3 |
| Errou tudo | 0 |

---

## 10. Jobs agendados

| Job | Intervalo | O que faz |
|-----|-----------|-----------|
| `validate-pix` | */30s | Consulta provider PIX, marca `Pagamento.status=PAGO`, cria `Bolao`, avisa admin |
| `fetch-results` | */5min | Puxa resultados da API de futebol, atualiza `Jogo` |
| `calculate-scores` | */10min | Calcula pontos das rodadas finalizadas ainda não calculadas |
| `send-daily-games` | 0 9 * * * | Envia DM para cada participante com jogos do dia |
| `send-reminders` | */30min | Cutuca quem tem `jogosPendentes` |
| `send-ranking` | 0 * * * * | Envia ranking pós-rodada em DM para cada participante |

---

## 11. Comandos do bot (em DM)

| Texto | Efeito |
|-------|--------|
| `oi`, `menu`, `!ajuda` | Menu inicial com opções |
| `criar bolão` | Inicia fluxo FSM de criação |
| `entrar em bolão` | Inicia fluxo FSM de entrada |
| `meus bolões` | Lista todos os bolões onde é participante ou admin |
| `ranking <bolão>` | Ranking de um bolão específico |
| `meus pontos [<bolão>]` | Pontuação pessoal (se só tem 1 bolão, pode omitir) |
| `jogos hoje [<bolão>]` | Jogos do dia |
| `meu palpite [<bolão>]` | Palpites da rodada atual |
| `<time> NxN <time>` | Palpite inline (quando em `PALPITANDO`) |
| `!aprovar <nome>` | Admin aprova solicitação pendente |
| `!recusar <nome>` | Admin recusa |
| `cancelar` | Volta para `IDLE` |

---

## 12. Segurança

- **Validação HMAC do webhook Meta** — toda request POST `/webhook/whatsapp`
  só é processada se `X-Hub-Signature-256` bater com HMAC-SHA256 do raw body
  usando `WHATSAPP_APP_SECRET`. Responder 200 para eventos inválidos (para
  não sinalizar que é um bot) mas sem processar.
- **Senha do bolão** — `bcrypt` hash com 10 rounds, nunca armazenada em claro.
- **Rate limit** — Fastify com `@fastify/rate-limit` no endpoint `/webhook/*`
  (a definir).
- **Não logar PII** — no log não sair `wa_id` completo nem senha.

---

## 13. Deploy / infra

### 13.1 Dev
```bash
cp .env.example .env  # preencher WHATSAPP_* com valores do Meta
docker compose up -d  # postgres + redis
npx prisma migrate dev
npm install
npm run dev            # Fastify em :3000
ngrok http 3000        # expor publicamente para o Meta entregar webhook
# configurar o URL do ngrok em Meta → App → WhatsApp → Configuration → Webhook
```

### 13.2 Produção (esboço)
- Container `app` no Docker Compose ou em Fly.io/Railway
- Banco Postgres gerenciado
- Redis gerenciado
- Domínio público com HTTPS (obrigatório pela Meta)
- Secrets via env do runtime (nunca `.env` versionado)

---

## 14. Itens adiados (roadmap)

- [ ] Templates aprovados da Meta para mensagens fora da janela de 24h
- [ ] Adapter real de PIX (Mercado Pago / Gerencianet / Banco)
- [ ] Dashboard web admin (listar bolões, pagamentos, métricas)
- [ ] Pagamento para entrar em bolão (quando for rateio de prêmio)
- [ ] Multi-idioma (por ora só pt-BR)
- [ ] Observabilidade (OpenTelemetry + logs estruturados)
- [ ] Refunds / cancelamento automático de `Pagamento` expirado
