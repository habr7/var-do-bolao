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
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 30 chars

/**
 * Gera um codigo aleatorio. NAO checa unicidade no banco — caller (service)
 * eh responsavel por tentar novamente em caso de colisao.
 */
export function gerarCodigoBolao(tamanho = 6): string {
  let codigo = '';
  for (let i = 0; i < tamanho; i++) {
    codigo += ALFABETO[randomInt(0, ALFABETO.length)];
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
 *
 * Retorna o codigo normalizado em UPPER, ou null se nao achou.
 *
 * Estrategia: procura sequencia de 6 chars do alfabeto valido (sem
 * vogais ambiguas, sem 0/1) precedida por # OU em palavra isolada
 * que case 100% com o alfabeto.
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

  // Prioridade 2: palavra isolada que case 100% com o alfabeto E tenha
  // pelo menos UM digito. A exigencia de digito evita confundir codigo
  // com palavras naturais ("ENTRAR", "BOLAO", "QUERO" — todas formadas
  // por letras validas no nosso alfabeto). Codigos gerados aleatoriamente
  // em alfabeto de 30 chars (8 digitos) tem >99% chance de ter ao menos
  // um digito em 6 chars.
  const palavras = upper.split(/[^A-Z0-9]+/).filter(Boolean);
  for (const p of palavras) {
    if (p.length >= 4 && p.length <= 10 && codigoBate(p) && /\d/.test(p)) {
      return p;
    }
  }

  return null;
}

function codigoBate(s: string): boolean {
  // todos chars devem estar no alfabeto valido (ALFABETO)
  return [...s].every((c) => ALFABETO.includes(c));
}
