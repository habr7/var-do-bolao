import { randomInt } from 'node:crypto';

/**
 * Gerador de codigo curto pra identificar bolaes sem ambiguidade.
 *
 * Alfabeto sem chars confundiveis pra reduzir erro de digitacao:
 *   - sem 0/O, 1/I/L
 *   - so maiusculas + digitos restantes
 *
 * 6 chars de 30 simbolos = 30^6 ≈ 729M combinacoes.
 * Pra colisao virar problema precisariamos de ~27k bolaes (regra do aniversario);
 * antes disso a gente passa pra 7 chars. Por enquanto 6 esta otimo pra dar
 * mensagem curta e amigavel pra encaminhar no zap.
 */
const ALFABETO_GERACAO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 30 chars, restritivo

/**
 * Validacao do EXTRATOR — mais permissiva que o alfabeto de geracao.
 * Aceita qualquer [A-Z0-9] porque codigos legados (gerados em migration
 * via UPPER(MD5(...))) usam o alfabeto hex `0-9A-F` e podem conter 0, 1
 * e letras como I/L/O que estao FORA do alfabeto restritivo de geracao.
 *
 * Bug feedback 16/05: codigos tipo "AD71F3" (contem 1) eram rejeitados
 * pelo extrator porque o `1` nao estava no alfabeto restritivo. Resultado:
 * usuario colava mensagem-convite valida e bot dizia "nao achei". Aqui
 * relaxamos a validacao mantendo a geracao restrita — novos bolaes
 * continuam sem ambiguidade, legados ficam acessiveis.
 */
const ALFABETO_VALIDACAO_REGEX = /^[A-Z0-9]{4,10}$/;

/**
 * Gera um codigo aleatorio. NAO checa unicidade no banco — caller (service)
 * eh responsavel por tentar novamente em caso de colisao.
 *
 * Usa o alfabeto restritivo (sem 0/1/I/L/O) — codigos NOVOS sao sempre
 * sem ambiguidade visual. O extrator (`extrairCodigoBolao`) aceita mais
 * pra cobrir codigos legados.
 */
export function gerarCodigoBolao(tamanho = 6): string {
  let codigo = '';
  for (let i = 0; i < tamanho; i++) {
    codigo += ALFABETO_GERACAO[randomInt(0, ALFABETO_GERACAO.length)];
  }
  return codigo;
}

/**
 * Extrai um codigo de bolao de um texto livre do usuario.
 *
 * Aceita varios formatos:
 *   "#K3MZ8P"
 *   "K3MZ8P"
 *   "entrar K3MZ8P"
 *   "quero entrar no bolão #K3MZ8P — Família 2026"
 *   "K3MZ8P, senha minhasenha"
 *   "#AD71F3" (legado — contem 1, ainda assim valido)
 *
 * Retorna o codigo normalizado em UPPER, ou null se nao achou.
 *
 * Estrategia: procura sequencia de 4-10 chars [A-Z0-9] precedida por #
 * (prioridade 1) OU em palavra isolada que case + tenha ao menos um
 * digito (prioridade 2 — evita falso positivo com palavras tipo "BOLAO").
 */
export function extrairCodigoBolao(texto: string): string | null {
  if (!texto) return null;
  const upper = texto.toUpperCase();

  // Prioridade 1: codigo precedido por # (mais especifico, menos falsos
  // positivos quando o usuario mistura com nome ou outra coisa). Aceita
  // letras-soh quando tem # — risco de falso positivo baixo (usuario
  // escreveu # deliberadamente).
  const comHash = upper.match(/#([A-Z0-9]{4,10})\b/);
  if (comHash) {
    const candidato = comHash[1];
    if (codigoBate(candidato)) return candidato;
  }

  // Prioridade 2: palavra isolada que case [A-Z0-9]{4,10} E tenha
  // pelo menos UM digito. A exigencia de digito evita confundir codigo
  // com palavras naturais ("ENTRAR", "BOLAO", "QUERO"). Codigos gerados
  // aleatoriamente em alfabeto de 30 chars (8 digitos) tem >99% chance
  // de ter ao menos um digito em 6 chars. Codigos legados (hex MD5)
  // tambem tem digitos em quase todos os casos.
  const palavras = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const p of palavras) {
    if (codigoBate(p) && /\d/.test(p)) {
      return p;
    }
  }

  return null;
}

function codigoBate(s: string): boolean {
  return ALFABETO_VALIDACAO_REGEX.test(s);
}
