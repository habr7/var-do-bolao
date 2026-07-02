-- Historico de conversas + trilha de auditoria de palpite (v3.60.0).
-- Migration 100% ADITIVA: so CREATE TABLE novos. Nada nos dados existentes.
-- Defensivo (IF NOT EXISTS) pra tolerar `prisma db push` previo em dev.

CREATE TABLE IF NOT EXISTS "mensagens_conversa" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT,
  "waId" TEXT NOT NULL,
  "canal" TEXT NOT NULL,
  "direcao" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "messageId" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensagens_conversa_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "mensagens_conversa_usuarioId_criadoEm_idx" ON "mensagens_conversa"("usuarioId", "criadoEm");
CREATE INDEX IF NOT EXISTS "mensagens_conversa_waId_criadoEm_idx" ON "mensagens_conversa"("waId", "criadoEm");
CREATE INDEX IF NOT EXISTS "mensagens_conversa_criadoEm_idx" ON "mensagens_conversa"("criadoEm");

DO $$ BEGIN
  ALTER TABLE "mensagens_conversa"
    ADD CONSTRAINT "mensagens_conversa_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "palpites_auditoria" (
  "id" TEXT NOT NULL,
  "usuarioId" TEXT NOT NULL,
  "jogoId" TEXT NOT NULL,
  "bolaoId" TEXT NOT NULL,
  "acao" TEXT NOT NULL,
  "placarAntes" TEXT,
  "placarDepois" TEXT,
  "classificado" TEXT,
  "textoOriginal" TEXT,
  "canal" TEXT,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "palpites_auditoria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "palpites_auditoria_usuarioId_criadoEm_idx" ON "palpites_auditoria"("usuarioId", "criadoEm");
CREATE INDEX IF NOT EXISTS "palpites_auditoria_jogoId_idx" ON "palpites_auditoria"("jogoId");

DO $$ BEGIN
  ALTER TABLE "palpites_auditoria"
    ADD CONSTRAINT "palpites_auditoria_usuarioId_fkey"
    FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "palpites_auditoria"
    ADD CONSTRAINT "palpites_auditoria_jogoId_fkey"
    FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
