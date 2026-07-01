# Plano guardado — "meus palpites" filtrado por jogo/seleção (implementar depois)

> Decisão: **B** (por jogo/time **+** filtros de seleção). Motor único.
> Status: ✅ IMPLEMENTADO na v3.57.0 (01/07/2026).

## Problema
Hoje "qual meu palpite no jogo França x Suécia?" cai em `MEU_PALPITE`, mas o handler
IGNORA o jogo citado: mostra resumo + pergunta "quer ver todos? sim/não" e, no sim,
despeja a Copa inteira (mensagem gigante). O time citado não filtra.

## Por que é barato
- Render por-jogo já existe: `montarStatusResultado` + `linhaClassificadoMeusPalpites`
  (placar oficial + emoji + pts + bônus + "quem passa" + ✅/❌).
- Detecção de time já existe: `construirFatosCopa2026` (usado no `handlePalpiteOutros`).
- Sem privacidade envolvida (é o próprio palpite → pode mostrar sempre, até antes do kickoff).

## Plano
1. **Parser** — garantir que "meu palpite no jogo X", "como fui no França x Suécia",
   "meu placar no jogo da França" caiam em `MEU_PALPITE` carregando o texto (handler já
   recebe `raw`). Adicionar padrões se necessário.
2. **Handler `handleMeuPalpite`** — antes do resumo:
   - Detecta time(s) via `construirFatosCopa2026(raw)`.
   - **Achou** → busca só esse(s) jogo(s) nos bolões do usuário e mostra DIRETO o(s)
     palpite(s) + comparação oficial (reusa render de "meus palpites"), **sem sim/não**.
     Se está em 2+ bolões com o jogo, mostra os dois (rotulado por bolão).
   - **Não achou** → comportamento atual (resumo + sim/não). Nunca "não encontrei".
3. **Filtros de seleção (mesmo motor)** — "meus palpites do mata-mata / das oitavas /
   de hoje / de ontem": filtro por fase/dia em vez de time. Resolve o "meus palpites tá
   gigante" no dia-a-dia.
4. **Testes + docs.** Sem migration.

## Riscos/ressalvas
- Detecção falha (abreviação/typo) → fallback pro comportamento atual (só ganho, sem risco).
- Reusar `getMeusPontosNoBolao` (já traz rodadas→jogos com placar/status/pontos) e filtrar
  os `jogos` por time/fase/dia antes de renderizar.
