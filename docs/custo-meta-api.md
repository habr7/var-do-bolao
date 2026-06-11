# Custo de mensagens na Meta Cloud API (planejamento)

Quando migrar do Evolution API (não-oficial, número pessoal) pra Meta WhatsApp
Cloud API (oficial), a cobrança muda. Esta nota explica o modelo de custo e
os controles que o v3.17.0 deixou prontos.

## Modelo de cobrança da Meta (2025-26)

Meta cobra por **conversation window** (janela de 24h por usuário), categorizada:

| Categoria | Preço Brasil (USD/conversa) | Quando aplica |
|---|---|---|
| Service | grátis | Bot responde DENTRO de 24h após o user ter falado |
| Utility | ~$0.008 | Bot abre conversa fora da janela com template aprovado (lembretes, confirmações) |
| Authentication | ~$0.0078 | OTP, login |
| Marketing | ~$0.0625 | Promo, engajamento puro |

**Service** (grátis): vale enquanto o user reagir nas últimas 24h. Cada
resposta dele reabre a janela. Como o bolão é interativo (user manda
palpite, pergunta placar, etc), boa parte cai aí.

**Utility** (~$0.008): os 3 jobs de aviso (bom-dia, palpite-call, reminder)
abrem conversa "do nada" — requer template aprovado pela Meta E é cobrado.

## Cap do v3.17.0

`MAX_AVISOS_DIA=2` (default) limita avisos cross-job por user por dia. Calcule:

| Cenário | Cálculo | Custo/mês |
|---|---|---|
| 100 users × 2 avisos × 30 dias × $0.008 | 6.000 conversas | **$48 USD** |
| 1.000 users × 2 avisos × 30 dias × $0.008 | 60.000 conversas | **$480 USD** |
| 10.000 users × 2 avisos × 30 dias × $0.008 | 600.000 conversas | **$4.800 USD** |

Sem o cap, era até **3 msgs/dia** (caso real Camila 11/06: bom-dia 10:00 +
palpite-call 13:00 + reminder 13:30) → 50% a mais.

## Como reduzir mais (controles disponíveis)

```bash
# Desliga avisos por canal:
ENABLE_BOM_DIA=false
ENABLE_PALPITE_CALL=false
ENABLE_REMINDERS=false

# Reduz o cap diário:
MAX_AVISOS_DIA=1   # 1 aviso/dia, qualquer tipo
MAX_AVISOS_DIA=0   # nenhum aviso push (só service messages)

# DRY_RUN global (não envia NADA, mas jobs rodam — útil em staging):
DRY_RUN_WHATSAPP=true
```

## Recomendações por fase

| Fase | MAX_AVISOS_DIA | ENABLE_* | DRY_RUN |
|---|---|---|---|
| Dev local | 2 | true | true |
| Staging | 2 | true | true |
| Produção (Evolution / número pessoal) | 2 | true | false |
| Produção (Meta Cloud API, <1k users) | 2 | true | false |
| Produção (Meta, >10k users) | 1 | true | false (revisar) |
| Modo "quiet" (Copa entre fases) | 0 | false | false |

## Aproveitando a janela de 24h (service)

A regra geral: **se o user responder em 24h, a próxima resposta do bot é
grátis**. Quando o cap diário de avisos for pequeno, o bot ainda pode
conversar normalmente — tudo que é resposta a uma mensagem do user vira
service (grátis).

Isso significa que os comandos `próximos jogos`, `meus pontos`, `ranking`,
`PLACAR_JOGO`, `PALPITE_OUTROS`, etc, **não pesam no custo** — só os
avisos push dos jobs.

## Observabilidade

Logs estruturados pra acompanhar volume:

```bash
docker compose logs --tail=500 app | grep -E '\[bom-dia\]|\[palpite-call\]|\[reminders\]'
```

Por user, conferir contador Redis:

```bash
docker compose exec redis redis-cli KEYS 'avisos:count:*'
docker compose exec redis redis-cli GET 'avisos:count:5511...:2026-06-12'
```
