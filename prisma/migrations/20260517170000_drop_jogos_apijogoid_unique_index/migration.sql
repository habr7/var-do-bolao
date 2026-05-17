-- Follow-up da migration 20260517160000_jogo_apijogo_unique_por_rodada.
--
-- A migration anterior usou `ALTER TABLE jogos DROP CONSTRAINT IF EXISTS`,
-- mas o `@unique` original foi materializado pelo Prisma como UNIQUE INDEX
-- (`CREATE UNIQUE INDEX "jogos_apiJogoId_key" ...` no init migration),
-- nao como CONSTRAINT. Resultado: a DROP CONSTRAINT era no-op silencioso e
-- o indice unique global ficou orfao, ainda bloqueando inserts duplicados
-- de apiJogoId entre boloes diferentes.
--
-- Sintoma: o job `repair-broken-boloes` falhava com
-- "Unique constraint failed on the fields: (apiJogoId)" mesmo apos a
-- migration paralela ter "rodado".
--
-- Conserto: derrubar o indice unique global. O indice composto
-- `jogos_rodadaId_apiJogoId_key` (criado pela migration anterior) cobre
-- a unicidade que precisamos.

DROP INDEX IF EXISTS "jogos_apiJogoId_key";
