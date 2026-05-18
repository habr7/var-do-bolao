# Sprint Status — Roadmap e ISSUES

> Status atualizado das 47 issues identificadas no documento de bugs
> (`BUGS_E_CENARIOS_VAR_DO_BOLAO.md` — original em 2026-05-16).
>
> Este arquivo é a fonte canônica do que **já foi feito** vs **o que falta**.

**Última atualização:** 2026-05-18 (após expansão de cordialidade + histórico persistente — v3.2.0)

---

## 🎨 UX polish + observabilidade (v3.2.0) — concluído (2026-05-18)

Após os 4 hotfixes do dia, foi pedido (1) ampliar o tratamento de cordialidade
pra cobrir mais casos como "obrigada" e (2) criar um histórico persistente
de mensagens não-entendidas pra melhorar o bot continuamente.

| # | O que foi feito |
|---|---|
| CORD-A | **4 intents novos de cordialidade**: `DESPEDIDA` (tchau/flw/abraço), `CUMPRIMENTO_CASUAL` (tudo bem?/blz?/como vai?), `CONCORDANCIA_CASUAL` (ok/beleza/show/perfeito), `RISADA` (kkk/rsrs/hahaha/😂). Cada um com handler dedicado, múltiplas variantes de resposta randomizadas. Não reabrem menu — saem com cordialidade curta. |
| CORD-B | Pattern restritivo (`^...$`) pra evitar comer palavras incidentais. Diferenciação por `?`: "blz?" → CUMPRIMENTO, "blz" → CONCORDANCIA. "oi tudo bem?" usa stripSaudacao + matchIntent → CUMPRIMENTO_CASUAL. |
| CORD-C | Não conflita com fluxos de confirmação — em `CONFIRMANDO_*` states o FSM dispatcher pega "ok" antes via `interpretarSimNao` (vira SIM); em IDLE vira CONCORDANCIA_CASUAL. Também não pisa em `tentarAcaoAdminEmIdle` — admin com pendentes que manda "ok" continua sendo aprovação. |
| OBS-A | **Nova tabela Prisma `MensagemNaoEntendida`** (migration `20260518120000`). Substitui a antiga lista Redis (TTL 30d, top 500/dia, expirava) por persistência indefinida queryable via SQL. Cobertura: `regex_fail`, `llm_fail`, `final_fallback`, **`low_confidence`** (LLM tentou < 0.55 — ouro pra encontrar variantes a virar regex novo). |
| OBS-B | `classificarIntencao` mudou de retornar `Intencao\|null` para `ClassificationOutcome` com `{intencao, intencaoTentada, confianca}`. Caller (router) agora loga o palpite + confiança do LLM mesmo quando rejeitado, dando contexto pro analista offline. |
| OBS-C | **LGPD**: `whatsappId` NUNCA persistido em claro — só hash sha256-16 via `hashIdentificador()`. FK `usuarioId` com `ON DELETE SET NULL`. Env nova `MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS` (default 180). Job mensal `limpar-mensagens-antigas` (`0 5 1 * *`) + script CLI `scripts/limpar-mensagens-antigas.ts`. |

**Métricas:** 377 unit tests (era 342) · 102 cenários (era 85).

---

## 🩹 Hotfixes UX pós-feedback Jeni — concluídos (2026-05-18)

Três bugs reportados após teste real no WhatsApp (conversa Jeni 17/05 22:20-22:22):

| # | Bug | Conserto |
|---|---|---|
| UX-A | "Quero ver o ranking" / "Ver o ranking" → bot respondia `❌ Bolão "Quero ver o ranking" não encontrado.` Causa: `handleRanking` fazia `raw.replace(/^ranking\s*/i, '')` e usava o resíduo como nome do bolão; quando o trigger "ranking" estava no fim, nada era removido. | Padrões regex novos no `RANKING_PATTERNS` cobrem "quero/queria/quero ver/me mostra ... ranking". Nova função `extrairNomeBolaoDoRanking` faz strip robusto de prefixos + verbos + triggers; retorna vazio se sobrar só ruído → bot pergunta qual bolão. |
| UX-B | "Obrigada" → bot reabria o menu completo de boas-vindas. Causa: caía em SAUDACAO via LLM. | Nova intent `AGRADECIMENTO` no topo de `INTENT_RULES` com regex cobrindo obrigad[ao], valeu, vlw, brigad[ao]/brigadão, thanks/thx, tmj, agradecido. Handler `handleAgradecimento` responde curto e amigável com nome do usuário, randomizando entre 5 variantes. |
| UX-C | Palpite único registrado sem preview de confirmação quando o mesmo jogo casava em N bolões (ISSUE-015 auto-apply). | Novo estado FSM `CONFIRMANDO_PALPITE_MULTI_BOLAO` + handler `handleConfirmandoPalpiteMultiBolao`. Bot mostra "vai aplicar em N bolões: ..." e pede sim/não/refazer antes de registrar. Bônus: removido dead code `registrarPalpiteInline`. |

**Métricas:** 342 unit tests (era 322) · 85 cenários (era 75).

---

## 🚨 Hotfixes pós-Sprint 2 — concluídos (2026-05-17)

Dois bugs urgentes detectados em produção depois do deploy do Sprint 2:

| # | Bug | Conserto |
|---|---|---|
| HF-A | `Jogo.apiJogoId` era `@unique` global. Adapter FIFA retorna sempre os mesmos 72 IDs → 2º bolão em diante estourava P2002 silenciosamente (try/catch swallow). Bolão ficava criado com rodada vazia → "próximos jogos" respondia "não tem rodada aberta". | Migration troca pra `@@unique([rodadaId, apiJogoId])`. `criarBolao` agora é transacional (`prisma.$transaction`) e falha alto se o seed de jogos não rolar. Novo job `repair-broken-boloes` repara legado quebrado no boot + diariamente às 03:00 com notificação DM pro admin. |
| HF-A2 | Follow-up do HF-A: o `@unique` original foi criado como `CREATE UNIQUE INDEX` (init migration), não como `ALTER TABLE ADD CONSTRAINT`. Por isso o `DROP CONSTRAINT IF EXISTS` da HF-A era no-op silencioso e o índice unique global ficou órfão, ainda bloqueando inserts cross-bolão. | Nova migration `20260517170000_drop_jogos_apijogoid_unique_index` executa `DROP INDEX IF EXISTS`. Novo script `scripts/run-repair-once.ts` permite disparar o reparo sob demanda sem subir o servidor. |
| HF-B | Após admin encerrar bolão, mensagem dizia "palpites e ranking ficam guardados", mas 17min depois "ranking"/"próximos jogos"/"meus bolões" respondiam "você não participa de nenhum bolão" — contradição direta. Causa: `listarBoloesDoUsuario` filtrava `status='ATIVO'` em TODAS as listagens, inclusive consultas históricas. | Repository split em `listarBoloesAtivosDoUsuario` (ações) vs `listarBoloesDoUsuarioComHistorico` (consultas). `handleRanking`, `handleMeusBoloes`, `handleMeusPalpites` agora incluem FINALIZADOS, marcados com 🏁. `handleProximosJogos` detecta "só tem encerrados" e dá mensagem auto-diagnóstica oferecendo `ranking`/`meus palpites`. |

---

## ✅ Sprint 1 — concluído (2026-05-17)

| # | Issue | Status |
|---|---|---|
| 001 | Códigos do banco contendo `0/1/I/L/O` aceitos pelo extrator | ✅ |
| 002 | `handleEntrandoNome` — 3 tentativas antes de resetar | ✅ |
| 003 | Busca fuzzy de bolão por nome (Unicode + substring) | ✅ |
| 004 | Mensagem-convite cria solicitação direto (sem senha) | ✅ |
| 005 | Intent `INFO_SENHA` com handler dedicado | ✅ |
| 006 | Handler de excluir bolão (admin) com confirmação | ✅ |
| 007 | Fast-path de código em mais estados (blacklist em vez de whitelist) | ✅ |
| 008 | Observabilidade da taxa de fallback LLM (Redis metrics) | ✅ |
| 040 | Link wa.me na mensagem-convite (antecipado) | ✅ |

---

## ✅ Sprint 2 — concluído (2026-05-17)

| # | Issue | Status |
|---|---|---|
| 009 | Handler "como funciona / o que é isso" → `INFO_PRODUTO` | ✅ |
| 010 | Handler "quanto custa / é grátis" → `INFO_PRECO` | ✅ |
| 011 | Editar palpite (fluxo escolha → novo placar) | ✅ |
| 012 | Apagar palpite (fluxo escolha → confirma) | ✅ |
| 013 | Validação de placar absurdo (>15 gols ou total >20) | ✅ |
| 014 | Palpite com time errado → feedback com jogos abertos | ✅ |
| 015 | Multi-bolão: palpite único auto-aplica em todos | ✅ |
| 016 | Bolão padrão (`Usuario.bolaoPadraoId` + migration) | ✅ |
| 017 | Handler "como dou palpite" → `COMO_PALPITAR` | ✅ |
| 018 | Handler "quando começa / termina" → `QUANDO_COMECA` | ✅ |
| 019 | Listar IDs em "meus bolões" sempre (não só admin) | ✅ |
| 020 | Renomear bolão (admin) | ✅ |
| 021 | Remover participante (admin) | ✅ |
| 022 | "Sair do bolão" — mensagem clara sobre perdas | ✅ |
| 023 | `RESUMO_BOLOES` — desempenho em todos os bolões | ✅ |

**Métricas:** 322 unit tests (era 281), 75 cenários de simulação (era 55).

---

## 🟡 Sprint 3 — pendente (P2)

| # | Issue | Prioridade |
|---|---|---|
| 024 | Cutucar participantes (admin) | P2 |
| 025 | Mudar nome de exibição | P2 |
| 026 | Histórico de palpites de outros (pós-jogo, privacy) | P2 |
| 027 | Transferir admin | P2 |
| 028 | Resumo de desempenho com gráfico/cards | P2 |
| 029 | Notificações on/off por tipo | P2 |
| 030 | Atalho de palpite por número do jogo | P2 |
| 031 | Comando "onde estou / o que tava fazendo" | P2 |
| 032 | Undo do último palpite | P2 |

## 🛡️ Segurança/Robustez transversais

| # | Issue | Prioridade |
|---|---|---|
| 033 | Rate limit por waId | P1 |
| 034 | Rate limit de criação de bolão | P1 |
| 035 | Cooldown 24h após recusa de solicitação | P1 |
| 036 | Sanitização de nomes (emoji/URL/ofensa) | P1 |
| 037 | Mascarar telefone em logs (LGPD) | P1 |
| 038 | TTL curto pra confirmações destrutivas (CONFIRMANDO_*) | P2 |

## 🎨 Polish de comunicação

| # | Issue | Prioridade |
|---|---|---|
| 039 | Menu de erro curto (3 opções no mobile) | P2 |
| 041 | Smart-fallback recebe contexto FSM no prompt | P2 |
| 042 | Reconhecer encaminhamento de mensagem | P2 |

## 📊 Observabilidade

| # | Issue | Prioridade |
|---|---|---|
| 043 | Dashboard admin básico (GET /admin/dashboard) | P1 |
| 044 | Tracking de jornada do usuário | P2 |
| 045 | Sentry/Telegram pra erros críticos | P2 |

## 🗃️ Dados

| # | Issue | Prioridade |
|---|---|---|
| 046 | Migrar códigos legados pro alfabeto canônico | P0 (opcional) |
| 047 | Auditar bolões duplicados por nome | P2 |
| 040 | Mensagem-convite com link wa.me | ✅ (Sprint 1) |

---

## Como atualizar este arquivo

Sempre que:
- Uma ISSUE for concluída → marcar com ✅ no quadro correspondente
- Uma ISSUE nova for criada → adicionar na seção apropriada (Sprint 3,
  Segurança, etc.) com prioridade
- Um sprint inteiro for fechado → mover dele pra seção "concluído" no
  topo, atualizando data

Ver `.claude/skills/manter-docs-atualizada/SKILL.md` pro processo
completo. Esta tabela é parte do contrato — quem mudou código importante
deveria atualizar AQUI também.
