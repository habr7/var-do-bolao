/**
 * Helpers pra gerar a mensagem-convite que o admin encaminha pros convidados
 * + o link wa.me/<numero>?text=... que abre o WhatsApp do convidado ja com
 * a mensagem pre-preenchida pro numero do bot.
 *
 * Antes desta versao o admin recebia 2 mensagens (uma explicacao + outra
 * pronta pra encaminhar) e o convidado precisava abrir conversa com o bot
 * + colar a mensagem. Agora: 1 link unico. Convidado clica → WhatsApp abre
 * → manda a mensagem → entra no bolao. Atrito zero.
 *
 * O numero do bot vem de `env.WHATSAPP_BUSINESS_NUMBER` em formato amigavel
 * ("+55 11 97827-7516"). Aqui normaliza pra DDI+DDD+numero sem nada (formato
 * exigido pelo wa.me): `5511978277516`.
 */

/**
 * Extrai so digitos de uma string. Util pra normalizar telefone brasileiro
 * em qualquer formato.
 */
export function soDigitos(s: string): string {
  return (s || '').replace(/\D+/g, '');
}

/**
 * Constroi o link wa.me pre-preenchido. Retorna string vazia se o numero
 * do bot nao estiver configurado (env.WHATSAPP_BUSINESS_NUMBER vazio) —
 * caller decide o fallback.
 */
export function montarLinkWaMe(numeroBot: string, mensagem: string): string {
  const digitos = soDigitos(numeroBot);
  if (!digitos || digitos.length < 10) return '';
  const texto = encodeURIComponent(mensagem);
  return `https://wa.me/${digitos}?text=${texto}`;
}

/**
 * Gera a mensagem que o convidado vai mandar pro bot pra entrar no bolao.
 * Usa o ID curto (#K3MZ8P) — o admin nao precisa passar senha mais.
 */
export function montarTextoSolicitacaoEntrada(nomeBolao: string, codigoBolao: string): string {
  return `Quero entrar no bolão *${nomeBolao}* 🏆\nID: *#${codigoBolao}*`;
}

/**
 * Resultado da renderizacao do convite — pode ter link wa.me ou nao,
 * dependendo de o numero do bot estar configurado.
 */
export interface ConviteRenderizado {
  /** Texto principal pra mostrar pro admin, com link wa.me se disponivel. */
  textoPrincipal: string;
  /** Mensagem "limpa" pra encaminhar como fallback (sem link). */
  textoEncaminhavel: string;
  /** Link wa.me direto (vazio se WHATSAPP_BUSINESS_NUMBER nao setado). */
  linkWaMe: string;
}

/**
 * Monta as 2 mensagens do convite. Se o numero do bot estiver configurado,
 * a mensagem principal vem com o link clicavel — convidado clica e ja vai
 * pro WhatsApp do bot com mensagem pronta. Se nao, fallback no formato
 * antigo (admin encaminha a mensagem e o convidado abre conversa manual).
 *
 * Sempre devolve as 2 mensagens — caller manda como achar melhor.
 */
export function renderizarConvite(opts: {
  nomeBolao: string;
  codigoBolao: string;
  numeroBot: string;
}): ConviteRenderizado {
  const { nomeBolao, codigoBolao, numeroBot } = opts;
  const mensagemPraBot = montarTextoSolicitacaoEntrada(nomeBolao, codigoBolao);
  const linkWaMe = montarLinkWaMe(numeroBot, mensagemPraBot);

  let textoPrincipal: string;
  let textoEncaminhavel: string;

  if (linkWaMe) {
    // Caminho feliz: link clicavel. A mensagem fica curta e amigavel.
    // O ID continua visivel pra quem nao puder clicar.
    textoPrincipal =
      `Bora galera! 🏆 O bolão *${nomeBolao}* já tá pronto.\n\n` +
      `Pra entrar é só clicar no link abaixo (manda a mensagem que aparecer pro bot):\n\n` +
      `${linkWaMe}\n\n` +
      `_ID do bolão: *#${codigoBolao}*_`;
    // Versao "encaminhavel" — o admin pode preferir essa pra colar em grupo
    // sem texto explicativo do bot. Tem o link e o ID.
    textoEncaminhavel =
      `Bora pro bolão *${nomeBolao}* 🏆\n\n` +
      `Entra clicando aqui: ${linkWaMe}\n\n` +
      `_ID: *#${codigoBolao}*_`;
  } else {
    // Fallback: numero do bot nao configurado. Mantem o formato antigo
    // (convidado precisa abrir conversa manual e colar a mensagem).
    textoPrincipal =
      `📨 Pra convidar pro bolão *${nomeBolao}*:\n\n` +
      `Encaminha a mensagem abaixo pra galera, pedindo pra mandar ela pro número do *VAR do Bolão*. ` +
      `Quem mandar entra direto no bolão certo (sem confusão de nome parecido). 🤙`;
    textoEncaminhavel =
      `${mensagemPraBot}\n\n` +
      `_Manda esse texto pro número do VAR do Bolão — ele mesmo te coloca no bolão certo! ⚽_`;
  }

  return { textoPrincipal, textoEncaminhavel, linkWaMe };
}
