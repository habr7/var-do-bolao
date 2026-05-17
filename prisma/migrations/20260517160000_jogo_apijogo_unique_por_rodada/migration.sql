-- HOTFIX 17/05: Jogo.apiJogoId era unique global, mas o adapter
-- FifaWorldCup2026Adapter retorna sempre os mesmos 72 apiJogoIds
-- (WC2026_A_1, WC2026_A_2, ...) pra qualquer bolao. O primeiro bolao
-- da plataforma inseria com sucesso; do segundo em diante, `createMany`
-- estourava P2002 unique violation e os jogos nao eram persistidos —
-- bolao ficava criado com rodada vazia.
--
-- Solucao: trocar unique global por unique POR RODADA. A rodada ja
-- garante isolamento entre bolaes; manter apiJogoId unico dentro de
-- uma mesma rodada continua bloqueando duplicatas legitimas (refetch
-- por engano), sem bloquear bolaes distintos.

-- 1. Remove a constraint unique global existente
ALTER TABLE "jogos" DROP CONSTRAINT IF EXISTS "jogos_apiJogoId_key";

-- 2. Cria a constraint unique composta (rodadaId, apiJogoId)
ALTER TABLE "jogos" ADD CONSTRAINT "jogos_rodadaId_apiJogoId_key"
  UNIQUE ("rodadaId", "apiJogoId");
