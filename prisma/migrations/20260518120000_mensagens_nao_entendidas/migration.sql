-- Sprint 3: tabela persistente pra mensagens que o bot nao entendeu.
-- Substitui a lista Redis (metrics:YYYY-MM-DD:nao-entendi) que tinha TTL
-- de 30 dias e era limitada a 500 amostras/dia.
--
-- Motivos rastreados:
--   regex_fail | llm_fail | final_fallback | low_confidence
--
-- LGPD: whatsappId nunca em claro — so hash sha256-16. FK opcional pro
-- Usuario (ON DELETE SET NULL).

CREATE TABLE "mensagens_nao_entendidas" (
  "id"              TEXT NOT NULL,
  "usuarioId"       TEXT,
  "whatsappIdHash"  TEXT NOT NULL,
  "texto"           TEXT NOT NULL,
  "state"           TEXT NOT NULL,
  "motivo"          TEXT NOT NULL,
  "llmIntent"       TEXT,
  "llmConfianca"    DOUBLE PRECISION,
  "criadoEm"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mensagens_nao_entendidas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mensagens_nao_entendidas_criadoEm_idx"
  ON "mensagens_nao_entendidas"("criadoEm");
CREATE INDEX "mensagens_nao_entendidas_motivo_criadoEm_idx"
  ON "mensagens_nao_entendidas"("motivo", "criadoEm");

ALTER TABLE "mensagens_nao_entendidas"
  ADD CONSTRAINT "mensagens_nao_entendidas_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
