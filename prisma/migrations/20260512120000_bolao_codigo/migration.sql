-- Adiciona campo `codigo` ao Bolao: identificador curto, unico, publico,
-- usado pra entrar no bolao sem ambiguidade (substitui o matching por
-- nome case-insensitive que dava risco em nomes parecidos).
--
-- Estrategia em duas etapas pra suportar rows existentes:
--   1. Adiciona coluna NULLABLE
--   2. Preenche rows existentes com codigo gerado em SQL puro
--   3. Aplica NOT NULL + UNIQUE
--
-- Pra novos rows, a aplicacao gera o codigo no `bolao.service.criarBolao`.

ALTER TABLE "boloes" ADD COLUMN "codigo" TEXT;

-- Preenche rows existentes com codigo aleatorio (6 chars do alfabeto
-- sem chars ambiguos: 0/O, 1/I/L, etc removidos). Usa md5(random()) pra
-- nao depender de extensoes pgcrypto/uuid-ossp.
UPDATE "boloes"
SET "codigo" = UPPER(SUBSTRING(
  TRANSLATE(MD5(RANDOM()::TEXT || id), 'olz', '023')
  FROM 1 FOR 6
))
WHERE "codigo" IS NULL;

ALTER TABLE "boloes" ALTER COLUMN "codigo" SET NOT NULL;

CREATE UNIQUE INDEX "boloes_codigo_key" ON "boloes"("codigo");
