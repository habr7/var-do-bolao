# Telegram — Guia de configuração (v3.59.0)

Passo a passo pra colocar o **VAR do Bolão** no ar no Telegram. Tempo total:
~10 minutos. Nada de CNPJ, aprovação ou risco de ban — a Bot API do Telegram
é oficial e feita exatamente pra isso.

> **Arquitetura:** o Telegram foi adicionado só na fronteira de I/O
> (`src/messaging/`). Toda a lógica (palpites, ranking, mata-mata, comandos
> admin) é a mesma dos dois canais. Ver `VAR_DO_BOLAO_ARQUITETURA.md` seção 24.

---

## 1. Criar o bot no BotFather (2 min, no celular ou desktop)

1. No Telegram, abra **@BotFather** (bot oficial, selo azul).
2. Mande `/newbot`.
3. **Nome de exibição** (pode ter espaço/emoji): `VAR do Bolão ⚽`
4. **Username** (tem que terminar em `bot`, sem espaço): ex. `VarDoBolaoBot`
   - Se estiver ocupado, tente variações (`VarDoBolao2026Bot`, etc).
5. O BotFather responde com o **token**, formato:
   `1234567890:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-eM`
   **Guarde — é a senha do bot.** Se vazar: `/revoke` no BotFather gera outro.

Opcional (deixa o bot mais apresentável):
- `/setdescription` → "Bolão da Copa 2026 — palpites, ranking e zoeira. Manda /start!"
- `/setuserpic` → foto do bot.
- `/setcommands` → cole:
  ```
  start - Começar / vincular minha conta
  ```

## 2. Configurar o `.env` no VPS (2 min)

```bash
cd ~/var-do-bolao   # (pasta do projeto no VPS)
nano .env
```

Adicione/edite estas linhas:

```ini
# --- Telegram ---
ENABLE_TELEGRAM=true
TELEGRAM_BOT_TOKEN=1234567890:AAEhBOweik6ad9r_QXMENQjcrGbqCr4K-eM   # o token do passo 1
TELEGRAM_BOT_USERNAME=VarDoBolaoBot                                  # SEM o @
TELEGRAM_MODE=polling                                                # recomendado (zero infra)

# --- WhatsApp: escolha UM cenário ---
# Cenário A (migração — WhatsApp bloqueado): desliga o WhatsApp
ENABLE_WHATSAPP=false
# Cenário B (convivência — os dois no ar): mantém true
# ENABLE_WHATSAPP=true
```

Notas:
- **`TELEGRAM_MODE=polling`** funciona em qualquer VPS, sem domínio público —
  o bot é quem busca as mensagens (1 conexão pro bot inteiro, cobre todas as
  conversas de uma vez; 200 conversas ≠ 200 conexões).
- **Webhook** (opcional, quando tiver domínio HTTPS público apontando pro app):
  ```ini
  TELEGRAM_MODE=webhook
  TELEGRAM_WEBHOOK_SECRET=<gere com: openssl rand -hex 16>
  # e APP_URL precisa ser o endereço público https (ex: https://bot.seudominio.com)
  ```

## 3. Aplicar a migration e subir (3 min)

```bash
# 1. Puxa o código novo
git pull

# 2. Rebuild da imagem (código novo)
docker compose --profile full build app

# 3. Aplica a migration (aditiva — só adiciona colunas, dados intactos)
docker compose --profile full run --rm app npx prisma migrate deploy

# 4. Sobe o app recriando o container (lê o .env novo)
docker compose --profile full up -d app

# 5. Confere o boot
docker compose logs app --tail 20
```

Você deve ver no log:

```
[boot] ⚽ VAR do Bolão v3.59.0 ...
[telegram] 🤖 conectado como @VarDoBolaoBot (id 1234567890)
[telegram] 🔄 long polling iniciado (getUpdates).
```

Se aparecer `❌ [telegram] falha ao iniciar canal` → confira o token no `.env`
(o WhatsApp continua funcionando normalmente nesse caso).

## 4. Testar (2 min)

1. Abra `https://t.me/VarDoBolaoBot` (seu username) e mande `/start`.
2. O bot pede seu **número de WhatsApp** → manda (ex.: `11 97613-5412`).
3. Ele acha seu cadastro: "Achei seu cadastro: *Fulano*. É você?" → `sim`.
4. ✅ Vinculado! Teste: `ranking`, `meus palpites`, `próximos jogos` —
   tudo com seu histórico e pontuação de sempre.
5. **Comandos de dono** (broadcast `#ENVIOPARAVARDOBOLAO#`, `#CLASSIFICADO`,
   `versão`) funcionam no Telegram depois que VOCÊ vincular o seu número
   (a checagem de dono usa o número vinculado).

## 5. Divulgar pros participantes

Manda no grupo (do SEU WhatsApp/Telegram pessoal):

> ⚽ **Bolão de volta!** Agora no Telegram (o WhatsApp do bot deu problema,
> mas NADA foi perdido — pontos e palpites estão todos salvos).
>
> 1. Baixa o Telegram (se não tiver)
> 2. Entra aqui: **https://t.me/VarDoBolaoBot**
> 3. Manda qualquer "oi" e informa teu número de WhatsApp — teus pontos
>    aparecem na hora. 🏆

Cada pessoa que entrar informa o próprio número 1x e recupera tudo sozinha.

---

## Perguntas rápidas

**A pessoa errou o número / caiu em "não achei cadastro"?**
É só mandar o número de novo (o bot re-pergunta). Se criar um cadastro novo
sem querer, o organizador pode ajustar depois via banco (`telegramId` fica na
tabela `usuarios`).

**Dá pra voltar pro WhatsApp depois?**
Sim: `ENABLE_WHATSAPP=true` + `ENABLE_TELEGRAM=false` (ou os dois `true` pra
convivência) e `docker compose --profile full up -d app`. Quem tem vínculo e
`canalPreferido='telegram'` continua recebendo no Telegram quando os dois
estão ligados.

**Trocar polling → webhook?**
`TELEGRAM_MODE=webhook` + `TELEGRAM_WEBHOOK_SECRET` + `APP_URL` público HTTPS,
e recriar o container. O código já está pronto pros dois modos.

**O Telegram bane bot como o WhatsApp?**
Não pelo uso normal. A Bot API é oficial; os limites são de velocidade
(~30 msg/s), e o cliente já respeita `retry_after` automaticamente.
