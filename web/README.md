# 🌐 VAR do Bolão — Web

> Site institucional + área logada (read-only) do VAR do Bolão.
> `www.vardobolao.com.br`

Stack:
- **Next.js 15** (App Router, Server Components, React 19 RC)
- **TypeScript 5** strict
- **Tailwind CSS 4** (com `@theme` tokens no CSS, sem `tailwind.config`)
- **Lucide** ícones
- Fontes Google via `next/font` (Archivo Black + Inter)

> ⚠️ Este pacote vive ao lado do bot (`../`) sem compartilhar `node_modules`,
> `tsconfig` ou processo. Deploy é independente. O bot **não é afetado** por
> mudanças no `web/`.

---

## Quick start

```cmd
cd web
npm install
cp .env.example .env
npm run dev
```

Site sobe em `http://localhost:3001` (porta 3001 pra não colidir com o bot
em 3000).

---

## Estrutura

```
web/
├── README.md                ← este arquivo
├── package.json             ← deps isoladas
├── next.config.mjs          ← security headers, sem powered-by
├── tsconfig.json            ← TS isolado do bot (paths @/*)
├── postcss.config.mjs       ← Tailwind v4 via @tailwindcss/postcss
├── .env.example
├── public/
│   ├── favicon.svg
│   ├── bola-pattern.svg     ← decorativo
│   └── og-image.svg         ← share social 1200x630
└── src/
    ├── app/
    │   ├── layout.tsx           ← metadata raiz, fonts, theme color
    │   ├── globals.css          ← paleta (CSS vars), animations, utilities
    │   ├── page.tsx             ← landing one-pager
    │   ├── not-found.tsx        ← 404 com tom de voz
    │   ├── robots.ts            ← SEO
    │   ├── sitemap.ts           ← SEO
    │   ├── login/page.tsx       ← skeleton (form desabilitado até Fase 2)
    │   ├── app/page.tsx         ← dashboard mock (até Fase 2)
    │   ├── politica-privacidade/page.tsx
    │   └── termos/page.tsx
    ├── components/
    │   ├── landing/
    │   │   ├── Header.tsx         ← fixo, menu mobile drawer
    │   │   ├── Hero.tsx
    │   │   ├── ComoFunciona.tsx   ← 3 passos
    │   │   ├── PorQue.tsx         ← 4 benefícios
    │   │   ├── Copa2026.tsx       ← banner com contagem regressiva
    │   │   ├── FAQ.tsx            ← accordion
    │   │   ├── FaleConosco.tsx
    │   │   ├── Footer.tsx
    │   │   └── PageShell.tsx      ← layout simples pra páginas internas
    │   └── ui/
    │       ├── Button.tsx         ← variants primary/secondary/ghost
    │       ├── Container.tsx
    │       └── Logo.tsx           ← símbolo + wordmark
    └── lib/
        ├── cn.ts                  ← clsx + tailwind-merge
        └── constants.ts           ← SITE_URL, waLink(msg), COPA_2026_START
```

---

## Variáveis de ambiente

| Variável | Obrigatório | Default | Descrição |
|----------|-------------|---------|-----------|
| `NEXT_PUBLIC_SITE_URL` | sim | `http://localhost:3001` | URL canônica (metadata, sitemap) |
| `NEXT_PUBLIC_BOT_WHATSAPP_NUMBER` | sim | `5511978277516` | Número do bot. Só dígitos. Usado nos `wa.me` |
| `BOT_API_URL` | sim | `http://localhost:3000` | URL do Fastify do bot. O Next faz proxy SSR — o navegador nunca bate direto. |

Pra que o login/dashboard funcione, o bot **precisa** estar com `WEB_API_ENABLED=true`
no `.env` dele. Sem isso o bot continua só com o webhook do WhatsApp (comportamento default).

---

## Identidade visual

Tokens em `src/app/globals.css` (`@theme`):

| Token | Hex | Uso |
|-------|-----|-----|
| `--color-verde-conexao` | `#25D366` | CTAs primários, badges de sucesso, links |
| `--color-verde-gramado` | `#1B5E20` | base do fundo |
| `--color-verde-gramado-dark` | `#0F3814` | meio do gradiente de fundo |
| `--color-verde-gramado-deep` | `#082008` | fundo profundo, footer |
| `--color-amarelo-arbitro` | `#FFEA00` | alertas, "falta palpitar", contagem |
| `--color-cinza-card` | `#18241B` | cards |
| `--color-branco-puro` | `#FFFFFF` | textos principais |

Fontes:
- **Display:** `Archivo Black` — títulos, logo, números do countdown
- **Corpo:** `Inter` — UI e textos longos

Diretriz central: **fundo dark gramado por padrão**. Verde-conexão só nos
CTAs principais (pra preservar peso visual). Amarelo árbitro só em
alertas/badges.

---

## Scripts

```cmd
npm run dev         :: dev server porta 3001
npm run build       :: build de produção
npm run start       :: start em produção (depois do build)
npm run lint        :: ESLint via next lint
npm run typecheck   :: tsc --noEmit (não emite)
```

---

## Roadmap (alinhado com PLANO_SITE_VAR_DO_BOLAO.md)

- ✅ **Fase 1** — Landing one-pager + páginas legais + skeleton de login/app
- ✅ **Fase 2** — Backend OTP + sessão HMAC (no bot, em `src/web-api/`)
- ✅ **Fase 3** — Login OTP real (2 passos) + first-access (com `dataNascimento` opcional) +
  login por senha + dashboard real + bolão detalhe com tabs (ranking/palpites/jogos) + perfil + logout
- ⏳ **Fase 4** — QA, Lighthouse audit, WCAG AA, deploy Railway, DNS

### Estrutura do fluxo de auth

1. **`/login` (modo OTP)** — usuário digita celular → POST `/api/auth/otp/request` no bot
   → bot manda código de 6 dígitos via Evolution → usuário cola código → POST `/api/auth/otp/verify`
   → se `UsuarioWeb` existe, cookie HMAC `vdb_session` é setado e redireciona pra `/app`. Se não
   existe, cookie temporário `vdb_pre_cadastro` (10 min) e redireciona pra `/login/primeiro-acesso`.
2. **`/login/primeiro-acesso`** — formulário com nome (pré-preenchido do WhatsApp), email,
   data de nascimento (opcional), senha. POST `/api/auth/first-access` cria `UsuarioWeb`,
   troca o pre-cookie por sessão definitiva.
3. **`/login` (modo senha)** — alternativa após cadastro: email + senha → POST `/api/auth/login`.
4. **`/app/*`** — protegido por `middleware.ts` (checa presença do cookie). Validação
   criptográfica do HMAC acontece no Fastify quando o Next faz fetch SSR (`lib/api.ts`).
5. **`/app/perfil` → "Sair"** — server action `logout()` chama POST `/api/auth/logout` e
   limpa o cookie local.

### LGPD — data de nascimento

Campo opcional. Não é dado sensível pela LGPD (art. 5º, II). Finalidades documentadas
na [Política de Privacidade](/politica-privacidade) e no Termo: validação de maioridade
e cumprimento no aniversário. Usuário pode editar/apagar a qualquer momento em
`/app/perfil`.

---

## Por que está dentro do mesmo repo

O plano original sugeria repo separado. Foi consolidado num subfolder
`web/` por dois motivos práticos:

1. **Mesmo deploy/CI compartilhado** — facilita pra duas pessoas atualizar.
2. **Mesmo schema Prisma** — quando a Fase 2 chegar, o web vai querer
   importar tipos do `@prisma/client` do bot. Subfolder evita publicar
   pacote ou duplicar schema.

O isolamento técnico é mantido: `web/` tem seu próprio `package.json`,
`tsconfig.json`, e os hooks do Claude (`.claude/hooks/`) só rodam typecheck
do bot (`src/`).
