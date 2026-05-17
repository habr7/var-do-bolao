# Sprint Status — Roadmap e ISSUES

> Status atualizado das 47 issues identificadas no documento de bugs
> (`BUGS_E_CENARIOS_VAR_DO_BOLAO.md` — original em 2026-05-16).
>
> Este arquivo é a fonte canônica do que **já foi feito** vs **o que falta**.

**Última atualização:** 2026-05-17 (após hotfixes pós-Sprint 2)

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
