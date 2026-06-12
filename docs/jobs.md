# Jobs do VAR do Bolão

Pipeline de cron jobs que mantém o bolão funcionando. Todos rodam no
processo principal via `node-cron`, registrados em `src/jobs/index.ts`.

## Pipeline visual

```
                              ┌────────────────────────┐
                              │   send-bom-dia        │ (hourly, BRT)
                              │   "6h antes do próximo │
                              │    jogo, cooldown 24h" │
                              └────────────────────────┘
                                          │
                                          ▼  (4h antes do 1º jogo)
                              ┌────────────────────────┐
                              │   send-palpite-call    │ (hourly :05)
                              │   "lista de jogos +    │
                              │    cutucada ativa"     │
                              └────────────────────────┘
                                          │
                                          ▼  (3h antes do fechamento)
                              ┌────────────────────────┐
                              │   send-reminders       │ (30min)
                              │   "fecha logo, palpita"│
                              └────────────────────────┘
                                          │
                                          ▼  (kickoff)
┌──────────────┐   (toda hora)   ┌────────────────────────┐
│ fetch-results│ ────────────▶   │  Jogos no banco        │
│ (5min)       │                 │  golsCasa/golsVisitante│
└──────────────┘                 └────────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   calculate-scores     │ (10min)
                              │   "pontuação + ranking"│
                              └────────────────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   send-ranking         │ (hourly)
                              │   "como você foi"      │
                              └────────────────────────┘
```

## Tabela detalhada

| Job | Schedule | O que faz | Idempotência | Env flag |
|---|---|---|---|---|
| `fetch-results` | `*/5 * * * *` (5min) | Busca placares da API FIFA/openfootball, atualiza jogos no banco. Se placar de jogo FINALIZADO mudou (correção VAR), reseta `Palpite.calculado=false` (v3.13.0). | Idempotente (compara antes/depois) | — |
| `calculate-scores` | `*/10 * * * *` (10min) | Pra cada rodada FINALIZADA com palpites `calculado=false`, calcula pontos e atualiza ranking. | Flag `calculado=true` por palpite | — |
| `send-bom-dia` | `0 * * * *` (hourly) | v3.13.0: dispara "6h antes do próximo jogo" (não em hora fixa). Clamp [07:00–22:00 BRT]. Lista TODOS os jogos próximos com ✅ palpitado / ⚪ pendente. | Redis `aviso_jogo:{waId}` TTL 24h. Compartilha cooldown com `send-palpite-call`. | `ENABLE_BOM_DIA` |
| `send-palpite-call` | `5 * * * *` (hourly :05) | Chamada ativa de palpites — 6h antes do 1º jogo do dia. Lista jogos + abre fluxo PALPITANDO. | Redis `palpite-call:{bolaoId}:{date}` TTL 30h + cooldown cross-job `aviso_jogo:{waId}` 24h. | `ENABLE_PALPITE_CALL` |
| `send-reminders` | `*/30 * * * *` (30min) | **DESATIVADO (v3.31.0)** — era por-rodada (cutuca quem não palpitou nada a <3h do fechamento). Substituído pelo `send-lembrete-30min`. Cron mantido, gate em env. | Por usuário/rodada | `ENABLE_REMINDERS` (default **false**) |
| `send-lembrete-30min` | `*/5 * * * *` (5min) | **v3.31.0**: lembrete de última hora POR JOGO — ~30min antes do kickoff, cutuca quem ainda não palpitou AQUELE jogo. Coalesce jogos da janela em 1 msg. CONTA no `MAX_AVISOS_DIA`. **NÃO** honra `aviso_jogo` (tem cooldown próprio). | Redis `lembrete30:{wa}:{jogoId}` 2h (1x/jogo) + `lembrete30_cd:{wa}` cooldown (default 90min) | `ENABLE_LEMBRETE_30MIN`, `LEMBRETE_30MIN_ANTECEDENCIA_MIN`, `LEMBRETE_30MIN_COOLDOWN_MIN` |
| `send-palpite-reveal` | `*/2 * * * *` (2min) | v3.24.0: no kickoff de um jogo, revela pros integrantes os palpites de TODOS do bolão pra aquele jogo (quem não palpitou = "não palpitou"). Time-driven (independe da FIFA). Multi-bolão = 1 msg com 1 bloco por bolão. CONTA no `MAX_AVISOS_DIA`. | Redis `reveal:{waId}:{apiJogoId}` TTL 6h (1 envio por pessoa/jogo) | `ENABLE_PALPITE_REVEAL` |
| `send-ranking` | `0 * * * *` (hourly) | Manda ranking personalizado pós-rodada FINALIZADA. | Por bolão/rodada | — |
| `revisao-diaria` | `0 9 * * *` (09:00 BRT) | **v3.32.0**: manda pro(s) dono(s) (`OWNER_WHATSAPP_IDS`) o relatório das mensagens não-entendidas das últimas 24h (total por motivo + textos dedupados + intent/confiança que o LLM tentou). Loop de melhoria contínua. Mensagem ADMIN: não conta no `MAX_AVISOS_DIA`. | Redis `revisao-diaria:{YYYY-MM-DD}` TTL 30h | `ENABLE_REVISAO_DIARIA` |
| `repair-broken-boloes` | boot + `0 3 * * *` | Repara rodadas sem jogos. | — | — |
| `limpar-mensagens-antigas` | `0 5 1 * *` (mensal) | LGPD: deleta `MensagemNaoEntendida` >RETENCAO_DIAS. | — | — |

## Vars que controlam comportamento

| Var | Default | Onde afeta |
|---|---|---|
| `TIMEZONE` | `America/Sao_Paulo` | Cron + display + clamp horário civilizado |
| `HORARIO_BOM_DIA` | `09:00` | *Deprecated em v3.13.0* — `send-bom-dia` agora é adaptativo |
| `PALPITE_CALL_HORAS_ANTES` | `6` | Janela do `send-palpite-call` |
| `ENABLE_BOM_DIA` | `true` | v3.13.0 — desliga só esse canal |
| `ENABLE_PALPITE_CALL` | `true` | v3.13.0 — desliga só esse canal |
| `ENABLE_REMINDERS` | `true` | v3.13.0 — desliga só esse canal |
| `ENABLE_PALPITE_REVEAL` | `true` | v3.24.0 — desliga o push de revelação de palpites no kickoff |
| `MAX_AVISOS_DIA` | `8` | v3.17.0 (subido p/ 8 na v3.24.0) — cap diário de avisos/user, cross-job. A revelação no kickoff conta; a resposta sob demanda não. |
| `DRY_RUN_WHATSAPP` | `false` | Captura msgs em memória, não envia |

## Garantias

- **Idempotência cross-job**: `send-bom-dia` e `send-palpite-call` compartilham a flag Redis `aviso_jogo:{waId}` com TTL 24h. Garantia firme de **máximo 1 aviso de jogo por usuário por dia**, independente de qual job rodou primeiro.
- **Clamp horário civilizado** (`send-bom-dia` v3.13.0): nunca envia entre 22:00 e 07:00 BRT. Pra jogos da madrugada (01h BRT comum na Copa 2026 sede Costa Oeste EUA), antecipa pra 22:00 do dia anterior.
- **Reset de cálculo em correção de placar** (`fetch-results` v3.13.0): se API corrigir resultado pós-VAR/gol anulado, palpites afetados têm `calculado=false` setado → próximo tick de `calculate-scores` recalcula.

## Como desabilitar canais isoladamente

```bash
# Staging sem cutucar usuários:
ENABLE_BOM_DIA=false
ENABLE_PALPITE_CALL=false
ENABLE_REMINDERS=false
# fetch-results e calculate-scores continuam — DB fica em dia.
```

Ou usar `DRY_RUN_WHATSAPP=true` pra capturar TODAS as mensagens (incluindo cadastros e respostas) em memória sem enviar.

## Histórico de mudanças relevantes

- **v3.13.0** (2026-06-11): `send-bom-dia` reescrito (6h antes + 24h cooldown + clamp civilizado + cross-job flag + lista ✅⚪). `fetch-results` reseta `calculado` quando placar muda. `ENABLE_*` env vars.
- **v3.11.0**: helper `formatarDataHoraCurtaBR` força fuso de Brasília em todos os displays.
- **v3.8.0**: handler `CUTUCAR_PENDENTES` (admin manda DM) reusa lógica do `send-reminders`.
