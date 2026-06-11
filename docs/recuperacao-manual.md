# Recuperação manual de palpites

Script `scripts/auditar-recuperar-palpite.ts` pra investigar o estado
dos palpites de um usuário no banco e registrar manualmente o que estiver
faltando.

Motivação: caso Natane 11/06 — bot rodou `tentarPalpiteLivreViaLLM`
(refatorado na v3.19.0) que registrava direto sem confirmação, com risco
do LLM alucinar placares. Script existe pra:

1. **Auditar** o estado real do banco
2. **Registrar** manualmente o que estiver faltando, com UPSERT idempotente

## Pré-requisitos

- Container `app` rodando na VPS (`docker compose ps` deve mostrar `Up`)
- Você ter o `waId` do usuário (formato `5511XXXXXXXXX`, só dígitos)
- Lista dos palpites pretendidos (geralmente do print do WhatsApp)

## Modo 1 — Auditar

Mostra o que está no banco AGORA pro waId:

```bash
docker compose exec app npx tsx scripts/auditar-recuperar-palpite.ts \
  audit 5511949607958
```

Saída exemplo:

```
👤 Usuário: Natane Abreu (id=cm...)

🏆 Bolão: Bolão das Girls (id=cm..., status=ATIVO)
  📅 Rodada 1 (id=cm..., total 72 jogo(s) abertos)
     ✅ 3 palpite(s) registrado(s) (calculado=false, pontuacao=0):
        • México 1 × 2 África do Sul _(jogoId=cm..., dataHora=2026-06-11T19:00:00.000Z)_
        • Coreia do Sul 1 × 0 República Tcheca ...
        • ...
```

Use isso pra confirmar:
- Quais palpites JÁ estão registrados (com os placares corretos?)
- Quais faltam
- Se algum precisa ser **corrigido** (placar diferente do pretendido)

## Modo 2 — Registrar

Aceita 3 formatos por palpite (mesmos do bot):

| Formato | Exemplo |
|---|---|
| Canônico | `"Brasil 2x1 Marrocos"` |
| Invertido (v3.10.0) | `"2x1 Brasil x Marrocos"` |
| Gols separados (v3.19.0, caso Natane) | `"2 Brasil X 1 Marrocos"` |

```bash
docker compose exec app npx tsx scripts/auditar-recuperar-palpite.ts \
  registrar 5511949607958 \
  "1x2 Mexico x Africa do Sul" \
  "1x0 Coreia do Sul x Republica Tcheca" \
  "2x0 Estados Unidos x Paraguai" \
  "3x1 Brasil x Marrocos" \
  "2x0 Alemanha x Curacao"
```

Saída exemplo:

```
👤 Usuário: Natane Abreu (id=cm...)

📋 5 palpite(s) parseado(s):
  1. Mexico 1 × 2 Africa do Sul    _(de: "1x2 Mexico x Africa do Sul")_
  ...

🚀 Registrando via palpiteService.registrarPalpitesEmTodosBoloes (UPSERT, idempotente)...

📊 Resultado consolidado (5 palpite(s) do lote):
  • Bolão das Girls: 5/5 registrados, 0 não-aplicáveis
```

### Idempotência garantida

- Rodar 2× com a mesma lista → não duplica (UPSERT em
  `PalpiteJogo.palpiteId+jogoId`)
- Rodar com placares **diferentes** → **sobrescreve** o palpite (modo
  correção)
- Se um palpite não casar nenhum jogo do bolão (nome errado, time não
  está na rodada), reporta `não-aplicáveis` — não crasha, só ignora

### Em caso de erro

```
• Bolão X: 4/5 registrados, 0 não-aplicáveis ⚠️ 1 erro(s)
   - Brasil x Marrocos: jogo ja comecou
```

Erros possíveis:
- *"jogo ja comecou"*: kickoff passou — não dá pra registrar
- *"jogo nao encontrado"*: nome do time não casou nenhum jogo da rodada
- *"placar invalido"*: gols negativos ou > 20 (raríssimo)

## Quando usar

| Cenário | Modo |
|---|---|
| User reporta que palpite não foi registrado | `audit` primeiro, depois `registrar` se faltar |
| User reporta placar errado | `audit` confirma, depois `registrar` com placar correto (sobrescreve) |
| Bug descoberto (tipo Natane v3.19.0) | `audit` em massa pra todos os afetados, depois `registrar` |

## Segurança

- Script roda **dentro** do container, com acesso direto ao Postgres
- Não passa pelo WhatsApp/Evolution (não envia mensagem nenhuma)
- Não dispara o pipeline de scoring (palpites entram com
  `calculado=false`; cron `calculate-scores` pega no próximo tick)

## Lembre

Sempre rode `audit` ANTES de `registrar` pra ter certeza de que está
trabalhando no usuário e bolão certos. waIds têm 12-13 dígitos —
um erro de 1 dígito vai pro user errado.
