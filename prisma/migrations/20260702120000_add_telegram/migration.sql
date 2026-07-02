-- Canal Telegram (multi-canal, v3.59.0) — migration 100% ADITIVA.
--
-- Nada destrutivo: so ADD COLUMN de colunas nullable no usuarios. Os cadastros
-- existentes (whatsappId/palpites/pontos) ficam INTACTOS. O telegramId so eh
-- preenchido quando a pessoa faz o onboarding no Telegram e informa o WhatsApp.
--
-- Defensivo (IF NOT EXISTS) porque um `prisma db push` em dev pode ja ter
-- criado parte destes objetos. Aplicar em prod com `npx prisma migrate deploy`.

ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "telegramId" TEXT;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "telegramUsername" TEXT;
ALTER TABLE "usuarios" ADD COLUMN IF NOT EXISTS "canalPreferido" TEXT;

-- Unique parcial no telegramId (permite varios NULL, mas 1 conta Telegram por usuario)
CREATE UNIQUE INDEX IF NOT EXISTS "usuarios_telegramId_key" ON "usuarios"("telegramId");
