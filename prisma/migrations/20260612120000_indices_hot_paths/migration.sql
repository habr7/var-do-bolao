-- v3.28.0 — índices aditivos pra hot paths de pontuação/jobs.
--
-- 1. calculate-scores roda a cada 10min e busca rodadas que têm algum
--    palpite com calculado=false. Sem índice, é scan da tabela palpites.
-- 2. fetch-results / bom-dia buscam rodadas ABERTAS por bolão.
--
-- IF NOT EXISTS porque o índice pode já ter sido criado por um
-- `prisma db push` em ambiente de dev.

CREATE INDEX IF NOT EXISTS "palpites_rodadaId_calculado_idx" ON "palpites"("rodadaId", "calculado");

CREATE INDEX IF NOT EXISTS "rodadas_bolaoId_status_idx" ON "rodadas"("bolaoId", "status");
