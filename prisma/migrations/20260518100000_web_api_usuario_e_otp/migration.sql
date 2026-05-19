-- Fase 2 do site (web/) — tabelas de autenticacao web.
-- UsuarioWeb: conta com email+senha vinculada 1-1 a um Usuario do bot.
-- OtpToken: codigos OTP de 6 digitos mandados via WhatsApp.

CREATE TABLE "usuarios_web" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "dataNascimento" TIMESTAMP(3),
    "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,
    "ultimoLoginEm" TIMESTAMP(3),

    CONSTRAINT "usuarios_web_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usuarios_web_usuarioId_key" ON "usuarios_web"("usuarioId");
CREATE UNIQUE INDEX "usuarios_web_email_key" ON "usuarios_web"("email");

ALTER TABLE "usuarios_web"
  ADD CONSTRAINT "usuarios_web_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OTP tokens
CREATE TABLE "otp_tokens" (
    "id" TEXT NOT NULL,
    "whatsappId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "usadoEm" TIMESTAMP(3),
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_tokens_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "otp_tokens_whatsappId_codigo_idx" ON "otp_tokens"("whatsappId", "codigo");
CREATE INDEX "otp_tokens_expiraEm_idx" ON "otp_tokens"("expiraEm");
