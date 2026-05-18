# Plano & Roteiro — Site VAR do Bolão (`www.vardobolao.com.br`)

> Documento-briefing pra colar no Claude Code. Site one-pager institucional
> + área logada pra usuários consultarem ranking/palpites/pontuação.
>
> **Versão:** 1.0 — 2026-05-17
> **Autor:** Humberto + Claude (planejamento)
> **Stack do bot já existente:** Node 20 + TS + Fastify + Prisma + Postgres 16 + Redis 7 + Evolution API
> **Decisões já travadas:**
> - Frontend: **Next.js separado**, **mesmo DB** do bot via Prisma
> - Auth: **OTP via WhatsApp** (mesmo bot manda o código)
> - Hospedagem: **recomendação detalhada na seção 9**

---

## 1. Escopo (o que entra no MVP do site)

### 1.1 Página pública (one-pager em `/`)

Single page, scroll vertical, mobile-first. Seções:

1. **Hero** — slogan "A resenha do grupo com a precisão dos dados." + CTA primário "Criar bolão grátis no WhatsApp" (abre `wa.me` do bot com mensagem "criar bolão") + CTA secundário "Já participo, quero entrar".
2. **Como funciona** — 3 passos (Adiciona o bot → Cria ou entra → Palpita por chat). Cards com ícones, sem imagens pesadas.
3. **Por que VAR do Bolão** — 4 benefícios curtos: "100% no WhatsApp", "Sem app, sem cadastro chato", "Cálculo automático", "Privacidade dos palpites".
4. **Copa do Mundo 2026** — banner contextual: "Pronto pra Copa. 72 jogos, 1 ranking, zero planilha."
5. **FAQ** — accordion com 5–7 perguntas (é grátis?, como funciona a pontuação?, posso editar palpite?, e se eu não souber programar?, etc).
6. **Fale conosco** — bloco simples com `contato@vardobolao.com.br` (link `mailto:`). **Sem formulário** no MVP — reduz superfície de spam e não precisa de backend de email.
7. **Footer** — logo, link `/login`, link `/politica-privacidade`, link `/termos`, copyright.

### 1.2 Área logada (`/app`)

Tudo read-only no MVP. Qualquer ação destrutiva (palpitar, editar palpite, sair de bolão) redireciona pro WhatsApp com mensagem pré-preenchida.

Rotas:

- `/login` — celular + OTP
- `/login/primeiro-acesso` — completar cadastro (nome, email, endereço, senha) **se o `whatsappId` já existe no bot mas o registro web ainda não foi criado**
- `/app` — dashboard: lista de bolões com posição atual + pontos
- `/app/bolao/[codigo]` — ranking completo do bolão + abas:
  - **Ranking** (default)
  - **Meus palpites** (histórico, com pontuação por jogo)
  - **Próximos jogos** (read-only — botão "Palpitar" abre WhatsApp)
- `/app/perfil` — dados cadastrais + "Sair"

### 1.3 Out of scope (NÃO entra no MVP)

- ❌ Criar bolão pelo site (só pelo bot)
- ❌ Palpitar pelo site (só pelo bot — mensagem clara: *"Pra palpitar, manda no WhatsApp: Brasil 2x1 Marrocos"*)
- ❌ Aprovar/recusar pedidos pelo site
- ❌ Pagamento (PIX está desativado no bot mesmo)
- ❌ Notificações push web
- ❌ Compartilhamento social de ranking
- ❌ Tema dark/light toggle (só dark, alinhado com identidade)
- ❌ i18n (só PT-BR)

---

## 2. Identidade visual (do moodboard)

### 2.1 Paleta (CSS custom properties)

```css
:root {
  --verde-conexao: #25D366;   /* WhatsApp green - CTAs primários */
  --verde-gramado: #1B5E20;   /* fundo escuro principal */
  --verde-gramado-dark: #0F3814; /* fundo ainda mais escuro pra contraste */
  --branco-puro: #FFFFFF;
  --amarelo-arbitro: #FFEA00; /* alertas, destaques */
  --cinza-suave: #E8E8E8;     /* textos secundários sobre verde */
  --cinza-chumbo: #1a1a1a;    /* fundo de cards */
}
```

**Diretriz:** o site é **dark por padrão**, fundo verde-gramado escuro. Verde-conexão só nos CTAs principais (pra preservar peso visual). Amarelo árbitro só em badges/alertas (ex: "Rodada aberta", "Falta palpitar").

### 2.2 Tipografia

- **Títulos/Logo:** `Archivo Black` (Google Fonts) — robusta, condensada
- **Corpo/UI:** `Inter` (Google Fonts) — legibilidade em mobile

Tamanhos base (Tailwind):
- Hero h1: `text-5xl md:text-7xl`
- H2 seções: `text-3xl md:text-4xl`
- Corpo: `text-base md:text-lg`

### 2.3 Elementos visuais

- **Moldura "VAR"** (cantos de mira `[ ]`) como elemento decorativo em cards de bolão e no hero — reforça o conceito de "validação"
- **Linhas de campo** como divisores entre seções (linha branca fina, opacidade 20%)
- **Ícone-checkmark** verde-conexão pra "palpite validado", "ponto computado"
- **Bola de futebol** do logo aparece sutil em backgrounds (svg, opacidade 5–10%)

### 2.4 Tom de voz (texto da UI)

- Direto e boleiro: "Bora palpitar", "Tá na frente!", "Pisou na bola"
- **Nunca** infantilizar nem ser formal demais
- Erros: tom leve. "Errou a senha. Tenta de novo, craque." em vez de "Senha incorreta."

---

## 3. Stack técnico

```
Frontend (NOVO repo: var-do-bolao-web)
├── Next.js 15 (App Router, Server Components)
├── TypeScript 5 strict
├── Tailwind CSS 4 + shadcn/ui (Button, Input, Card, Tabs, Accordion, Dialog)
├── Auth: iron-session (cookie httpOnly, mesmo domínio)
├── ORM: Prisma 6 (mesmo schema do bot — importa via path mapping)
├── Form validation: zod + react-hook-form
├── Fetch: nativo (fetch + cache de Server Components)
└── Lucide icons

Backend (REUSA o bot existente)
├── Bot já existente expõe NOVOS endpoints REST no Fastify:
│   POST /api/auth/otp/request   — gera OTP, manda via Evolution
│   POST /api/auth/otp/verify    — valida OTP, devolve session
│   POST /api/auth/first-access  — cria UsuarioWeb (nome/email/endereço/senha)
│   POST /api/auth/login         — login com senha (acessos subsequentes)
│   GET  /api/me                 — dados do usuário logado
│   GET  /api/me/boloes          — bolões que participa
│   GET  /api/boloes/:codigo/ranking
│   GET  /api/boloes/:codigo/meus-palpites
│   GET  /api/boloes/:codigo/proximos-jogos
│   POST /api/auth/logout
└── Cookie de sessão emitido pelo Next, validado por middleware no Fastify
   (assinatura HMAC compartilhada via env)
```

### 3.1 Por que Next.js separado e não tudo no Fastify

- **SSR + SEO** — landing precisa indexar bem. Fastify serve HTML mas não tem ergonomia de rotas/SSR
- **Deploy independente** — pode atualizar o site sem mexer no bot (e vice-versa)
- **Time-to-first-paint** — Next na edge da Vercel/Cloudflare é mais rápido que servir do Postgres local
- **Risco isolado** — bug no site não derruba o bot

### 3.2 Por que mesmo banco (não banco separado)

- Bolões, palpites, pontuação **já vivem no Postgres do bot**. Duplicar geraria sincronização imprecisa
- Acesso do Next ao banco é **read-only no MVP** (escrita só pelo bot via WhatsApp)
- Exceção: **tabela nova `UsuarioWeb`** com credenciais web (senha hash, email, endereço). Linkada 1-1 com `Usuario` existente

---

## 4. Mudanças necessárias no projeto do bot

### 4.1 Schema novo (`prisma/schema.prisma` do bot)

```prisma
model UsuarioWeb {
  id           String   @id @default(uuid())
  usuarioId    String   @unique          // FK pro Usuario existente
  email        String   @unique
  senhaHash    String                    // bcrypt cost 12
  endereco     String                    // free text por enquanto
  emailVerificado Boolean @default(false) // futuro: validação de email
  criadoEm     DateTime @default(now())
  atualizadoEm DateTime @updatedAt
  usuario      Usuario  @relation(fields: [usuarioId], references: [id])
}

model OtpToken {
  id           String   @id @default(uuid())
  whatsappId   String                    // sem unique — pode ter vários tokens ativos? não. Index abaixo evita
  codigo       String                    // 6 dígitos
  usadoEm      DateTime?
  expiraEm     DateTime                  // 10min
  tentativas   Int      @default(0)      // anti brute force, max 5
  criadoEm     DateTime @default(now())
  @@index([whatsappId, codigo])
}
```

Atualiza `Usuario`:
```prisma
model Usuario {
  // ... campos existentes
  usuarioWeb UsuarioWeb?
}
```

### 4.2 Endpoints novos no Fastify (`src/web-api/`)

Pasta nova `src/web-api/` com:
- `auth.routes.ts` — OTP + login + first-access + logout
- `me.routes.ts` — dados do usuário + bolões
- `bolao.routes.ts` — ranking + palpites + jogos
- `session.middleware.ts` — valida cookie HMAC
- `rate-limit.middleware.ts` — bucket por IP + por waId (anti brute force OTP)

CORS configurado pra aceitar só `https://www.vardobolao.com.br` em prod.

### 4.3 Integração OTP via bot

Quando o site chama `POST /api/auth/otp/request` com um celular:
1. Backend valida que existe `Usuario` com aquele `whatsappId`
2. Gera código 6 dígitos, salva em `OtpToken`
3. Chama `evolutionClient.sendText(waId, "Seu código de acesso ao VAR do Bolão: 482917. Vale por 10 minutos. Não compartilha com ninguém.")`
4. Devolve `200 OK` (não confirma se o número existe — anti enumeration)

Rate limit: 1 OTP a cada 60s por waId, max 5/dia.

### 4.4 Não regredir invariantes do bot

A doc de arquitetura tem uma seção crítica de invariantes (seção 9.1):
- `criarBolao` é atômico
- `Jogo.apiJogoId` unique por rodada
- Listagens distinguem ativos vs histórico

**O backend novo só LÊ via Prisma — usa as MESMAS funções de repository existentes** (`listarBoloesDoUsuarioComHistorico`, `getRankingDoBolao`). **Não duplicar query lógica.** Isso evita drift de regras entre canais.

---

## 5. Fluxos de auth detalhados

### 5.1 Primeiro acesso

```
Usuário no /login
  ├─ digita celular: +55 11 99999-9999
  └─ clica "Entrar"

Frontend valida formato → normaliza pra dígitos → POST /api/auth/otp/request

Backend:
  ├─ existe Usuario com esse whatsappId?
  │   ├─ NÃO → devolve 200 fake (anti enumeration), mas não manda OTP
  │   └─ SIM → gera OTP, salva, manda via bot
  └─ devolve 200 sempre

Frontend mostra tela "Digite o código de 6 dígitos que mandamos no WhatsApp"
  ├─ usuário cola código → POST /api/auth/otp/verify
  └─ backend valida:
      ├─ código inválido → conta tentativa, 429 se >5
      ├─ código expirado → 410
      └─ código ok → procura UsuarioWeb
          ├─ EXISTE → emite cookie de sessão, redireciona /app
          └─ NÃO EXISTE → cookie temporário "pré-cadastro",
                          redireciona /login/primeiro-acesso

Em /login/primeiro-acesso:
  Form com nome (pré-preenchido do Usuario.nome), email, endereço, senha (min 8 chars)
  → POST /api/auth/first-access (com cookie temporário)
  → cria UsuarioWeb, troca pra cookie de sessão normal, redireciona /app
```

### 5.2 Acessos subsequentes

Dois caminhos:
- **Rápido (OTP):** mesmo fluxo acima, sem first-access
- **Senha:** /login → "Já tenho senha" → email + senha → POST /api/auth/login

Senha é opcional (OTP cobre o caso). Mas oferece pra quem usa muito.

### 5.3 Sessão

- `iron-session` no Next, cookie httpOnly, SameSite=Lax, Secure em prod
- Expira em **30 dias**, renovado a cada request
- Cookie carrega só `{ usuarioId, usuarioWebId, exp }` — nada sensível
- Logout: clear cookie + invalida no servidor (lista de revogação? não — TTL curto já basta no MVP)

---

## 6. Páginas — wireframe textual

### 6.1 `/` (landing)

```
┌──────────────────────────────────────────┐
│  [logo VAR do Bolão]        [Entrar →]   │ ← header fixo
├──────────────────────────────────────────┤
│                                          │
│      A RESENHA DO GRUPO COM A            │
│      PRECISÃO DOS DADOS.                 │
│                                          │
│      Bolão de Copa do Mundo 100% no      │
│      WhatsApp. Sem app, sem planilha.    │
│                                          │
│   [Criar bolão grátis no WhatsApp]       │ ← CTA primário (verde-conexão)
│   [Já participo →]                       │ ← secundário (outline)
│                                          │
│   ⚽ 72 jogos da Copa 2026                │
│                                          │
├──────────────────────────────────────────┤
│            COMO FUNCIONA                 │
│                                          │
│  [1]              [2]              [3]   │
│  Adiciona         Cria ou         Palpita│
│  o bot            entra            por   │
│                                    chat  │
├──────────────────────────────────────────┤
│      POR QUE VAR DO BOLÃO                │
│  ✓ 100% no WhatsApp                      │
│  ✓ Sem app, sem cadastro chato           │
│  ✓ Cálculo automático (10/7/5/3/0)       │
│  ✓ Privacidade dos palpites              │
├──────────────────────────────────────────┤
│            COPA 2026                     │
│   Banner contextual c/ contagem regressiva│
├──────────────────────────────────────────┤
│              FAQ (accordion)             │
├──────────────────────────────────────────┤
│         FALE CONOSCO                     │
│   contato@vardobolao.com.br              │
├──────────────────────────────────────────┤
│  Footer: logo · login · privacidade ·    │
│  termos · © 2026                         │
└──────────────────────────────────────────┘
```

### 6.2 `/app` (dashboard logado)

```
┌──────────────────────────────────────────┐
│  [logo]    Olá, Humberto    [perfil ▾]  │
├──────────────────────────────────────────┤
│  MEUS BOLÕES                             │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Bolão da Firma          #K3MZ8P    │  │
│  │ 👑 Admin                            │  │
│  │ Posição: 3º de 12 · 47 pontos      │  │
│  │ Próximo jogo: Brasil x Marrocos    │  │
│  │ em 2h ⚠ FALTA PALPITAR             │  │ ← amarelo-arbitro
│  │ [Ver ranking →]                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Bolão da Galera        #X7M2QN     │  │
│  │ Posição: 1º de 8 · 89 pontos 🏆    │  │
│  │ [Ver ranking →]                    │  │
│  └────────────────────────────────────┘  │
│                                          │
│  💡 Pra palpitar ou criar bolão, fala    │
│     com o bot no WhatsApp.               │
│     [Abrir conversa →]                   │
└──────────────────────────────────────────┘
```

### 6.3 `/app/bolao/[codigo]`

Tabs: **Ranking** | **Meus palpites** | **Próximos jogos**

**Tab Ranking:**
```
1. 👑 Humberto (você)   89 pts
2.    João Silva        76 pts
3.    Maria             71 pts
...
```

**Tab Meus palpites:**
```
RODADA 1 — Grupo A
Brasil 2x1 Marrocos     palpite: 2x1  ✓ 10 pts (exato!)
França 0x0 Argentina    palpite: 1x0  ✗ 0 pts

RODADA 2 — Grupo A
Brasil x Espanha        palpite: 2x0  (em aberto)
                                      [Editar pelo WhatsApp →]
```

**Tab Próximos jogos:**
```
Hoje
20:00  Brasil x Marrocos    [Palpitar pelo WhatsApp →]

Amanhã
17:00  França x Espanha     [Palpitar pelo WhatsApp →]
```

---

## 7. Estrutura de pastas do novo repo

```
var-do-bolao-web/
├── README.md
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env.example
├── public/
│   ├── logo.svg
│   ├── favicon.ico
│   └── og-image.png             # social share
├── src/
│   ├── app/
│   │   ├── layout.tsx           # font loading, providers
│   │   ├── page.tsx             # landing /
│   │   ├── login/
│   │   │   ├── page.tsx
│   │   │   └── primeiro-acesso/page.tsx
│   │   ├── app/
│   │   │   ├── layout.tsx       # checa sessão, redirect /login
│   │   │   ├── page.tsx         # dashboard
│   │   │   ├── bolao/[codigo]/page.tsx
│   │   │   └── perfil/page.tsx
│   │   ├── politica-privacidade/page.tsx
│   │   ├── termos/page.tsx
│   │   └── api/
│   │       └── auth/
│   │           └── [...]/route.ts  # proxy pro Fastify (mantém cookie)
│   ├── components/
│   │   ├── landing/              # Hero, ComoFunciona, FAQ, etc
│   │   ├── app/                  # BolaoCard, RankingTable, etc
│   │   ├── ui/                   # shadcn primitives
│   │   └── layout/               # Header, Footer
│   ├── lib/
│   │   ├── api-client.ts         # wrapper fetch pro Fastify
│   │   ├── session.ts            # iron-session config
│   │   ├── format.ts             # formatadores PT-BR (data, plural)
│   │   └── constants.ts
│   └── styles/globals.css
└── docker/Dockerfile             # se for deployar containerizado
```

---

## 8. Plano de execução em fases

> Estimativas com vibe coding via Claude Code (não é "dev manual"). Atribui horas, não dias, pra calibrar expectativa.

### Fase 0 — Setup e fundação (3–4h)

- [ ] Cria repo `var-do-bolao-web` (público ou privado, decidir)
- [ ] `npx create-next-app@latest` com TS, Tailwind, App Router
- [ ] Instala shadcn/ui e adiciona componentes: button, input, card, tabs, accordion, dialog, label, separator
- [ ] Configura ESLint, Prettier, lint-staged
- [ ] Configura paths no `tsconfig`: `@/components`, `@/lib`, `@/app`
- [ ] Importa fontes Google (Archivo Black + Inter) via `next/font`
- [ ] Cria `globals.css` com variáveis CSS da paleta
- [ ] Mock data files em `src/lib/mock/` (ranking, palpites, bolões) pra desenvolver UI sem API pronta

### Fase 1 — Landing page (4–6h)

- [ ] Componente `<Header>` fixo, mobile drawer com hamburger
- [ ] `<Hero>` com tipografia Archivo Black, CTAs, fundo verde-gramado
- [ ] `<ComoFunciona>` 3 cards com ícones lucide (smartphone, plus-circle, message-circle)
- [ ] `<PorQue>` 4 benefícios em grid 2x2 mobile, 4 colunas desktop
- [ ] `<Copa2026>` banner com countdown JS (`Intl.RelativeTimeFormat`)
- [ ] `<FAQ>` accordion shadcn, 6 perguntas (script abaixo)
- [ ] `<FaleConosco>` bloco simples com mailto
- [ ] `<Footer>`
- [ ] Páginas `/politica-privacidade` e `/termos` (texto template, marcado pra revisão jurídica depois)
- [ ] OG image (1200x630) + meta tags (title, description, twitter card)
- [ ] Teste mobile real (iPhone SE até iPhone Pro Max)

**Conteúdo do FAQ:**
1. É grátis? — Sim, criar e participar de bolões é gratuito. (Já que PIX tá desativado.)
2. Como funciona a pontuação? — 10 pts placar exato, 7 pts resultado + gols de um time, 5 pts só resultado, 3 pts só gols de um lado, 0 errou tudo.
3. Posso editar meu palpite? — Sim, enquanto a rodada estiver aberta. Manda "editar palpite" pro bot.
4. Funciona em iPhone e Android? — Funciona em qualquer celular com WhatsApp.
5. Meus palpites são privados? — Sim, só você vê os seus até o jogo acontecer.
6. Posso ter mais de um bolão? — Pode, e o bot detecta automaticamente em qual você quer palpitar.

### Fase 2 — Backend (endpoints no bot existente) (5–7h)

- [ ] Cria `src/web-api/` no repo `var-do-bolao`
- [ ] Migration Prisma: `UsuarioWeb` + `OtpToken` + relação no `Usuario`
- [ ] `auth.routes.ts`:
  - [ ] `POST /api/auth/otp/request` — gera + manda via Evolution
  - [ ] `POST /api/auth/otp/verify` — valida + emite cookie
  - [ ] `POST /api/auth/first-access` — cria UsuarioWeb
  - [ ] `POST /api/auth/login` — senha
  - [ ] `POST /api/auth/logout`
- [ ] `me.routes.ts` — GET /api/me, /api/me/boloes
- [ ] `bolao.routes.ts` — ranking, palpites, próximos-jogos
- [ ] `session.middleware.ts` — valida HMAC + lê cookie
- [ ] `rate-limit.middleware.ts` — Redis bucket por IP e waId
- [ ] CORS config (env: `WEB_ORIGIN`)
- [ ] Testes unit pra novos endpoints (mock Evolution, mock Prisma)
- [ ] Atualiza `VAR_DO_BOLAO_ARQUITETURA.md` — seção nova "Web API"

### Fase 3 — Login e área logada (5–7h)

- [ ] Page `/login` — input celular (mask `+55 (XX) XXXXX-XXXX`), botão "Receber código"
- [ ] Page de verificação OTP — 6 inputs `<input type="text" maxLength={1}>`, paste detection
- [ ] Page `/login/primeiro-acesso` — form completo (nome readonly, email, endereço, senha + confirmar)
- [ ] `lib/session.ts` — iron-session helpers
- [ ] `lib/api-client.ts` — fetch wrapper com cookie forwarding
- [ ] Middleware Next.js (`middleware.ts`) — redirect `/app/*` pra `/login` se não logado
- [ ] Page `/app` (dashboard) — busca `/api/me/boloes`, renderiza cards
- [ ] Page `/app/bolao/[codigo]` — tabs com 3 visões
- [ ] Page `/app/perfil` — dados + sair
- [ ] Estados de loading (skeleton) e erro (toast)
- [ ] Empty states: "Você ainda não participa de nenhum bolão. [Como entrar →]"

### Fase 4 — QA, polish, deploy (4–6h)

- [ ] Lighthouse audit (target: >90 em todas as 4 métricas)
- [ ] Acessibilidade básica: alt em imagens, label em inputs, contraste WCAG AA
- [ ] Teste em browsers reais: Chrome, Safari iOS, Firefox, Edge
- [ ] Teste de OTP fim-a-fim com WhatsApp real (DRY_RUN_WHATSAPP=false)
- [ ] Teste de rate limit (tenta 6 OTPs seguidos, deve barrar)
- [ ] Configura domínio `vardobolao.com.br` no registrador (Registro.br)
- [ ] Configura DNS pra apontar pra hospedagem
- [ ] HTTPS (Let's Encrypt automático na Vercel/Railway)
- [ ] Setup do Plausible Analytics ou Umami (sem cookies, leve)
- [ ] Sentry pra erros JS (opcional, free tier)
- [ ] Backup do Postgres antes do go-live
- [ ] Smoke test em produção

**Total estimado: 21–30 horas** de vibe coding, distribuídas em ~1 semana de trabalho focado.

---

## 9. Hospedagem — recomendação

### Opção recomendada: Railway pra tudo

**Por quê:**
- Seu bot já tá pensado pra Railway (mencionado no README)
- Railway aceita Next.js direto (build automático, sem config)
- Banco Postgres gerenciado lá mesmo (mesma rede, latência mínima)
- Redis também
- $5/mês de crédito grátis, depois pay-as-you-go (~$15–25/mês total: app web + bot + DB + Redis)
- Custom domain com SSL automático
- Logs centralizados
- Git push deploy

**Setup:**
1. Conecta repo `var-do-bolao` (bot) — já existe
2. Cria service novo no mesmo projeto: `var-do-bolao-web`
3. Conecta repo do site
4. Variáveis de ambiente:
   - `DATABASE_URL` — mesma do bot (Railway oferece referência cruzada)
   - `BOT_API_URL` — URL interna do bot service
   - `SESSION_SECRET` — gerado com `openssl rand -hex 32`
   - `NEXT_PUBLIC_BOT_WHATSAPP_NUMBER` — pra montar `wa.me`
5. Domínio: Railway gera `*.up.railway.app`. Aponta `vardobolao.com.br` (registro.br) pra ele via CNAME

### Alternativa: Vercel (frontend) + Railway (bot+DB)

- Vercel é melhor pra Next.js puro (edge, ISR, image optimization)
- Mas: precisa expor o bot na internet pra Vercel chamar, ou pagar Vercel Pro pra rede privada
- Custo: Vercel free tier basta + Railway ~$10/mês

Recomendo **Railway pra tudo** pelo MVP. Migra pra Vercel se o site crescer.

### Domínio

Domínio `.br` registrado no [Registro.br](https://registro.br) — R$40/ano. CNAME `www` → Railway. Redirect `vardobolao.com.br` → `www.vardobolao.com.br` configurado no Cloudflare (free tier) ou direto no Railway.

---

## 10. Variáveis de ambiente

### `.env` do site (Next.js)

```ini
# App
NODE_ENV=production
NEXT_PUBLIC_SITE_URL=https://www.vardobolao.com.br
NEXT_PUBLIC_BOT_WHATSAPP_NUMBER=+55 11 97827-7516

# Backend (bot)
BOT_API_URL=http://var-do-bolao.railway.internal:3000  # rede interna Railway
BOT_API_SECRET=<HMAC compartilhado, mesmo do bot>

# Sessão
SESSION_SECRET=<32 bytes hex>
SESSION_COOKIE_NAME=vdb_session
```

### `.env` do bot — adições

```ini
# Web API
WEB_API_ENABLED=true
WEB_ORIGIN=https://www.vardobolao.com.br
WEB_API_SECRET=<HMAC compartilhado, mesmo do site>

# OTP
OTP_VALIDITY_MINUTES=10
OTP_MAX_ATTEMPTS=5
OTP_RATE_LIMIT_PER_MINUTE=1
OTP_RATE_LIMIT_PER_DAY=5
```

---

## 11. Segurança — checklist mínimo

- [ ] HTTPS obrigatório (HSTS header)
- [ ] Cookie httpOnly, Secure, SameSite=Lax
- [ ] CSRF: não usa form-submit direto, todas as actions vão por fetch + cookie + origin check
- [ ] Rate limit em OTP request (Redis bucket)
- [ ] Rate limit em login com senha (5 tentativas / 15min)
- [ ] Senha: bcrypt cost 12, mínimo 8 caracteres, não exige caractere especial (UX) mas mede força no front
- [ ] Email validation client + server (zod)
- [ ] Telefone normalizado pra dígitos antes de qualquer query
- [ ] Logs **mascarando telefone** (ex: `5511****7516`) — alinhado com ISSUE-037 do bot
- [ ] Sem dados sensíveis em URL (sempre POST com body)
- [ ] `Content-Security-Policy` headers no Next config
- [ ] Sem `dangerouslySetInnerHTML` exceto em conteúdo controlado (FAQ markdown, se houver)
- [ ] LGPD: política de privacidade publicada, "Direitos do titular" listados, email de contato pro DPO (pode ser o mesmo `contato@`)

---

## 12. Conteúdo legal — placeholders

### `/politica-privacidade`

Texto template a ser revisado por advogado. Pontos obrigatórios pra LGPD:
- Quais dados são coletados (nome, celular, email, endereço, palpites)
- Finalidade (operação do bolão)
- Base legal (consentimento + execução de contrato)
- Compartilhamento (Evolution API/Meta WhatsApp, hospedagem Railway)
- Direitos do titular (acesso, correção, exclusão)
- Como exercer (email `contato@vardobolao.com.br`)
- Retenção (palpites mantidos pelo período do campeonato + 1 ano)
- Cookies (apenas cookie de sessão técnico, sem trackers de terceiros)

### `/termos`

Pontos:
- Serviço gratuito nesta fase
- Não é casa de apostas — bolão recreativo, sem premiação em dinheiro
- Suspensão por uso abusivo
- Foro

---

## 13. Roteiro pra mandar pro Claude Code

Ordem sugerida de prompts pro Claude Code, um por vez:

### Prompt 1 — Setup
> Criar repo `var-do-bolao-web` ao lado do `var-do-bolao`. Bootstrap Next.js 15 com App Router, TypeScript strict, Tailwind 4. Instalar shadcn/ui e adicionar os componentes: button, input, card, tabs, accordion, dialog, label, separator, toast. Configurar fontes Google (Archivo Black + Inter) via `next/font/google`. Criar `globals.css` com as variáveis de cor da seção 2.1 do PLANO_SITE. Criar estrutura de pastas conforme seção 7.

### Prompt 2 — Landing
> Implementar a landing page em `/` conforme wireframe da seção 6.1 e conteúdo das seções 2 e 8 (Fase 1). Mobile-first. Dark theme com fundo verde-gramado. CTAs em verde-conexão. Sem formulário no Fale Conosco — só mailto. FAQ com as 6 perguntas listadas. Página acessível (WCAG AA). Adicionar OG meta tags.

### Prompt 3 — Backend (no repo do bot)
> No repo `var-do-bolao`, implementar a Fase 2 do PLANO_SITE: criar migration Prisma com `UsuarioWeb` e `OtpToken`, criar pasta `src/web-api/` com as rotas listadas, middleware de sessão HMAC + rate limit. Integrar OTP com Evolution API existente. Atualizar `VAR_DO_BOLAO_ARQUITETURA.md` com seção nova "Web API". Adicionar testes unit cobrindo OTP request/verify, rate limit, criação de UsuarioWeb.

### Prompt 4 — Login + área logada
> No repo `var-do-bolao-web`, implementar Fase 3 do PLANO_SITE: páginas `/login`, `/login/primeiro-acesso`, `/app`, `/app/bolao/[codigo]`, `/app/perfil`. Middleware Next pra proteger `/app/*`. Sessão com iron-session. Empty states e loading skeletons. Botões "Editar pelo WhatsApp" abrem link `wa.me` com mensagem pré-preenchida.

### Prompt 5 — QA + deploy
> Executar checklist da Fase 4 do PLANO_SITE. Subir os 2 services no Railway (bot + web). Configurar variáveis de ambiente (seção 10). Apontar DNS de `vardobolao.com.br` no Registro.br pro Railway. Validar OTP fim-a-fim com WhatsApp real.

---

## 14. Riscos & mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Evolution API offline na hora do OTP | Média | Fallback: mostrar mensagem clara "Tenta de novo em 1 min". Não tem SMS de backup no MVP (custo) |
| Usuário não recebe OTP (número errado) | Alta | Mensagem clara após X segundos: "Não chegou? Verifica se o número tá certo." + botão "Reenviar" (respeitando rate limit) |
| Confusão entre site e bot | Alta | Mensagens consistentes em **todos** os pontos: "Pra palpitar, abre o WhatsApp" com botão direto. Nunca tentar implementar palpite pelo site no MVP |
| LGPD — dados pessoais novos (endereço) | Média | Marcar endereço como opcional? Reavaliar — não tem uso óbvio no MVP. **Sugestão: remover endereço do cadastro inicial**. Pedir só nome + email + senha. Endereço só se precisar pra futuro (envio de prêmio?) |
| Senha fraca | Média | Validador no front (min 8, força visual) + bcrypt cost 12 no back |
| Cookie cross-domain entre Next e Fastify | Alta no setup | Usar mesma origem (Railway proxy reverso) ou subdomínio (`api.vardobolao.com.br`) com cookie domain `.vardobolao.com.br` |

**⚠️ Decisão pendente:** vale revisar se endereço entra mesmo no cadastro inicial. Não tem uso no MVP. Sugiro **remover** e adicionar depois se virar necessário (não pedir dado sem propósito é princípio LGPD).

---

## 15. O que NÃO está coberto neste plano

Coisas que vão precisar de discussão à parte:

- Email transacional (SMTP) — se for adicionar reset de senha por email
- Integração Google Analytics / pixel Facebook — pra rodar campanhas de aquisição
- Push notifications web — provavelmente desnecessário (já tem WhatsApp)
- Compartilhamento de ranking como imagem — feature legal pra viralidade, mas pós-MVP
- Admin panel pra você gerenciar usuários web — usa Prisma Studio ou Beekeeper por enquanto
- Versão PWA (instalar como app) — pós-MVP

---

## 16. Próximos passos imediatos

1. **Você decide:** endereço entra ou sai do cadastro? (recomendo sair)
2. **Você decide:** registra o domínio `vardobolao.com.br` no Registro.br se ainda não tá feito
3. **Você manda o Prompt 1** pro Claude Code, no diretório onde mora o `var-do-bolao` (ele cria o repo irmão)
4. Conforme cada fase fechar, manda o próximo prompt
5. Em paralelo, escreve o texto da política de privacidade e dos termos (template pronto, ajusta + revisa com advogado)

---

*Fim do plano. Atualizar este documento conforme decisões mudarem.*
