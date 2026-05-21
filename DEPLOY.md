# 🚀 Deploy & Operação — VAR do Bolão (Produção)

> Runbook de operação do bot em produção. Servidor: **VPS Contabo (Ubuntu 24.04)**,
> stack rodando via **Docker Compose** com perfil `full` (todos os containers,
> incluindo o `app`). Todos os comandos abaixo rodam **dentro do VPS** (via SSH),
> a menos que indicado como "(no seu PC)".

---

## 0. Conceito — onde cada comando roda

```
PowerShell / Terminal (seu PC)  →  SSH  →  Terminal do VPS  →  comandos Docker
        (só conecta)                       (é AQUI que o deploy acontece)
```

O PowerShell **não atualiza a produção**. Ele só te conecta. Os comandos de
build/restart rodam no VPS.

```bash
# (no seu PC) — conectar ao servidor
ssh humberto@SEU_IP
# (ou, se trocou a porta SSH:)
ssh -p 2222 humberto@SEU_IP
```

A partir daí você está dentro do VPS. Vá pro projeto:

```bash
cd ~/var-do-bolao
```

---

## 1. Atualização padrão (deploy de código novo)

**Este é o fluxo mais comum.** Use sempre que tiver feito mudanças em código
(`src/`), `Dockerfile` ou `docker-compose.yml`.

### Comando único (90% dos casos)

```bash
cd ~/var-do-bolao && git pull && docker compose --profile full up -d --build
```

### Passo a passo explicado

```bash
# 1. Garantir que está no projeto
cd ~/var-do-bolao

# 2. Puxar o código novo do GitHub
git pull

# 3. Conferir o que mudou (decide se precisa de migration — ver seção 2)
git log -1 --stat

# 4. Rebuild da imagem + sobe (recria SÓ o que mudou; banco/redis ficam no ar)
docker compose --profile full up -d --build

# 5. Conferir que subiu saudável
docker compose ps

# 6. Acompanhar logs do bot (Ctrl+C sai do log, NÃO mata o container)
docker compose logs -f app
```

### Por que `--build` é obrigatório

O `Dockerfile` compila TypeScript → JavaScript **no momento do build**. Sem
`--build`, o container continua rodando o código **antigo** mesmo depois do
`git pull`. O `git pull` só atualiza os arquivos no host; o container roda uma
**imagem** que precisa ser reconstruída.

### Por que `--profile full`

O serviço `app` (o bot) está marcado com `profiles: ["full"]` no
`docker-compose.yml`. Sem a flag `--profile full`, o Docker Compose ignora o
container `app` e mexe só em postgres/redis/evolution. **Sempre** inclua a flag
em produção.

---

## 2. Quando a atualização mexe no banco (migrations Prisma)

Depois do `git pull`, cheque o que mudou:

```bash
git log -1 --stat
```

**Se aparecer algo em `prisma/migrations/` ou `prisma/schema.prisma`**, rode a
migration DEPOIS do build:

```bash
docker compose exec app npx prisma migrate deploy
```

Saída esperada: `All migrations have been successfully applied` (ou
`No pending migrations`).

Se **não** mexeu em `prisma/`, pule este passo.

> ⚠️ Em produção use sempre `migrate deploy` (aplica migrations existentes).
> **Nunca** use `migrate dev` em produção — ele pode tentar resetar/gerar
> migrations e mexer no schema de forma destrutiva.

---

## 3. Quando a atualização só mexe no `.env`

O `.env` **não vem no `git pull`** (está no `.gitignore`). Mudanças de variável
de ambiente são feitas manualmente no VPS:

```bash
cd ~/var-do-bolao
nano .env
# edita, salva com Ctrl+O → Enter → Ctrl+X
```

Aí **não precisa rebuildar** — só reiniciar o container que usa a variável:

```bash
# só o bot
docker compose --profile full restart app

# bot + evolution (ex: mudou EVOLUTION_*)
docker compose --profile full restart app evolution
```

> Lembrete de variáveis Docker-internas (comunicação entre containers usa o
> **nome do serviço**, não `localhost`):
> - `DATABASE_URL` → host `postgres:5432`
> - `REDIS_URL` → host `redis:6379`
> - `EVOLUTION_API_URL` → `http://evolution:8080`
> - `WEBHOOK_GLOBAL_URL` → `http://app:3000/webhook/whatsapp`
> - `EVOLUTION_SERVER_URL` → URL **pública** (ex: `https://evolution.SEUDOMINIO`)

---

## 4. Checklist: o que rodar conforme o que mudou

| O que mudou no commit | O que rodar |
|---|---|
| Código em `src/` | `up -d --build` |
| `Dockerfile` | `up -d --build` (o `--build` já pega) |
| `docker-compose.yml` | `up -d --build` (recria serviços alterados) |
| `prisma/schema.prisma` ou `prisma/migrations/` | `up -d --build` **+** `prisma migrate deploy` |
| Só `.env` (variável nova/alterada) | editar `.env` + `restart app` (sem build) |
| Variável de ambiente nova que o código espera | adicionar no `.env` **antes** de subir, senão o container reinicia em loop |

---

## 5. Verificação pós-deploy

```bash
# 1. Todos os containers de pé?
docker compose ps
# Esperado: postgres, redis, evolution, app — todos "Up"

# 2. Bot respondendo localmente?
curl http://localhost:3000/health
# Esperado: JSON de status ok

# 3. Bot respondendo via HTTPS público?
curl https://bot.SEUDOMINIO/health

# 4. Logs sem erro?
docker compose logs --tail=50 app
```

**Teste final real:** mande um `oi` pro bot no WhatsApp e confirme o
comportamento novo.

---

## 6. Comandos de operação do dia a dia

| Tarefa | Comando |
|---|---|
| Conectar ao servidor (no seu PC) | `ssh humberto@SEU_IP` |
| Ir pro projeto | `cd ~/var-do-bolao` |
| Ver containers | `docker compose ps` |
| Logs do bot (seguir) | `docker compose logs -f app` |
| Logs de todos | `docker compose logs -f` |
| Últimas 50 linhas do bot | `docker compose logs --tail=50 app` |
| **Deploy de código novo** | `git pull && docker compose --profile full up -d --build` |
| Reiniciar só o bot | `docker compose --profile full restart app` |
| Reiniciar tudo | `docker compose --profile full restart` |
| Rodar migrations | `docker compose exec app npx prisma migrate deploy` |
| Abrir shell dentro do container | `docker compose exec app sh` |
| Uso de CPU/RAM | `htop` (sai com `q`) |
| Espaço em disco | `df -h` |
| Limpar imagens Docker órfãs | `docker system prune -a` |

> **Parar tudo:** `docker compose --profile full down`
> (derruba os containers mas **mantém** os dados nos volumes).

---

## 7. ⚠️ NUNCA em atualização de rotina: `down -v`

```bash
# ❌ PERIGO — apaga TODOS os volumes (banco, redis, sessão WhatsApp pareada)
docker compose --profile full down -v
```

O `-v` **destrói os dados**. Só use em **reset total** de ambiente vazio (ex:
primeiro deploy quando o banco ainda não tinha nada, ou pra recriar do zero o
volume do Postgres quando se troca a `POSTGRES_PASSWORD`). Em produção com
usuários reais, isso apaga tudo, **inclusive o pareamento do WhatsApp** (você
teria que escanear o QR de novo).

---

## 8. Rodar scripts (`scripts/*.ts`) em produção

A imagem de produção (ver `Dockerfile`) copia só `dist/` (JS compilado),
`prisma/` e `assets/` — **a pasta `scripts/` não vai pra imagem**. Logo,
`docker compose exec app npx tsx scripts/X.ts` falha com
`Cannot find module`.

Três formas de rodar um script pontual:

### Opção A — copiar o script pro container na hora (ad-hoc)

```bash
docker cp scripts/seed-fifa-2026.ts var-do-bolao-app-1:/app/scripts/seed-fifa-2026.ts
docker compose exec app npx tsx scripts/seed-fifa-2026.ts <args>
```

### Opção B — container one-shot com a pasta montada (mais limpo)

```bash
docker compose run --rm \
  -v "$(pwd)/scripts:/app/scripts" \
  app npx tsx scripts/seed-fifa-2026.ts <args>
```

### Opção C — incluir `scripts/` na imagem (definitivo)

Adicionar no `Dockerfile` (stage `runner`):

```dockerfile
COPY --from=builder /app/dist ./dist
COPY scripts ./scripts        # ← adicionar
COPY prisma ./prisma
```

Depois `docker compose --profile full up -d --build`. Recomendado se você roda
scripts com frequência.

---

## 9. Rollback (se um deploy quebrou)

```bash
cd ~/var-do-bolao

# 1. Ver o histórico de commits
git log --oneline -10

# 2. Voltar pro commit anterior que funcionava
git checkout <hash-do-commit-bom>

# 3. Rebuild com o código antigo
docker compose --profile full up -d --build

# 4. Quando resolver e quiser voltar pro topo
git checkout main
```

> 💡 Antes de deploys grandes, tire um **snapshot na Contabo** (painel →
> Snapshots). Se algo der muito errado, restaura o servidor inteiro em minutos.

---

## 10. Problemas comuns

### Container `app` ou `evolution` em `Restarting`

Quase sempre `.env`. Veja o erro:

```bash
docker compose logs --tail=50 app
```

- `PrismaClientInitializationError ... invalid port number` →
  caractere especial na senha dentro de `DATABASE_URL` (ex: `+ / = @` gerados por
  `openssl rand -base64`). **Use `openssl rand -hex 24`** pra gerar senhas que
  vão em connection string, ou URL-encode os caracteres especiais.
- `Cannot connect to database` → senha divergente entre `.env` e o volume do
  Postgres (a senha do Postgres só é gravada na **primeira** criação do volume).
- `<VARIAVEL> is required` → variável faltando no `.env`.

### Webhook não chega no bot

```bash
curl -k https://bot.SEUDOMINIO/health
curl -k https://bot.SEUDOMINIO/webhook/whatsapp
```

Confirme que `WEBHOOK_GLOBAL_URL=http://app:3000/webhook/whatsapp` (nome do
serviço Docker, não IP/localhost).

### Evolution não pareia / loop close-connecting

Versão do WhatsApp Web do Baileys defasada. Atualize
`CONFIG_SESSION_PHONE_VERSION` no `docker-compose.yml` e recrie:

```bash
docker compose --profile full up -d --build evolution
```

### Disco cheio

```bash
df -h
docker system prune -a    # remove imagens/layers órfãos
```

---

## 11. Notas de infraestrutura (resumo do ambiente atual)

- **Servidor:** Contabo Cloud VPS (Ubuntu 24.04), Docker + Docker Compose
- **Proxy reverso:** Nginx, com HTTPS via Let's Encrypt (Certbot)
- **Domínios:**
  - `bot.SEUDOMINIO` → bot Node.js (porta interna 3000)
  - `evolution.SEUDOMINIO` → Evolution API + Manager (porta interna 8080)
- **Containers (perfil `full`):** `postgres`, `redis`, `evolution`, `app`
- **Bancos no Postgres:** `varbolao` (bot) + `evolution` (sessão WhatsApp)
- **Backups:** dump diário via cron (`~/backup-db.sh`), snapshot Contabo manual
- **Firewall (UFW):** só 22 (ou 2222), 80, 443 abertas. Portas internas
  (3000/5432/6379/8080) **não** expostas à internet.

> Detalhes de arquitetura da aplicação: ver
> [VAR_DO_BOLAO_ARQUITETURA.md](VAR_DO_BOLAO_ARQUITETURA.md).
