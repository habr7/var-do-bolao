/**
 * Paginação de mensagens longas pro WhatsApp.
 *
 * O WhatsApp/Evolution corta (ou rejeita) texto acima de ~4096 chars.
 * Mensagens como "meus palpites" numa rodada de Copa (até 72 jogos),
 * a revelação de palpites de vários bolões e o broadcast podem passar
 * desse limite e sumir silenciosamente.
 *
 * `paginarBlocos` junta uma lista de blocos atômicos (linhas / blocos de
 * jogo já formatados) em N páginas, cada uma <= `limite`, sem quebrar um
 * bloco no meio. Se um único bloco já passa do limite, ele vai sozinho
 * numa página (best-effort — não há como dividir sem perder sentido).
 */
const LIMITE_PADRAO = 3500; // folga sob o teto de 4096 do WhatsApp

export function paginarBlocos(
  partes: string[],
  limite: number = LIMITE_PADRAO,
  separador = '\n',
): string[] {
  const paginas: string[] = [];
  let atual = '';
  for (const parte of partes) {
    if (atual === '') {
      atual = parte;
    } else if (atual.length + separador.length + parte.length <= limite) {
      atual += separador + parte;
    } else {
      paginas.push(atual);
      atual = parte;
    }
  }
  if (atual !== '') paginas.push(atual);
  return paginas;
}
