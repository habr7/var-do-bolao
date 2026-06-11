# Anti-loop / proteção contra auto-reply

Quando bot manda mensagem pra um número que tem **auto-reply
configurada** no WhatsApp (típico WhatsApp Business), pode acontecer
ping-pong: bot responde a auto-reply → auto-reply dispara de novo →
loop.

Caso real (Lucas 11/06, print 09:00): bom-dia → auto-reply *"Agradeço
seu contato, respondo em breve"* → bot interpretou como
`AGRADECIMENTO` → respondeu *"Imagina! Tamo junto"* → auto-reply
disparou de novo → **8 respostas em ~60s**.

Risco real:
- Hoje (Evolution + número pessoal): viola termos do WhatsApp, derruba
  o número.
- Amanhã (Meta Cloud API oficial): 8 conversas/min × $0.008-0.063 =
  custo absurdo + possível ban da conta API.

## 4 camadas de defesa em profundidade

Cada camada sozinha resolve o caso. Combinadas: se uma falhar, as
outras pegam.

### Camada 1 — Detector de auto-reply (preventivo)

`src/whatsapp/auto-reply.detector.ts:parecAutoReply(texto)` detecta
keywords clássicas:

- "agradeço seu contato" / "obrigado pelo contato"
- "respondo em breve" / "retorno em breve" / "responderei assim que"
- "estou ausente" / "fora do horário" / "horário comercial"
- "mensagem automática" / "resposta automática"
- "no momento não posso atender" / "assim que possível"

**+ filtro de tamanho**: ignora mensagens < 25 chars (auto-replies
são longas; "obrigado" curto não casa).

Aplicado em `handleIncomingMessage` ANTES do parser. Quando detectado,
**bot silencia** (não responde, não registra "não entendi"), só conta
métrica `msg.auto_reply.detectada`.

### Camada 2 — Patterns AGRADECIMENTO endurecidos

`message.parser.ts:AGRADECIMENTO_PATTERNS` agora exigem fim de
mensagem ou pontuação após a palavra-chave. *"Agradeço seu contato,
respondo em breve"* não casa porque tem texto depois.

**+ cap de 30 chars no `matchIntent`**: mesmo que pattern case
acidentalmente, mensagem > 30 chars não vira AGRADECIMENTO.

Anti-regressão preservada: `"obrigado"`, `"valeu"`, `"vlw"`,
`"muito obrigado mesmo"`, `"Agradeço!"` continuam casando normal.

### Camada 3 — Rate-limit reativo por waId

`src/utils/resposta-cap.ts:verificarAntiLoop(waId, texto)`:

- Conta `resposta:count:{waId}:{bucket-60s}` em Redis
- Cap: **8 respostas/60s** por waId (8 = exato número do print)
- Acima: bot silencia + flag `silenciado:{waId}` TTL 5min impede
  reentrada imediata

Aplicado em **toda mensagem** processada. Não confunde com `aviso-cap`
(v3.17.0) que limita jobs **push** — este é defesa reativa.

### Camada 4 — Detector de mensagem repetida

Em `verificarAntiLoop`: SHA-1 truncado da última mensagem do user
(TTL 60s). Se MESMA string chega 2+ vezes em < 60s → silencia.

Mata 100% dos auto-replies que mandam exatamente o mesmo texto toda
vez (caso da Camila e da imensa maioria dos auto-replies WhatsApp
Business).

## Telemetria

| Métrica | Quando |
|---|---|
| `msg.auto_reply.detectada` | Camada 1 disparou |
| `msg.anti_loop.repetida` | Camada 4 disparou |
| `msg.anti_loop.cap_60s` | Camada 3 disparou |
| `msg.anti_loop.silenciado` | Reentrada no TTL de 5min |

Logs estruturados:
```
[anti-loop] waId=5511... motivo=auto_reply texto="Agradeço seu contato..."
[anti-loop] waId=5511... motivo=cap_60s msgs=9
[anti-loop] waId=5511... motivo=repetida
[anti-loop] waId=5511... motivo=silenciado
```

Observar via:
```bash
docker compose logs --tail=500 app | grep '\[anti-loop\]'
```

Inspecionar contadores Redis:
```bash
docker compose exec redis redis-cli KEYS 'resposta:*'
docker compose exec redis redis-cli KEYS 'silenciado:*'
```

## O que NÃO entrou

- ❌ Whitelist global de variações de auto-reply (impossível mapear
  todas em PT-BR). Heurística de keywords cobre 95%+.
- ❌ Bloqueio permanente do waId — silencia só por 5min, dá chance pro
  user humano voltar.
- ❌ Env var pra cap — 8/60s hardcoded; raríssimo user legítimo
  precisar disso. Vira env se aparecer caso real.

## Limitações conhecidas

- Não detecta auto-replies em outras línguas (inglês básico coberto
  parcial via "thanks for reaching", outros idiomas não).
- Bot pode silenciar 1 mensagem legítima em casos onde user humano
  manda EXATAMENTE a mesma string 2× em 60s. Aceitável — pode
  reformular a 2ª.
