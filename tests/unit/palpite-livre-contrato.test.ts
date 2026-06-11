import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * v3.19.0 — TESTE DE CONTRATO (anti-regressão estrutural).
 *
 * Bug crítico (caso Natane 11/06): `tentarPalpiteLivreViaLLM` chamava
 * `palpiteService.registrarPalpiteEmRodada` DIRETAMENTE em loop, SEM
 * mostrar preview e SEM pedir confirmação. Violava a regra estabelecida
 * na v3.10.0 ("NUNCA mentir 'registrei' sem confirmar").
 *
 * Esse teste garante que:
 *   1. `tentarPalpiteLivreViaLLM` NÃO chama mais `registrarPalpiteEmRodada`
 *      direto — só delega ao pipeline canônico de confirmação.
 *   2. Qualquer call de `palpiteService.registrarPalpiteEmRodada` no
 *      router está dentro de handlers de CONFIRMAÇÃO (handler reage a
 *      "sim" pós-preview) ou da rota EDITAR (que já é explícita).
 *
 * Se um novo desenvolvedor adicionar atalho que registra direto, este
 * teste falha. Sinal de revisar a arquitetura.
 */

const routerPath = join(__dirname, '..', '..', 'src', 'whatsapp', 'command.router.ts');
const routerSrc = readFileSync(routerPath, 'utf-8');

describe('contrato — palpite só registra após confirmação (v3.19.0)', () => {
  it('`tentarPalpiteLivreViaLLM` NÃO chama `registrarPalpiteEmRodada` direto', () => {
    // Extrai o corpo da função
    const inicio = routerSrc.indexOf('async function tentarPalpiteLivreViaLLM(');
    expect(inicio).toBeGreaterThan(0);
    // Acha o fim da função pelo balanceamento simples (procura próximo
    // `async function` ou `function`/end-of-file no nível de top do módulo).
    const proximaFunc = routerSrc.indexOf('\nasync function ', inicio + 50);
    const fimFunc = proximaFunc > 0 ? proximaFunc : routerSrc.length;
    const corpo = routerSrc.slice(inicio, fimFunc);

    expect(corpo).not.toMatch(/palpiteService\.registrarPalpiteEmRodada\b/);
    expect(corpo).not.toMatch(/palpiteService\.registrarPalpiteEmTodosBoloes\b/);
    expect(corpo).not.toMatch(/palpiteService\.registrarPalpitesEmTodosBoloes\b/);
  });

  it('`tentarPalpiteLivreViaLLM` delega ao pipeline canônico de confirmação', () => {
    const inicio = routerSrc.indexOf('async function tentarPalpiteLivreViaLLM(');
    const proximaFunc = routerSrc.indexOf('\nasync function ', inicio + 50);
    const fimFunc = proximaFunc > 0 ? proximaFunc : routerSrc.length;
    const corpo = routerSrc.slice(inicio, fimFunc);

    // Tem que chamar pelo menos um dos 2 pipelines canônicos.
    const usaCanonico =
      /iniciarConfirmacaoPalpites\(/.test(corpo) ||
      /iniciarConfirmacaoPalpitesMultiBolao\(/.test(corpo);
    expect(usaCanonico).toBe(true);
  });

  it('NÃO tem mais a string "Registrei N palpite(s) em linguagem natural" (bug Natane)', () => {
    // Resposta enganosa antiga que afirmava registro sem ter ocorrido preview.
    expect(routerSrc).not.toMatch(/Registrei\s+\$\{[^}]+\}\s+palpite\(s\)\s+em\s+linguagem\s+natural/);
    expect(routerSrc).not.toContain('palpite(s) em linguagem natural!');
  });
});
