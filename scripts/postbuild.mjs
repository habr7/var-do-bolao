/**
 * Copia arquivos nao-TS (JSON, fixtures) de src/ para dist/ apos o build.
 * Necessario porque tsc nao copia .json automaticamente.
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'src', 'data');
const dst = join(root, 'dist', 'data');

if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log(`✅ copiado: ${src} → ${dst}`);
}
