/**
 * Versão do app — fonte única. BUMP a cada release (manter alinhado com
 * `package.json` e o header de `VAR_DO_BOLAO_ARQUITETURA.md`).
 *
 * Onde aparece:
 *   - log de boot (`src/index.ts`) → `docker compose logs app | grep boot`
 *   - comando de dono "versão" / "#versao" no WhatsApp → confere o que está
 *     rodando em produção sem acessar o servidor.
 */
export const APP_VERSION = '3.47.0';
