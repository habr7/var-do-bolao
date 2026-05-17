---
name: manter-docs-atualizada
description: |
  Skill que mantém a documentação .MD do projeto VAR do Bolão sempre alinhada
  com o código. USE PROATIVAMENTE sempre que terminar mudanças no código que
  envolvam: novo intent, novo state FSM, novo job, novo módulo, mudança no
  schema Prisma, nova env var, novo handler, mudança no pipeline de mensagem,
  mudança na pontuação ou nas regras, novo script em scripts/, ou qualquer
  mudança em src/whatsapp/, src/llm/, src/modules/, src/jobs/, src/utils/.
  Também invocar quando o usuário pedir explicitamente pra atualizar a doc
  ("atualize a documentação", "garante que o MD reflete o código", etc).
---

# Skill: Manter Documentação Atualizada — VAR do Bolão

Esta skill garante que a doc do projeto **nunca fica desatualizada** em
relação ao código. Use **proativamente** ao final de qualquer mudança
estrutural, antes do commit final.

## Quando disparar

Sempre que o último ciclo de mudanças tocou em UM destes:

| Mudança em… | O que pode estar desatualizado |
|-------------|-------------------------------|
| `src/whatsapp/message.parser.ts` (enum `Intencao`, INTENT_RULES) | Lista de intents + ordem + commands.md |
| `src/whatsapp/session.manager.ts` (tipo `ConversaState`) | Tabela de estados FSM |
| `src/whatsapp/command.router.ts` (handlers, pipeline) | Pipeline + tabela de intents → handlers |
| `src/llm/system-prompts.ts` ou novos arquivos `src/llm/*` | Seção LLM + callers |
| `src/jobs/index.ts` ou novos jobs | Tabela de jobs + crons |
| `src/modules/*/` (novo módulo, mudança de service) | Estrutura de pastas + descrição |
| `prisma/schema.prisma` | Seção "Modelo de dados" |
| `src/config/env.ts` ou `.env.example` | Seção "Variáveis de ambiente" |
| `package.json` (scripts ou deps) | Quick start + comandos |
| `docker-compose.yml` | Seção deploy |
| Novos scripts em `scripts/` | TESTING.md + README |
| Novos arquivos em `tests/unit/` | TESTING.md (lista de cobertura) |
| Mudanças nas regras de pontuação (`PONTUACAO_PADRAO`) | Tabela de pontuação em 3 docs |

## Arquivos canônicos

A documentação está organizada assim:

1. **`README.md`** (raiz)
   - Visão geral curta + quick start + estrutura
   - Links pros docs detalhados
   - Histórico de versões resumido
   - Atualizar quando: estrutura de alto nível mudou, comando de quick-start mudou, versão nova

2. **`VAR_DO_BOLAO_ARQUITETURA.md`** (raiz) — **documento canônico**
   - Pipeline de mensagem (seção 5)
   - Camada LLM (6)
   - Lista de intents (7)
   - Estados FSM (8)
   - Modelo de dados (9)
   - Pontuação (10)
   - Códigos curtos (11)
   - Convite wa.me (12)
   - Jobs (13)
   - Variáveis de ambiente (15)
   - Webhook Evolution (16)
   - Métricas (17)
   - Histórico de versões detalhado (22)
   - Atualizar em: qualquer mudança estrutural

3. **`docs/commands.md`**
   - Lista de comandos do bot em formato cheatsheet
   - Frases naturais que disparam cada intent
   - Atualizar em: intent nova, padrão regex novo, novo handler visível ao usuário

4. **`docs/TESTING.md`**
   - 3 níveis de teste + REPL + smoke tests + bateria manual
   - Lista de arquivos `tests/unit/`
   - Atualizar em: novo script de teste, novo test file, nova flag dev

5. **`BUGS_E_CENARIOS_VAR_DO_BOLAO.md`** (raiz)
   - Roadmap de bugs/features priorizado (47 issues)
   - Atualizar em: nova issue identificada, issue concluída (marcar)

## Checklist passo-a-passo

Antes de fazer commit final de mudanças estruturais:

### 1. Inventário rápido
Roda:
```bash
git diff --name-only main...HEAD
```
Identifica quais áreas mudaram. Cruza com a tabela "Quando disparar" acima.

### 2. Atualizar `VAR_DO_BOLAO_ARQUITETURA.md`
Sempre. Mesmo que a mudança seja pequena, ao menos a seção 22 (histórico)
e o "Última atualização" no topo precisam refletir a data nova.

Se mudou estrutura: atualizar a seção correspondente. Manter exemplos
e tabelas em sync com o código (ler o código verbatim, não confiar na
memória).

### 3. Atualizar `docs/commands.md`
Se mudou intent ou padrão regex visível ao usuário. Manter os "exemplos"
batendo com `INTENT_RULES` do parser.

### 4. Atualizar `docs/TESTING.md`
Se adicionou test file novo, script novo em `scripts/`, ou mudou bateria
manual recomendada.

### 5. Atualizar `README.md`
Se mudou quick-start, estrutura de pastas de alto nível, ou versão (na
seção "Histórico curto" no fim).

### 6. Atualizar `BUGS_E_CENARIOS_VAR_DO_BOLAO.md`
Se concluiu uma ISSUE — marcar com ✅. Se descobriu bug novo durante a
implementação — adicionar.

### 7. Verificar consistência cruzada
- Pontuação aparece em: README, ARQUITETURA, commands.md, `regras.text.ts`,
  `ranking.types.ts`. Se mudou, atualizar em TODOS.
- Lista de intents em: ARQUITETURA seção 7, commands.md, `intent.classifier.ts`
  (INTENCOES_VALIDAS), `system-prompts.ts` (INTENT_CLASSIFIER_PROMPT),
  `message.parser.ts` (enum Intencao + INTENT_RULES). Mudou intent → todos.
- Lista de FSM states em: ARQUITETURA seção 8, `session.manager.ts`
  (ConversaState), `command.router.ts` (cases do switch).

### 8. Validação automatizada
```cmd
npx tsc --noEmit              :: typecheck
npm test                       :: unit tests (deve passar)
npx tsx scripts/simulate-conversation.ts   :: 55+ cenários
```

### 9. Commit da doc junto com o código

A doc vai no MESMO commit das mudanças de código (não em commit separado).
Razão: garante atomicidade — quem faz git checkout em qualquer commit
sempre tem doc alinhada com código daquele ponto.

Mensagem de commit cita "+ doc" no final do summary:

```
feat(whatsapp): novo handler X + doc

- ...
- doc: atualizada ARQUITETURA.md seção Y e commands.md
```

## Heurística para detectar "doc precisa atualizar"

Antes de qualquer commit, faz mentalmente:

> "Se um colega novo lesse SÓ a doc agora, ele entenderia essa mudança?
> Conseguiria reproduzir? Saberia que essa feature existe?"

Se a resposta for "não", a doc precisa atualizar.

## Exemplos concretos

### Exemplo 1 — Nova intent
Mudança: adicionei intent `EDITAR_PALPITE` em `message.parser.ts`.

Atualizar:
- `ARQUITETURA.md` seção 7 (tabela de intents) — nova linha
- `commands.md` — nova subseção com as frases que disparam
- `intent.classifier.ts` (INTENCOES_VALIDAS) + `system-prompts.ts`
  (INTENT_CLASSIFIER_PROMPT) — adicionar EDITAR_PALPITE na lista do prompt
- `simulate-conversation.ts` — cenário(s) novo(s)
- `ARQUITETURA.md` seção 22 (histórico) — nota da versão

### Exemplo 2 — Novo job
Mudança: adicionei `send-resultado-jogo.job.ts` (cron */5min).

Atualizar:
- `ARQUITETURA.md` seção 13 — nova linha na tabela
- `ARQUITETURA.md` seção 4 — adicionar arquivo na árvore `src/jobs/`
- `ARQUITETURA.md` seção 22 — histórico

### Exemplo 3 — Mudança de pontuação
Mudança: ajustei `PONTUACAO_PADRAO` de 10/7/5/3/0 pra 8/5/3/1/0.

Atualizar:
- `ARQUITETURA.md` seção 10
- `README.md` seção pontuação
- `commands.md` seção regras
- `src/whatsapp/regras.text.ts` (texto canônico exibido)
- `simulate-conversation.ts` (se houver cenário de regras)

### Exemplo 4 — Mudança em env
Mudança: adicionei `WHATSAPP_BUSINESS_NUMBER`.

Atualizar:
- `ARQUITETURA.md` seção 15 (env vars)
- `.env.example` (raiz)
- `README.md` quick start se for env obrigatória

## Anti-padrões a evitar

❌ **Doc separada do commit de código** — quem faz git bisect vai pegar
estados inconsistentes.

❌ **"Atualizo depois"** — depois nunca vem. Atualizar AGORA.

❌ **Copiar/colar entre docs sem checar** — pontuação, intents, FSM states
têm cópias múltiplas. Mudar em UM lugar e esquecer dos outros é o
caminho mais rápido pra doc obsoleta.

❌ **Doc descreve o "futuro"** — só documenta o que existe AGORA no código.
Roadmap fica em `BUGS_E_CENARIOS_VAR_DO_BOLAO.md`.

❌ **Tabelas que não batem com código** — sempre ler o código verbatim ao
preencher tabelas. `Grep` por enum/const real, nunca confiar na memória.

## Dica de produtividade

Quando começar a editar, abre 2 abas/buffers:
1. O arquivo de código que você está mexendo
2. `VAR_DO_BOLAO_ARQUITETURA.md` na seção correspondente

Edita os dois em paralelo. Bem mais rápido do que tentar lembrar depois
o que mudou.

## Como invocar esta skill

Esta skill é **declarativa** (memo escrito) — não tem código executável.
Use-a como checklist mental no fim de qualquer mudança estrutural.

Pra Claude (em sessões futuras), a skill é triggered automaticamente
pelo description quando o trabalho atual envolve mudanças nas áreas
listadas. Se não trigger sozinha mas você sentir falta, peça
explicitamente: "aplicar a skill manter-docs-atualizada".
