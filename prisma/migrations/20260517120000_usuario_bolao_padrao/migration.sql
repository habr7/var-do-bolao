-- ISSUE-016: bolão padrão por usuário
-- Quando setado, comandos como ranking/pontos/quando-começa pulam a
-- etapa de escolha entre N bolões. Opt-in (nullable).

ALTER TABLE "usuarios" ADD COLUMN "bolaoPadraoId" TEXT;

ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_bolaoPadraoId_fkey"
  FOREIGN KEY ("bolaoPadraoId") REFERENCES "boloes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "usuarios_bolaoPadraoId_idx" ON "usuarios"("bolaoPadraoId");
