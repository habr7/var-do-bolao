# Comandos do VAR do Bolão

> O bot entende **linguagem natural em PT-BR coloquial**. Esta lista mostra
> as frases mais comuns; variantes (com gírias, erros de digitação,
> abreviações) caem na camada LLM. Negrito `*xxx*` mostra como você
> normalmente digita.

---

## Como conversar com o bot

Toda interação é **em DM** (conversa privada). Adicione o número do bot
como contato e fale com ele direto.

**Exemplos de saudação:**
```
oi
salve bot
e ai
bom dia
```
→ Bot responde com menu de boas-vindas e mostra o que sabe fazer.

---

## Criar e administrar bolão (admin)

### Criar bolão novo
```
criar bolão
quero criar um bolão
abrir bolão novo
montar um bolão
```
→ Bot inicia FSM em 2 passos:
1. "Qual o nome?" → você manda (3-60 chars)
2. "Defina uma senha" → você manda (≥6 chars, legado — não é mais cobrada pra entrar via ID)

→ Bot devolve **ID curto** (ex: `#K3MZ8P`) + **link wa.me clicável** pra
encaminhar pros convidados.

> ⚠️ PIX está **desativado** nesta fase — bolão é gratuito.

### Pegar o link de convite (depois de criado)
```
como convido
manda o convite
pegar o ID do bolão
quero chamar gente pro bolão
```
→ Bot manda o link wa.me pronto pra encaminhar.

### Status das rodadas (admin)
```
abrir rodada
começar bolão
como inicio rodada
```
→ Bot mostra se a rodada está aberta/fechada/finalizada.

### Excluir bolão (admin) — ISSUE-006
```
excluir bolão
deletar meu bolão
encerrar bolão
apagar bolão
```
→ Bot pede confirmação **textual** (`confirmar`) — sim/yes não basta. Notifica
todos os participantes ao excluir. Soft delete (`status = FINALIZADO`).
> ⚠️ Bolão encerrado **continua acessível em consultas**: `ranking` mostra
> resultado final, `meus palpites` mostra histórico, `meus bolões` lista
> em seção separada "🏁 Bolões encerrados". As **ações** (palpitar,
> convidar, sair, abrir rodada) somem.

---

## Entrar em bolão (participante)

### Via link wa.me (caminho mais rápido)
1. Admin te mandou um link → você clica
2. WhatsApp abre conversa com bot já com mensagem pronta
3. Você manda → bot cria solicitação e avisa admin

### Via ID curto
```
#K3MZ8P
quero entrar no bolão #K3MZ8P
```
→ Bot identifica o bolão e cria solicitação direto (sem pedir senha — ISSUE-004).

### Via nome do bolão
```
entrar em bolão
quero participar
me coloca num bolão
```
→ Bot pergunta o nome. Você manda. Comportamento:
- **1 match exato (com normalização de acento)** → cria solicitação
- **>1 match** → lista numerada pra você escolher (ISSUE-003)
- **0 matches** → conta tentativa (até 3 antes de voltar ao menu — ISSUE-002)

### "Qual a senha?" — ISSUE-005
```
qual a senha?
esqueci a senha
me passa a senha
```
→ Handler dedicado explica que **bolão usa ID** (`#ABCD12`), não senha.

---

## Palpites

### Palpite inline (mais comum)
Manda direto, em qualquer formato:
```
Brasil 2x1 Marrocos
Brasil 2 a 1 Marrocos
Brasil 2-1 Marrocos
Brasil 2 por 1 Marrocos
Brasil dois a um Marrocos       (extenso)
México 1 x 2 África do Sul       (multi-palavra)
```

### Multi-palpite (várias linhas)
```
Brasil 2x1 Marrocos
França 1x0 Argentina
Alemanha 3x2 Espanha
```
→ Bot:
1. Pergunta qual bolão (se >1 com rodada aberta)
2. Mostra preview de todos os palpites parseados
3. Pede confirmação: `sim`, `não` ou `refazer`

### Multi-palpite em linguagem natural (LLM)
```
Brasil perde do Marrocos de 1 a 0
França ganha por 2 a 1 da Argentina
empate em 2 entre Alemanha e Espanha
```
→ LLM extrator entende. Usuário sempre confirma antes de registrar.

### Palpite único aplicado em vários bolões (ISSUE-015)

Quando o mesmo jogo está aberto em N bolões em que você participa
(caso típico da Copa), mandar `Brasil 2x1 Marrocos` agora abre um
preview com a lista dos N bolões onde o palpite vai cair, e pede
confirmação:

```
📝 Vou registrar o palpite:

*Brasil 2 × 1 Marrocos*

Aplicado em *3* bolões:
• Bolão da Jeni
• Bolão da Firma
• Bolão da Família

Confirma? _(responda *sim*, *não* ou *refazer*)_
```

Bug Jeni 17/05: antes registrava direto sem preview.

### Iniciar fluxo de palpite (quando não sabe o que falar)
```
quero dar palpites
vou palpitar
bora dar uns palpites
deixa eu palpitar
```
→ Bot mostra próximos jogos abertos (intent `PROXIMOS_JOGOS`).

### Ver meus palpites já dados
```
meus palpites
o que palpitei?
quais palpites dei?
```
→ Bot mostra histórico (após escolha de bolão se >1).

### "palpites" sozinho (ambíguo)
```
palpites
```
→ Bot pergunta entre 3 opções numeradas:
1. Ver palpites já dados
2. Fazer novos palpites
3. Ver regras

---

## Consultas

### Ranking
```
ranking
tabela
quem ta na frente
classificação
ranking Firma FC    (com nome do bolão)
quero ver o ranking
ver o ranking
me mostra a tabela
qual a classificação
```
→ Aceita também frases naturais ("quero ver o ranking", "ver o ranking",
"me mostra a tabela") — o bot extrai só o nome do bolão real depois de
remover as frases-gatilho. Se sobrar vazio (caso geral), pergunta qual
bolão se houver >1.

→ Bolões **encerrados** (FINALIZADO) também aparecem aqui — o bot promete
"palpites e ranking ficam guardados" no encerramento, então ranking final
fica acessível pra consulta. Na lista numerada, encerrados aparecem
marcados com `🏁`. O envio do ranking final adiciona o sufixo
"🏁 Este bolão foi encerrado — ranking final guardado pra consulta."

### Meus pontos
```
meus pontos
quantos pontos eu fiz?
minha pontuação
em que posição eu to?
```

### Próximos jogos
```
próximos jogos
quais jogos faltam?
o que ainda nao palpitei?
lista de jogos
mostra os jogos
```
→ Mostra um lote de até **10 jogos cronológicos** abertos da rodada, com ✅/⚪
de palpite + rodapé honesto: *"Mostrando jogos 1–10 de 72 da rodada. Palpites
seus neste lote: 4/10. Faltam 68 palpite(s) no bolão. Manda **mais jogos**
pra ver os próximos 10."* (v3.5.0). Reseta paginação a cada chamada.

Só lista bolões **ATIVOS**. Se o usuário só tem bolões encerrados, o bot
detecta o caso e responde com mensagem **auto-diagnóstica** ("Você tem N
bolão(ões) encerrado(s). Manda *ranking* pra ver o resultado final ou
*meus palpites* pra ver o histórico.") — em vez do genérico "não participa
de nenhum bolão" que contradizia a notificação anterior do bot.

### Mais jogos (paginação — v3.5.0)
```
mais jogos
mais palpites
próximos 10
outros jogos
tem mais jogos?
quero ver mais
continuar palpitando
```
→ Avança o ponteiro em +10 e mostra o próximo lote da rodada. Cada bolão tem
seu próprio offset (Redis, TTL 60min). Quando estoura o total, volta pro topo
com aviso *"Você já tinha visto até o fim — voltei pro topo da lista pra
continuar."*

**Cutucada automática**: depois que o usuário palpita em todos os jogos do
lote visível, o bot manda follow-up oferecendo o próximo lote (idempotente:
1x por bolão a cada 30min).

💡 **Multi-palpite**: a janela aberta após "próximos jogos" aceita várias
linhas / vírgula numa mensagem só. Ex: *"Brasil 2x1 Marrocos, México 1x1
África do Sul"*.

### Jogos hoje
```
jogos hoje
agenda
tem jogo hoje?
```

### Meus bolões
```
meus bolões
onde participo
em qual bolão to?
```
→ Mostra **duas seções**:
- 🏆 *Seus bolões ativos:* — lista com 👑 admin + ⭐ padrão (se setado) + `#ID`
- 🏁 *Bolões encerrados:* — bolões já finalizados (soft-delete via "excluir bolão")
  com dica "Manda *ranking* pra ver o resultado final."

Se houver `>1` ativo e nenhum padrão, dica "Pra definir um bolão como padrão..."
aparece no fim.

### Meus palpites (com histórico)

Acessível via `meus palpites` (intent `MEU_PALPITE`). Aceita bolões
**encerrados** também — palpites passados ficam guardados pra consulta.
Na lista numerada de múltiplos bolões, encerrados aparecem com `🏁`.

### Quem participa
```
quem participa
quem ta no bolão
lista de participantes
```

### Regras de pontuação
```
regras
como pontua
como funciona a pontuação
quantos pontos por placar exato
```
Tabela: **10** placar exato · **7** resultado + 1 placar parcial · **5** só resultado · **3** só 1 placar parcial · **0** errou tudo.

---

## Sair do bolão

```
sair do bolão
quero sair
me remove
não quero mais jogar
```
→ Bot pede confirmação `sim/não`. Palpites passados ficam no histórico,
mas a participação é removida (some do ranking).

---

## Comandos de admin (aprovação)

Quando alguém pede pra entrar no seu bolão, você (admin) recebe DM:

```
🔔 Fulano quer entrar no bolão X. Aprovar?
```

Pode responder em linguagem natural:

| O que mandar | Efeito |
|--------------|--------|
| `aprovado`, `ok`, `sim`, `pode` | Aprova (se há 1 pendente) ou lista pra escolher (>1) |
| `aprovado Fulano` | Aprova nomeado |
| `aprovar todos` | Confirma + aprova em lote |
| `recusar Fulano` | Pede confirmação + recusa nomeado |
| `recusar todos` | Confirma + recusa em lote |
| `!aprovar Fulano` | Forma explícita (sempre funciona) |
| `!recusar Fulano` | Forma explícita |

### Ver pendentes
```
pendentes
tem pedido pra aprovar?
aprovações pendentes
!pendentes
```

---

## Outros

### Menu / Ajuda
```
menu
ajuda
help
?
```

### Cancelar (sair de qualquer fluxo)
```
cancelar
sair
esquece
deixa pra lá
chega
```
→ Volta pro IDLE + mostra menu.

---

## Convenções de resposta numérica

Sempre que o bot mostra uma lista numerada:
```
1. *Bolão da Firma* (`#K3MZ8P`)
2. *Bolão da Família*
3. *Copa dos Amigos*
```
Você pode responder com:
- **Só o número**: `1`, `2`, `3`
- **Nome (fuzzy)**: `firma`, `família`, `da firma`
- **Código**: `#K3MZ8P` ou `K3MZ8P`

---

## Perguntas frequentes — handlers dedicados (sem custo LLM)

```
o que é esse bot?
pra que serve?
sobre o var
```
→ Pitch curto do produto (ISSUE-009).

```
quanto custa?  •  é grátis?  •  tem que pagar?
```
→ "🆓 É grátis nesta fase" (ISSUE-010).

```
como dou palpite?  •  qual o formato?  •  não sei palpitar
```
→ Explica formato com exemplos (ISSUE-017).

```
quando começa?  •  quando termina?  •  quando abre rodada?
```
→ Data da próxima rodada (usa bolão padrão) (ISSUE-018).

```
obrigada  •  obrigado  •  valeu  •  vlw  •  brigado  •  brigadão
thanks  •  thx  •  tmj  •  tamo junto  •  agradecido
```
→ `AGRADECIMENTO` — cordialidade curta amigável, não reabre o menu. Texto
randomizado pra não ficar robótico ("Magina, *Fulano*! Tamo junto.
Precisando, só chamar.").

```
tchau  •  até logo  •  até mais  •  até amanhã  •  falou  •  flw
fui  •  abraço  •  abs  •  bjs  •  beijos
```
→ `DESPEDIDA` — resposta curta de saída ("🤙 Falou, *Fulano*! Tamo junto.").

```
tudo bem?  •  tudo bom?  •  blz?  •  td certo?  •  como vai?
como ta?  •  suave?  •  firmeza?
```
→ `CUMPRIMENTO_CASUAL` — bot responde + sugere ações leves ("De boa,
*Fulano*! 🤙 Manda *ranking*, *meus pontos* ou *próximos jogos*").
> ⚠️ Diferença do `AGRADECIMENTO`/`DESPEDIDA`: o `?` é importante.
> "blz?" → CUMPRIMENTO. "blz" sem `?` → CONCORDANCIA_CASUAL.

```
ok  •  beleza  •  blz  •  show  •  massa  •  legal  •  fechou
perfeito  •  top  •  combinado  •  tranquilo  •  entendi  •  saquei  •  boa
```
→ `CONCORDANCIA_CASUAL` — acknowledgement curto sem reabrir menu
("👍 Show! Tô por aqui.").
> ⚠️ Em fluxos de confirmação (`CONFIRMANDO_*`) essas mesmas palavras viram
> SIM via `interpretarSimNao`. Esse handler só dispara em IDLE.

```
kkkk  •  kk  •  rsrs  •  hahaha  •  huehue  •  😂  •  🤣
```
→ `RISADA` — resposta minimalista (emoji curto ou "kkkkk").

```
quais próximos jogos da Inglaterra?  •  em que grupo o Brasil está?
quando começa a Copa?  •  quais cidades vai ser?
como é o grupo C?  •  qual o estádio da final?
```
→ `PERGUNTA_GERAL_FUTEBOL` — perguntas sobre **Copa do Mundo 2026**. O bot
passa pelo **grounding determinístico** (`src/llm/copa.ground.ts`): detecta
o que foi perguntado (time, grupo, data, sede), monta um bloco
`[FATOS VERIFICADOS]` a partir do JSON oficial em `src/data/copa-2026/`
(fonte: openfootball/worldcup.json) e injeta na LLM antes de responder.
> ✅ **Não alucina mais**: o prompt proíbe afirmar fatos da Copa 2026 que
> não estejam no bloco verificado. Atualizar fonte com `npm run sync:copa-2026`.

**Fora de escopo** (Libertadores, Brasileirão, Champions, jogadores
específicos, copas antigas, jogos de clube): o bot recusa **antes da LLM**
com mensagem cordial e redireciona pra `meus bolões` / `ranking`. Exemplo:

```
quem ganhou a Libertadores 2025?    →  recusa cordial + redirect
jogo do Flamengo hoje?              →  recusa cordial + redirect
o Vinicius Jr vai jogar?            →  recusa cordial + redirect
copa de 94?                         →  recusa cordial + redirect
```

> ⚠️ O bot **nunca inventa** dados específicos do user (palpites/ranking/
> pontos/IDs). Pra dados do **seu bolão**, manda `ranking`, `meus pontos`,
> `meus palpites`.

---

## Editar e apagar palpite

### Editar (substituir placar)
```
corrigir palpite
mudar palpite
errei o palpite
```
→ Bot pede o palpite novo. Só funciona se a rodada ainda estiver aberta.
Usa bolão padrão se setado.

### Apagar
```
apagar meu palpite
desfazer palpite
remover palpite
```
→ Bot lista seus palpites de jogos ainda não iniciados, você escolhe,
confirma. Só pra rodada aberta.

### Placar absurdo (>15 gols)
Quando palpite tem placar incomum (16+ num lado ou total >20), bot pede
confirmação explícita antes de registrar.

### Time errado pro jogo
Mandar `Brasil 2x1 França` quando o jogo é `Brasil x Marrocos` → bot
responde com a lista de jogos abertos e pergunta se quis dizer outro.

---

## Bolão padrão (multi-bolão)

```
bolão padrão
definir bolão padrão
meu bolão principal
```
→ Bot lista seus bolões. Escolhido, futuros comandos como `ranking`,
`meus pontos`, `quando começa`, `editar palpite`, etc. pulam a pergunta
"qual bolão?".

**Auto-aplicar palpite em todos os bolões:** quando o mesmo jogo está
aberto em vários bolões em que você participa (caso típico da Copa),
mandar `Brasil 2x1 Marrocos` registra em **todos** automaticamente. Bot
responde com lista de bolões onde aplicou.

---

## Admin avançado

### Renomear bolão
```
renomear bolão
mudar nome do bolão
trocar nome do bolão
```
→ Bot: escolha bolão → manda nome novo → confirma sim/não → notifica
participantes.

### Remover participante
```
remover Fulano
tirar Fulano do bolão
expulsar
```
→ Bot detecta o nome (ou pergunta), confirma, remove, avisa o removido.

---

## Resumo cruzado entre bolões (ISSUE-023)

```
como to indo nos bolões
meu desempenho geral
em quantos bolões to em primeiro?
resumo dos meus bolões
```
→ Lista cada bolão com posição (🥇🥈🥉/Nº) + pontos.

---

## O que NÃO existe (ainda)

- ~~Transferir admin~~ (ISSUE-027 — pendente)
- ~~Mudar nome de exibição~~ (ISSUE-025 — pendente)
- ~~Cutucar participantes~~ (ISSUE-024 — pendente)
- ~~Notificações on/off~~ (ISSUE-029 — pendente)
- ~~Histórico de palpites de outros pós-jogo~~ (ISSUE-026 — pendente)
- ~~Undo do último palpite~~ (ISSUE-032 — pendente)
- ~~Comando "onde estou / o que tava fazendo"~~ (ISSUE-031 — pendente)
- Placar ao vivo / áudio / vídeo

Ver `BUGS_E_CENARIOS_VAR_DO_BOLAO.md` (raiz) para roadmap completo.
