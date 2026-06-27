-- Mata-mata (Copa 2026) — migration 100% ADITIVA.
--
-- Nada destrutivo: só CREATE TYPE de enums novos e ADD COLUMN de colunas
-- nullable ou com DEFAULT. Os palpites e pontos da fase de grupos ficam
-- INTACTOS (fase recebe DEFAULT 'GRUPOS' em todas as linhas existentes).
--
-- Defensivo (DO/IF NOT EXISTS) porque um `prisma db push` em dev pode já ter
-- criado parte destes objetos. Aplicar em prod com `npx prisma migrate deploy`.

-- CreateEnum (idempotente — CREATE TYPE não suporta IF NOT EXISTS direto)
DO $$ BEGIN
  CREATE TYPE "FaseTorneio" AS ENUM ('GRUPOS', 'R32', 'OITAVAS', 'QUARTAS', 'SEMI', 'TERCEIRO', 'FINAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "LadoJogo" AS ENUM ('CASA', 'VISITANTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable: rodadas — fase com default GRUPOS (linhas existentes viram GRUPOS)
ALTER TABLE "rodadas" ADD COLUMN IF NOT EXISTS "fase" "FaseTorneio" NOT NULL DEFAULT 'GRUPOS';

-- AlterTable: jogos — fase + campos de mata-mata (todos nullable/com default)
ALTER TABLE "jogos" ADD COLUMN IF NOT EXISTS "fase" "FaseTorneio" NOT NULL DEFAULT 'GRUPOS';
ALTER TABLE "jogos" ADD COLUMN IF NOT EXISTS "classificadoLado" "LadoJogo";
ALTER TABLE "jogos" ADD COLUMN IF NOT EXISTS "decididoNosPenaltis" BOOLEAN;
ALTER TABLE "jogos" ADD COLUMN IF NOT EXISTS "proximoJogoApiId" TEXT;
ALTER TABLE "jogos" ADD COLUMN IF NOT EXISTS "proximoSlot" "LadoJogo";

-- AlterTable: palpites_jogos — classificado palpitado + bônus (coluna separada)
ALTER TABLE "palpites_jogos" ADD COLUMN IF NOT EXISTS "classificadoPalpite" "LadoJogo";
ALTER TABLE "palpites_jogos" ADD COLUMN IF NOT EXISTS "bonusObtido" INTEGER NOT NULL DEFAULT 0;
