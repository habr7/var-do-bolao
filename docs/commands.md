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
→ Bot pede só **1 passo** (v3.28.0 — passo de senha removido):
1. "Qual o nome?" → você manda (3-60 chars) → bolão criado na hora.

_(A entrada é 100% por ID curto; não há mais senha. Sessões antigas presas no passo de senha são recuperadas criando o bolão direto.)_

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

### Palpite incompleto — o bot guia (v3.37.0 / v3.40.0)
O bot não inventa palpite faltando dado — ele pede o que falta:
- `Espanha 4x1` (só um time) → "Faltou o adversário — qual time o Espanha enfrentou?"
- `3x0` (só o placar, sem time) → "Vi um placar, mas faltou dizer de qual jogo! Manda: `Time 3x0 Time`"
- Lista de confrontos **sem placar** (`Noruega x França` / `Senegal x Iraque` / …) → "Vi que você listou jogos, mas faltou o placar de cada um! Manda: `Noruega 2x1 França`"

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
→ **v3.27.0**: pedido genérico ("próximos jogos") primeiro **pergunta o
filtro**: *"1 - Só os que faltam (jogos que você ainda não palpitou) /
2 - Todos os próximos jogos da Copa"* (estado `ESCOLHENDO_FILTRO_PROXIMOS_JOGOS`).
Frases que já indicam pendência ("o que falta palpitar?", "quero dar
palpites", "jogos pendentes") **pulam a pergunta** e vão direto pros
pendentes. Responder a pergunta com um palpite inline ("Brasil 2x1
Marrocos") escapa pro fluxo de palpite normalmente.

→ Lista um lote de até **10 jogos cronológicos** abertos da rodada, com ✅/⚪
de palpite + rodapé honesto: *"Mostrando jogos 1–10 de 72 da rodada. Palpites
seus neste lote: 4/10. Faltam 68 palpite(s) no bolão. Manda **mais jogos**
pra ver os próximos 10."* (v3.5.0). No modo "só os que faltam", o rodapé
conta pendentes: *"Mostrando 1–10 de 23 jogo(s) que ainda faltam seu
palpite"*. Reseta paginação a cada chamada.

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
continuar."* **v3.27.0**: continua no **mesmo filtro** escolhido em
"próximos jogos" (só pendentes ou todos — `pj_filtro:{waId}`, TTL 60min).

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

**v3.27.0**: a lista detalhada sai **ordenada por data/hora do jogo** e
**agrupada por dia** (`📅 qui., 11/06`), com a hora no "ainda não rolou" —
antes vinha na ordem arbitrária do banco.

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
sair do bolão da firma      (v3.30.0 — cita o nome e vai direto)
quero sair
me remove
não quero mais jogar
```
→ Se você participa de **mais de um** bolão, o bot **pergunta de qual** (lista numerada) e depois pede confirmação `sim/não`. Palpites passados ficam no histórico, mas a participação é removida (some do ranking).

→ **v3.30.0**: bolões onde você é **admin** não entram na saída (admin não "sai" — usa *excluir bolão*). Quando isso esconde um bolão, o bot **explica** por que ele não aparece. Você também pode citar o nome direto (`sair do bolão Enter`); se for um que você admina, o bot avisa e sugere *excluir bolão*.

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

## Progresso do bolão e cutucada (v3.8.0)

### Quem palpitou / quem falta — qualquer participante
```
quem palpitou?
quem ainda nao palpitou?
mais gente registrou palpites?
progresso do bolão
quem ta atrasado?
quanto cada um palpitou?
status do bolão
```
→ Bot mostra, por bolão ativo:
- `✅ Já palpitaram (N):` — lista com `Nome 👑 — X/Y palpites` (ordem decrescente por X)
- `⚪ Ainda não palpitaram (M):` — só nomes (ordem alfabética)
- Se o user é admin do bolão E há pendentes, sugere `cutucar pendentes`.

> ⚠️ **Privacidade preservada**: o bot mostra apenas a *quantidade* de palpites de cada
> pessoa (X de Y). O placar individual continua privado — ninguém vê o palpite do outro.

### Cutucar pendentes — só admin
```
cutucar pendentes
cobrar palpites
lembrar quem não palpitou
chamar pendentes
pingar pendentes
```
→ Bot manda DM pra cada participante que ainda tem 0 palpites na rodada aberta:

> 🏁 *Jeniffer* (admin do bolão *Bolão das Girls*) pediu pra te lembrar de palpitar!
> Você ainda tem palpites pendentes. Manda *próximos jogos* pra ver o que falta. 🍀

→ Bot confirma pro admin: `✅ Cutuquei 11 pendente(s) do *Bolão das Girls*.`

**Idempotência**: 1 cutuque por bolão a cada 30 minutos (flag Redis
`cutucar_admin:{bolaoId}`). Se admin tentar 2x seguidas, bot avisa
"Já cutuquei há pouco. Aguarda uns minutos."

Se admin tem >1 bolão e nenhum padrão setado, bot pede pra definir um
padrão primeiro com `definir bolão padrão`.

## Onboarding leve pra novato (v3.9.0)

### Dicas pra montar palpite
```
dicas
tem dicas?
dicas pra palpitar
como eu monto um palpite?
como decido o placar?
qual placar é mais comum?
tem estratégia?
me ensina a palpitar
```
→ Bot responde com:
- *Pontuação resumida* (10/7/5/3/0)
- *Placares mais comuns em Copa*: 1x0, 2x1, 2x0, 1x1, 0x0 (fato histórico)
- *4 dicas práticas*: (1) palpita em TODOS os jogos, (2) foco em vencedor (3pts e fácil), (3) coração/aleatório quando não sabe, (4) dá pra editar até o jogo começar
- CTA: `próximos jogos`

> ⚠️ Bot NÃO dá dica de aposta nem predição de jogo específico — só
> estratégia genérica de uso do bolão.

### Acolhimento de novato
```
nao entendo de futebol
nao sei nada de futebol
futebol não é minha praia
to perdida / to perdido
é minha primeira vez
nunca palpitei
to com medo de errar / vou errar tudo
sou leiga/iniciante em bolão
```
→ Bot responde com tom acolhedor (não condescendente):
- *"Relaxa! Não precisa entender nada de futebol pra palpitar"*
- Validação: gente palpita no aleatório/coração/cor da camisa e ganha
- 3 passos básicos (palpita placar → ganha pontos → erra? sem stress)
- CTAs leves: `dicas`, `regras`, `próximos jogos` (se já tá em bolão) ou `entrar em bolão` (se não)

Caso real que motivou (Valéria Midon 22/05/2026):
- *"você tem dicas de como montar os palpites?"* → bot dava pitch genérico de INFO_PRODUTO
- *"nao entendo de futebol"* → bot caía em fallback "Não peguei essa, craque"
- Agora ambos vão pros handlers dedicados.

## Copa rolando: placar, pontos e status (v3.15.0)

### Placar de jogo recente
```
qual o placar?
quanto tá o jogo?
quem ganhou?
quem está ganhando?
como ficou o jogo do Brasil?
resultado de ontem
saiu o resultado?
qual foi placar de México e África?     (v3.27.0)
quais jogos já finalizaram?             (v3.27.0)
jogos finalizados / jogos de ontem      (v3.27.0)
o que já rolou?                         (v3.27.0)
placar do México                        (v3.27.0)
```
→ Bot responde do BANCO (placar ao vivo via FIFA): jogos 🔴 AO VIVO + ✅ encerrados nas últimas 48h dos bolões do user. Filtra por time se mencionado. Perguntas fora de escopo (copa antiga, clube) caem na recusa educada de sempre.

⚠️ **"placar dos demais/outros/participantes"** NÃO é placar oficial — é
pedido de ver os **palpites dos outros** → intent `PALPITE_OUTROS` (v3.27.0):
com o jogo já iniciado/finalizado, o bot revela os palpites de todos do
bolão pra aquele jogo (sem limite de 24h quando o time é citado).

### Pontos por jogo (breakdown)
```
quantos pontos fiz ontem?
acertei meu palpite?
ganhei pontos?
pontos de ontem
```
→ Lista jogo a jogo: placar real, palpite do user e pontos obtidos (🎯 10 / 🥈 5-7 / 👍 3 / ❌ 0). Marca "⏳ calculando" se a pontuação do jogo ainda não rodou (~10min após o fim).

### Estatística de pontos (quebra por faixa)
```
quantas cravadas eu fiz?
quantos placares exatos acertei?
quantos fiz 10 pontos?
quantos de 7 / 5 / 3 pontos?
quantas vezes zerei?
estatística dos meus pontos
resumo da minha pontuação
de onde vêm meus pontos?
meu aproveitamento
```
→ Conta quantos palpites seus pontuaram em cada faixa (🎯 cravadas/10 • 🔥 7 • 👍 5 • 😐 3 • ❌ 0) e soma o total. Só conta jogos já FINALIZADOS e calculados. Se você perguntou uma faixa específica (ex: "quantas cravadas?"), vem um destaque no topo + a quebra completa logo abaixo. Diferente de **pontos por jogo** (lista das últimas 48h) e de **meus pontos** (só o número total).

### Jogos de uma faixa (drill-down)
```
quais jogos eu cravei?
me mostra as cravadas
quais jogos fiz 7 pontos?
quais deram 5
me mostra os de 3 pontos
quais jogos eu zerei?
em quais errei tudo
```
→ Lista os jogos da faixa pedida com o seu palpite + o resultado real (ex: "🎯 Suas cravadas — • Brasil 2x1 Marrocos — você cravou! ✅"). No rodapé vem a régua de faixas (🎯6 🔥10 👍9 😐7 ❌8) + dica pra ver outra faixa. É o **detalhamento** da estatística: enquanto "quantas cravadas?" **conta**, "quais cravei?" **lista os jogos**. Só jogos FINALIZADOS e calculados.

### Status da rodada
```
quando atualiza o ranking?
quando saem os pontos?
cadê meus pontos?
```
→ Explica o pipeline: placar ~5min → pontos ~10min após o jogo → ranking na sequência. Mostra jogo ao vivo se houver.

### Desabafo (acolhimento)
```
tô em último
fui mal demais
nunca acerto
```
→ Acolhimento + esperança real (conta jogos ainda abertos pra palpitar) + CTA *dicas* / *próximos jogos*.

> Nota: "foi mal" (gíria de desculpa) NÃO cai aqui — continua despedida/casual.

### Reclamação de erro
```
meus pontos estão errados
tá bugado
calculou errado
faltou ponto
```
→ Bot **loga a reclamação** pra revisão offline (tabela `MensagemNaoEntendida`, motivo `reclamacao_bug`), acolhe sem ser defensivo, explica os critérios e o recálculo automático, e pede o jogo específico se persistir.

### Mídia (áudio, figurinha, foto)
→ Bot responde *"só entendo texto — me manda digitando"* (1x por hora por usuário, pra não floodar). Antes: silêncio total.

## Editar e apagar palpite

### Editar (substituir placar)

**Modo 2 passos** (clássico):
```
corrigir palpite
mudar palpite
errei o palpite
```
→ Bot abre o fluxo, escolhe o bolão (se >1 e sem padrão), pede o placar novo.

**Modo 1 passo** (v3.7.0 — placar inline):
```
corrigir Brasil 3x1 Marrocos
mudar pra Brasil 2x1 Marrocos
atualizar Brasil 3 a 1
alterar Brasil 2 por 0
refazer Brasil 1-1
```
→ Registra direto sem pedir mais nada (usa bolão padrão ou bolão único).

**Linguagem natural** (v3.7.0 — LLM fallback): no fluxo de 2 passos, quando
o bot pede o placar novo, aceita também "muda pra 3 a 1 pro Brasil",
"errei o Brasil, queria 2x1 contra Marrocos", "empate em 2", etc. — LLM
extrai usando a lista de jogos da rodada como contexto.

**Confirmação inteligente** (v3.7.0): após editar, o bot mostra
*"Era: **Brasil 2x1 Marrocos** → Agora: **Brasil 3x1 Marrocos**"* pra
deixar claro o que mudou.

**Trava por jogo** (v3.7.0): a edição é bloqueada se o jogo específico já
começou (`dataHora ≤ agora` ou status ≠ AGENDADO). Mensagem: *"Esse jogo
já começou — palpite trava no kickoff."*

Funciona em rodada **ABERTA** com jogos ainda **AGENDADOS**. Usa bolão
padrão se setado; senão pergunta qual bolão (se houver >1).

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

---

## 🏆 Mata-mata (Copa 2026)

A partir dos 16-avos, o placar do bolão vale o resultado ao **fim da prorrogação**
(pênalti não entra no placar, só decide quem avança). Os pontos sobem por fase e
há um **bônus** por acertar quem se classifica.

### Palpitar no mata-mata
Igual aos grupos (`Brasil 2x1 Argentina`). Se você cravar **empate**, o bot pergunta
quem passa nos pênaltis (acertar dá bônus; errar **não** tira o ponto do placar):
```
Você: Brasil 1x1 Argentina
Bot:  (confirma) → "Deu empate 🤝 — quem se classifica nos pênaltis: Brasil ou Argentina?"
Você: Brasil
```

### Regras (submenu)
```
regras
```
→ Bot pergunta: *completas* ou *mata-mata?*. Acesso direto:
```
regras do mata-mata
```

### Dúvidas frequentes (resposta na hora)
| Frase | Responde |
|-------|----------|
| `a prorrogação conta?` | Conta — placar vale até o fim da prorrogação |
| `pênalti conta?` / `e os pênaltis?` | Não entra no placar, só define quem avança |
| `e se empatar?` | Dos 16-avos: cravou empate → bot pergunta quem passa (bônus) |
| `quanto vale a final?` | Grade de pontos por fase (10/12/15/18/22) + bônus |
| `o que é o bônus?` | Acertar quem avança (inferido no decisivo, perguntado no empate) |
| `se errar quem passa perco a crava?` | Não — a crava fica garantida, só não leva o bônus |
| `o ranking zera?` | Não — cumulativo, grupos + mata-mata |
| `o que muda agora?` | Resumo do mata-mata |

### Chave (lê os confrontos do seu bolão)
```
quem o Brasil enfrenta?
que horas joga o Brasil?
ver a chave   /   mostra o bracket
```
→ Adversário + fase + horário (Brasília). Se o adversário ainda não saiu, o bot diz
de qual jogo ele depende — **nunca inventa**.

### Definir classificado (dono) — jogos de pênaltis
Quando um jogo de mata-mata termina empatado e vai para os pênaltis, e o provedor
não informa o vencedor, o dono define quem passou (destrava o avanço da chave + o bônus):
```
#CLASSIFICADO WC2026_R32_73 CASA
#CLASSIFICADO WC2026_R32_73 Brasil PENALTIS
```
→ Grava em todos os bolões, recalcula a pontuação e avança a chave. Só o dono
(`OWNER_WHATSAPP_IDS`) dispara; o lado aceita `CASA`/`VISITANTE`, `1`/`2` ou o nome do time.
