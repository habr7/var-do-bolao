# Checklist pré-Copa do Mundo 2026

**Primeiro jogo: 11/06/2026, 16:00 BRT — México × África do Sul.**

Esse documento foi escrito na v3.14.0 (auditoria emergencial pré-Copa)
e cobre os ajustes que destravaram o pipeline de cálculo de pontuação.

## Bugs bloqueantes corrigidos

| Bug | Sintoma | Fix v3.14.0 |
|---|---|---|
| `fetch-results` só processava rodada com `status='FECHADA'` | Ninguém fechava rodada (sem comando admin, sem auto-fechamento) → fetch sempre `[]` → placares nunca atualizavam | Aceita `status IN ('ABERTA', 'FECHADA')`. Trava de palpite por jogo individual (`palpite.service.ts:66`) já impede regressão de UX. |
| `calculate-scores` só rodava em `status='FINALIZADA'` | Pontos do dia 1 só sairiam dia 26 (após TODOS os 72 jogos terminarem) | Aceita qualquer rodada com palpites `calculado=false`. Reset acontece automaticamente quando jogo vira FINALIZADO. |
| Reset de `Palpite.calculado=false` só pra correções pós-VAR | Primeira finalização não resetava → cálculo nunca disparava | Reseta SEMPRE que jogo vira FINALIZADO + também em correções. |
| Desempate por critérios secundários ausente | Empate em pontos → ordem aleatória | Ordenação em cascata: `pontuacaoTotal DESC → totalPalpites DESC → entradaEm ASC` (regras canônicas). |

## Pipeline incremental (v3.14.0)

```
┌──────────────────┐  cron */5 min  ┌──────────────────────┐
│  fetch-results   │  ────────────▶ │  buscarRodadasCom    │
│                  │                │  JogosEmAndamento    │
└──────────────────┘                │  (ABERTA ou FECHADA) │
                                    └──────────────────────┘
                                            │
                                            ▼
                              ┌──────────────────────────────┐
                              │ Pra cada rodada:             │
                              │ atualizarResultados()        │
                              │   ↳ pra cada jogo c/ placar  │
                              │      novo OU diferente:      │
                              │      - update jogos          │
                              │      - se virou FINALIZADO:  │
                              │        reset Palpite.calc=f  │
                              │ palpitesResetados > 0 ?      │
                              │   calcularPontuacaoRodada()  │
                              │   recalcularRanking()        │
                              │ todosFinalizados ?           │
                              │   finalizarRodada()          │
                              │   enviarRanking(WhatsApp)    │
                              └──────────────────────────────┘
                                            │
                                            ▼  (próximo tick / 10 min)
                              ┌──────────────────────────────┐
                              │  calculate-scores            │
                              │  (backup: pega qualquer      │
                              │   rodada c/ palpites !calc)  │
                              └──────────────────────────────┘
```

## Checklist antes do primeiro jogo (11/06 16:00 BRT)

### 1. Banco de dados

- [ ] Bolão da Copa 2026 existe (`SELECT * FROM bolaos WHERE campeonato_id = 'copa-2026-fase-grupos'`).
- [ ] Rodada 1 existe e tem 72 jogos (`SELECT count(*) FROM jogos WHERE rodada_id = ?`).
- [ ] Todos os jogos têm `apiJogoId` populado (essencial pro `fetch-results` mapear).
- [ ] Todos os jogos têm `dataHora` em UTC correto (ver `src/data/copa-2026/matches.json` como fonte canônica).
- [ ] Rodada está com `status = 'ABERTA'`.

### 2. Variáveis de ambiente em produção

- [ ] `FOOTBALL_PROVIDER=openfootball` (default v3.16.0+; `fifa-2026` legacy depende de `FIFA_SEASON_ID` setado).
- [ ] `TIMEZONE=America/Sao_Paulo`.
- [ ] `DRY_RUN_WHATSAPP=false` (envia mensagens REAIS).
- [ ] `ENABLE_BOM_DIA=true`, `ENABLE_PALPITE_CALL=true`, `ENABLE_REMINDERS=true`.
- [ ] WhatsApp Business API token válido.
- [ ] Redis acessível (idempotência de jobs).
- [ ] Postgres acessível.

### 3. Verificações automatizadas

```bash
npm test                      # 646+ testes verdes
npm run audit:prompts         # 0 warnings (regras + knowledge + system-prompts consistentes)
node scripts/sync-copa-2026.mjs  # opcional — atualiza dados se openfootball publicou ajuste
```

### 4. Smoke test pós-deploy (15 min antes do jogo)

1. Criar um bolão de teste pessoal.
2. Entrar no bolão como segundo usuário (em outro dispositivo).
3. Mandar `próximos jogos` — confere se mostra o México x África do Sul em **16:00 BRT** (não 19:00 ou 22:00).
4. Mandar `Mexico 2x0 África do Sul` — bot deve confirmar e registrar.
5. Mandar `regras` — confere que diz "kickoff de cada jogo" (não "primeiro jogo da rodada").
6. Mandar `quanto vale placar exato?` em conversa livre — LLM deve responder **10 pontos** (não 5).

### 5. Plano de contingência

#### Como verificar que o fetcher está recebendo placares (v3.16.0+)

Log estruturado a cada tick do `fetch-results` (cron 5min):
```
[openfootball] placares recebidos: sucesso=N sem_score=K sem_match=M total_no_json=T
```

- `sucesso > 0` → fonte ativa, jogos sendo atualizados.
- `sucesso = 0` E `total_no_json > 0` → fonte ok mas nada casou (investigar nomes; ver `sem_match` no log).
- `total_no_json = 0` ou erro de rede → openfootball indisponível; usar fallback manual abaixo.

#### Se openfootball estiver fora ou demorar demais
- **Fallback**: admin atualiza placar manualmente via Prisma Studio ou SQL direto:
  ```sql
  UPDATE jogos
  SET gols_casa = 2, gols_visitante = 0, status = 'FINALIZADO'
  WHERE id = '<jogoId>';
  ```
- O reset de `Palpite.calculado=false` é feito automaticamente pelo Prisma trigger? NÃO — é feito pelo `atualizarResultadoJogoComResetCalc`. Se admin atualizar via SQL direto, precisa também:
  ```sql
  UPDATE palpites
  SET calculado = false
  WHERE id IN (
    SELECT DISTINCT palpite_id
    FROM palpite_jogos
    WHERE jogo_id = '<jogoId>'
  );
  ```
- No próximo tick (10 min) o `calculate-scores.job` calcula tudo.

#### Se Redis cair

- Idempotência dos jobs de notificação quebra (msgs duplicadas possíveis).
- Pontuação NÃO é afetada (Postgres é fonte de verdade).
- Pra resetar flags: `redis-cli FLUSHDB`.

#### Se um job estiver enviando spam

- Setar `ENABLE_BOM_DIA=false` (ou equivalente) e reiniciar o container.
- Não precisa de deploy de código.

### 6. Observabilidade

Logs estruturados a procurar:

| Tag | Significa |
|---|---|
| `[fetch-results] cálculo incremental: rodada=N palpitesResetados=K` | Jogo finalizou, pontuação recalculada |
| `[scoring-reset] jogoId=X placarAntes=AxB placarDepois=CxD palpitesResetados=K` | Placar foi corrigido pós-cálculo (VAR/gol anulado) |
| `[bom-dia] waId=X jogos=N proximo=...` | Aviso de jogo enviado |
| `[palpite-call] falha ao enviar pra X` | Falha de WhatsApp — verificar token |

### 7. Garantias de pontuação

- **Função pura** (`calcularPontos`) tem 71+ testes cobrindo todos os 5 tiers (10/7/5/3/0) + edge cases (0x0, 9x0, placar inverso, empate altos, simetria casa↔visitante).
- **Pipeline incremental**: cada jogo que finaliza dispara recálculo no próximo tick (10 min).
- **Idempotência**: rodar o cálculo 2× pro mesmo palpite dá o mesmo resultado (UPSERT em `PalpiteJogo.pontosObtidos`).
- **Reset automático**: se placar é corrigido pós-VAR, palpites afetados são marcados `calculado=false` → próximo tick recalcula.

---

## Versão deste documento

v3.14.0 — escrito em 2026-06-11 com Copa começando em horas. Atualizar
se algum job, env var ou flow mudar.
