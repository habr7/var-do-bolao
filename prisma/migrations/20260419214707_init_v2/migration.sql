-- CreateEnum
CREATE TYPE "StatusBolao" AS ENUM ('ATIVO', 'PAUSADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "PagamentoStatus" AS ENUM ('PENDENTE', 'PAGO', 'EXPIRADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "SolicitacaoStatus" AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA');

-- CreateEnum
CREATE TYPE "StatusRodada" AS ENUM ('ABERTA', 'FECHADA', 'FINALIZADA');

-- CreateEnum
CREATE TYPE "StatusJogo" AS ENUM ('AGENDADO', 'AO_VIVO', 'FINALIZADO', 'ADIADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "whatsappId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boloes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "campeonatoId" TEXT NOT NULL,
    "campeonatoNome" TEXT NOT NULL,
    "status" "StatusBolao" NOT NULL DEFAULT 'ATIVO',
    "regras" JSONB,
    "pagamentoId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "boloes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "valorCentavos" INTEGER NOT NULL DEFAULT 9990,
    "status" "PagamentoStatus" NOT NULL DEFAULT 'PENDENTE',
    "pixExternalId" TEXT,
    "pixCopiaCola" TEXT,
    "pixQrCodeUrl" TEXT,
    "nomeBolaoPretendido" TEXT NOT NULL,
    "senhaBolaoHashPretendido" TEXT NOT NULL,
    "pagoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pagamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solicitacoes_entrada" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "bolaoId" TEXT NOT NULL,
    "status" "SolicitacaoStatus" NOT NULL DEFAULT 'PENDENTE',
    "respondidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solicitacoes_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participacoes" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "bolaoId" TEXT NOT NULL,
    "pontuacaoTotal" INTEGER NOT NULL DEFAULT 0,
    "posicaoAtual" INTEGER NOT NULL DEFAULT 0,
    "entradaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "participacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rodadas" (
    "id" TEXT NOT NULL,
    "bolaoId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "status" "StatusRodada" NOT NULL DEFAULT 'ABERTA',
    "dataAbertura" TIMESTAMP(3) NOT NULL,
    "dataFechamento" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rodadas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jogos" (
    "id" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "apiJogoId" TEXT NOT NULL,
    "timeCasa" TEXT NOT NULL,
    "timeVisitante" TEXT NOT NULL,
    "golsCasa" INTEGER,
    "golsVisitante" INTEGER,
    "status" "StatusJogo" NOT NULL DEFAULT 'AGENDADO',
    "dataHora" TIMESTAMP(3) NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jogos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "palpites" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "rodadaId" TEXT NOT NULL,
    "pontuacao" INTEGER NOT NULL DEFAULT 0,
    "calculado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "palpites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "palpites_jogos" (
    "id" TEXT NOT NULL,
    "palpiteId" TEXT NOT NULL,
    "jogoId" TEXT NOT NULL,
    "golsCasa" INTEGER NOT NULL,
    "golsVisitante" INTEGER NOT NULL,
    "pontosObtidos" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "palpites_jogos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_whatsappId_key" ON "usuarios"("whatsappId");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_telefone_key" ON "usuarios"("telefone");

-- CreateIndex
CREATE UNIQUE INDEX "boloes_pagamentoId_key" ON "boloes"("pagamentoId");

-- CreateIndex
CREATE UNIQUE INDEX "boloes_adminId_nome_key" ON "boloes"("adminId", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_pixExternalId_key" ON "pagamentos"("pixExternalId");

-- CreateIndex
CREATE INDEX "pagamentos_status_expiraEm_idx" ON "pagamentos"("status", "expiraEm");

-- CreateIndex
CREATE INDEX "solicitacoes_entrada_bolaoId_status_idx" ON "solicitacoes_entrada"("bolaoId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "participacoes_usuarioId_bolaoId_key" ON "participacoes"("usuarioId", "bolaoId");

-- CreateIndex
CREATE UNIQUE INDEX "rodadas_bolaoId_numero_key" ON "rodadas"("bolaoId", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "jogos_apiJogoId_key" ON "jogos"("apiJogoId");

-- CreateIndex
CREATE INDEX "jogos_dataHora_idx" ON "jogos"("dataHora");

-- CreateIndex
CREATE UNIQUE INDEX "palpites_usuarioId_rodadaId_key" ON "palpites"("usuarioId", "rodadaId");

-- CreateIndex
CREATE UNIQUE INDEX "palpites_jogos_palpiteId_jogoId_key" ON "palpites_jogos"("palpiteId", "jogoId");

-- AddForeignKey
ALTER TABLE "boloes" ADD CONSTRAINT "boloes_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boloes" ADD CONSTRAINT "boloes_pagamentoId_fkey" FOREIGN KEY ("pagamentoId") REFERENCES "pagamentos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_entrada" ADD CONSTRAINT "solicitacoes_entrada_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solicitacoes_entrada" ADD CONSTRAINT "solicitacoes_entrada_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "boloes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participacoes" ADD CONSTRAINT "participacoes_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participacoes" ADD CONSTRAINT "participacoes_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "boloes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rodadas" ADD CONSTRAINT "rodadas_bolaoId_fkey" FOREIGN KEY ("bolaoId") REFERENCES "boloes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jogos" ADD CONSTRAINT "jogos_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodadas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palpites" ADD CONSTRAINT "palpites_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palpites" ADD CONSTRAINT "palpites_rodadaId_fkey" FOREIGN KEY ("rodadaId") REFERENCES "rodadas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palpites_jogos" ADD CONSTRAINT "palpites_jogos_palpiteId_fkey" FOREIGN KEY ("palpiteId") REFERENCES "palpites"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "palpites_jogos" ADD CONSTRAINT "palpites_jogos_jogoId_fkey" FOREIGN KEY ("jogoId") REFERENCES "jogos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
