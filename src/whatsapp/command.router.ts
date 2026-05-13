import { sendText } from './evolution.client.js';
import { Intencao, parseIntencao, parseMultiplePalpites } from './message.parser.js';
import {
  getSession,
  resetSession,
  setSession,
  updateSession,
  abrirJanelaPalpiteLivre,
  janelaPalpiteLivreAtiva,
  fecharJanelaPalpiteLivre,
  type Session,
} from './session.manager.js';
import { env } from '../config/env.js';
import * as bolaoService from '../modules/bolao/bolao.service.js';
// PIX desativado nesta fase — ver handleCriandoBolaoSenha mais abaixo.
// import * as pagamentoService from '../modules/pagamento/pagamento.service.js';
import * as solicitacaoService from '../modules/solicitacao/solicitacao.service.js';
import * as palpiteService from '../modules/palpite/palpite.service.js';
import * as rankingService from '../modules/ranking/ranking.service.js';
import { classificarIntencao } from '../llm/intent.classifier.js';
import { extrairPalpites } from '../llm/palpite.extractor.js';
import { escolherBolaoDaLista, interpretarSimNao } from '../llm/bolao.matcher.js';
import { prisma } from '../config/database.js';
import { hashPassword, comparePassword, isValidPassword } from '../utils/password.js';
import { formatAjuda, formatRanking } from '../utils/formatting.js';
import { confirmacao, naoEntendi, resultadoEmoji } from '../utils/football.terms.js';
import { extrairCodigoBolao } from '../utils/bolao-codigo.js';
import { detectarAcaoAdmin, type AdminAcao } from './admin.parser.js';

export interface IncomingMessage {
  waId: string; // so digitos
  messageId: string;
  senderName: string;
  text: string;
}

/**
 * Ponto de entrada unico chamado pelo webhook handler. Decide o que fazer
 * baseado no estado atual da FSM + intencao detectada.
 */
export async function handleIncomingMessage(msg: IncomingMessage): Promise<void> {
  try {
    const usuario = await bolaoService.getOrCreateUsuario(msg.waId, msg.senderName);
    const session = await getSession(msg.waId);
    const parsed = parseIntencao(msg.text);

    // Cancelar sempre funciona — qualquer estado volta pra IDLE
    if (parsed.intencao === Intencao.CANCELAR) {
      await resetSession(msg.waId);
      await sendText({ to: msg.waId, text: '👍 Cancelado. O que quer fazer agora?\n\n' + menuTexto() });
      return;
    }

    // FAST-PATH: usuario colou a mensagem-convite ("quero entrar no bolão #K3MZ8P ...").
    // Detecta o codigo independente do estado atual (so quando NAO esta no
    // meio do fluxo de criar/palpitar — pra nao confundir senha com codigo).
    const codigoNaMsg = extrairCodigoBolao(msg.text);
    const podeAceitarCodigoAqui =
      session.state === 'IDLE' ||
      session.state === 'ENTRANDO_NOME';
    if (codigoNaMsg && podeAceitarCodigoAqui) {
      const handledByCodigo = await tentarEntrarPorCodigo(msg, usuario.id, codigoNaMsg);
      if (handledByCodigo) return;
    }

    // FSM ESCAPE: se admin tem pendentes E mandou claramente uma acao
    // admin (aprovar/recusar) E o estado atual eh "stale" (de outro fluxo
    // de leitura como ranking/palpites), reseta o estado pra processar a
    // aprovacao. Estados criticos (criando bolao, palpitando, confirmando
    // recusa em lote) NAO sao interrompidos.
    if (await escapouFsmStaleParaAcaoAdmin(msg, usuario.id, session)) {
      // session ja foi resetada dentro; recarrega
      const novaSession = await getSession(msg.waId);
      if (novaSession.state === 'IDLE') {
        // Re-encaminha pra logica IDLE (com state limpo)
        const acaoAdmin2 = await tentarAcaoAdminEmIdle(msg, usuario.id, parsed.intencao);
        if (acaoAdmin2) return;
        await handleIdle(msg, usuario.id, parsed.intencao, parsed.raw);
        return;
      }
    }

    // Estados com entrada de texto livre (sem comando explicito): tratados primeiro
    switch (session.state) {
      case 'CRIANDO_BOLAO_NOME':
        return await handleCriandoBolaoNome(msg, usuario.id);
      case 'CRIANDO_BOLAO_SENHA':
        return await handleCriandoBolaoSenha(msg, usuario.id, session);
      // PIX desativado — fluxo agora cria o bolao na hora, sem aguardar pagamento.
      // case 'CRIANDO_BOLAO_AGUARDANDO_PIX':
      //   return await handleCriandoBolaoAguardandoPix(msg);
      case 'ENTRANDO_NOME':
        return await handleEntrandoNome(msg, usuario.id);
      case 'ENTRANDO_SENHA':
        return await handleEntrandoSenha(msg, usuario.id, session);
      case 'PALPITANDO':
        return await handlePalpitando(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_RANKING':
        return await handleEscolhendoBolaoRanking(msg, session);
      case 'ESCOLHENDO_BOLAO_PALPITES':
        return await handleEscolhendoBolaoPalpites(msg, usuario.id, session);
      case 'CONFIRMANDO_VER_PALPITES':
        return await handleConfirmandoVerPalpites(msg, usuario.id, session);
      case 'CONFIRMANDO_APROVAR_TODOS':
        return await handleConfirmandoAprovarTodos(msg, usuario.id);
      case 'CONFIRMANDO_RECUSAR_TODOS':
        return await handleConfirmandoRecusarTodos(msg, usuario.id);
      case 'CONFIRMANDO_RECUSAR_NOMEADO':
        return await handleConfirmandoRecusarNomeado(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_PALPITE_INLINE':
        return await handleEscolhendoBolaoPalpiteInline(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_CONVITE':
        return await handleEscolhendoBolaoConvite(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_SAIR':
        return await handleEscolhendoBolaoSair(msg, usuario.id, session);
      case 'CONFIRMANDO_SAIR_BOLAO':
        return await handleConfirmandoSairBolao(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_PARTICIPANTES':
        return await handleEscolhendoBolaoParticipantes(msg, session);
    }

    // IDLE — verifica primeiro se admin tem pendentes e a mensagem
    // soa como acao de admin (aprovar/recusar em linguagem natural).
    // So intercepta se nao reconheceu intencao explicita ou se a
    // mensagem claramente eh resposta a aprovacao.
    const acaoAdmin = await tentarAcaoAdminEmIdle(msg, usuario.id, parsed.intencao);
    if (acaoAdmin) return;

    // IDLE — roteia pela intencao
    await handleIdle(msg, usuario.id, parsed.intencao, parsed.raw);
  } catch (error) {
    console.error('❌ Erro processando mensagem:', error);
    await sendText({
      to: msg.waId,
      text: (error as Error).message || '❌ Ops, algo deu errado. Tente novamente.',
    });
  }
}

// ============================================================
// IDLE — intencao inicial
// ============================================================
async function handleIdle(
  msg: IncomingMessage,
  usuarioId: string,
  intencao: Intencao,
  raw: string,
): Promise<void> {
  // JANELA DE PALPITE LIVRE: se o usuario acabou de ver "proximos jogos"
  // (TTL 5min), tenta extrair palpites em linguagem natural via LLM
  // ANTES de cair na intent normal. Cobre "2 a zero pra Brasil", "1 a 1
  // Coreia", etc — formatos que regex de palpite inline nao pega.
  if (intencao === Intencao.TEXTO_LIVRE && (await janelaPalpiteLivreAtiva(msg.waId))) {
    const aplicou = await tentarPalpiteLivreViaLLM(msg, usuarioId);
    if (aplicou) {
      await fecharJanelaPalpiteLivre(msg.waId);
      return;
    }
  }

  // Tenta despachar pela intencao detectada pelo regex
  const handled = await dispatchIntencao(msg, usuarioId, intencao, raw);
  if (handled) return;

  // Fallback: pede ao LLM pra classificar a mensagem em linguagem natural
  // antes de cair no "nao entendi". Se LLM retornar algo conhecido, despacha.
  const intencaoLLM = await classificarIntencao(msg.text);
  if (intencaoLLM && intencaoLLM !== Intencao.TEXTO_LIVRE) {
    const handledLLM = await dispatchIntencao(msg, usuarioId, intencaoLLM, raw);
    if (handledLLM) return;
  }

  // Ultimo recurso: resposta amigavel admitindo que nao entendeu.
  // Loga em formato facil de grep ([nao-entendi]) pra revisar depois.
  console.log(
    `[nao-entendi] waId=${msg.waId} regex_intent=${intencao} llm_intent=${intencaoLLM ?? 'null'} text=${JSON.stringify(msg.text.slice(0, 200))}`,
  );
  await sendText({
    to: msg.waId,
    text: `${naoEntendi()}\n\n${menuTexto()}`,
  });
}

/**
 * Roteia uma intencao especifica e devolve `true` se conseguiu agir, ou
 * `false` se a intencao nao mapeia em nada (caller decide fallback).
 */
async function dispatchIntencao(
  msg: IncomingMessage,
  usuarioId: string,
  intencao: Intencao,
  raw: string,
): Promise<boolean> {
  switch (intencao) {
    case Intencao.SAUDACAO:
    case Intencao.MENU:
      await sendText({ to: msg.waId, text: boasVindasTexto(msg.senderName) });
      return true;

    case Intencao.AJUDA:
      await sendText({ to: msg.waId, text: formatAjuda(env.BOT_PREFIX) });
      return true;

    case Intencao.CRIAR_BOLAO:
      await setSession(msg.waId, { state: 'CRIANDO_BOLAO_NOME', ctx: {} });
      await sendText({
        to: msg.waId,
        text: '⚽ Bora criar um bolão novo!\n\nComo você quer chamar?\n_(ex: Bolão da Firma, Copa dos Amigos…)_',
      });
      return true;

    case Intencao.ENTRAR_BOLAO:
      await setSession(msg.waId, { state: 'ENTRANDO_NOME', ctx: {} });
      await sendText({
        to: msg.waId,
        text:
          '🎯 Pra entrar, manda o *ID do bolão* (aquele tipo `#K3MZ8P` que o admin compartilhou).\n\n' +
          '_Se não tiver o ID, pode mandar o nome — mas com ID é mais rápido e sem risco de errar de bolão._',
      });
      return true;

    case Intencao.MEUS_BOLOES:
      await handleMeusBoloes(msg, usuarioId);
      return true;

    case Intencao.RANKING:
      await handleRanking(msg, usuarioId, raw);
      return true;

    case Intencao.APROVAR:
      await handleAprovar(msg, usuarioId, raw);
      return true;

    case Intencao.RECUSAR:
      await handleRecusar(msg, usuarioId, raw);
      return true;

    case Intencao.PENDENTES:
      await handlePendentes(msg, usuarioId);
      return true;

    case Intencao.MEU_PALPITE:
    case Intencao.MEUS_PONTOS:
      await handleMeusPalpites(msg, usuarioId);
      return true;

    case Intencao.JOGOS_HOJE:
    case Intencao.PROXIMOS_JOGOS:
      await handleProximosJogos(msg, usuarioId);
      return true;

    case Intencao.ABRIR_RODADA:
      await handleAbrirRodada(msg, usuarioId);
      return true;

    case Intencao.COMO_CONVIDAR:
      await handleComoConvidar(msg, usuarioId);
      return true;

    case Intencao.SAIR_BOLAO:
      await handleSairBolao(msg, usuarioId);
      return true;

    case Intencao.QUEM_PARTICIPA:
      await handleQuemParticipa(msg, usuarioId);
      return true;

    case Intencao.PALPITE_INLINE:
      await handlePalpiteInlineEmIdle(msg, usuarioId);
      return true;

    default:
      return false;
  }
}

// ============================================================
// Fluxo: CRIAR BOLAO
// ============================================================
async function handleCriandoBolaoNome(msg: IncomingMessage, _usuarioId: string) {
  const nome = msg.text.trim();
  if (nome.length < 3 || nome.length > 60) {
    await sendText({ to: msg.waId, text: '⚠️ Nome deve ter entre 3 e 60 caracteres. Tenta de novo:' });
    return;
  }

  // Verifica se ja existe bolao ativo com mesmo nome (globalmente)
  const existente = await bolaoService.buscarBolaoAtivoPorNome(nome);
  if (existente) {
    await sendText({
      to: msg.waId,
      text: `⚠️ Já existe um bolão ativo chamado "${nome}". Escolhe outro nome:`,
    });
    return;
  }

  await updateSession(msg.waId, { state: 'CRIANDO_BOLAO_SENHA', ctxPatch: { nomeBolao: nome } });
  await sendText({
    to: msg.waId,
    text: `✅ Nome: *${nome}*\n\nAgora define uma *senha* (mínimo 6 caracteres).\nEssa senha é pra quem quiser entrar no bolão:`,
  });
}

async function handleCriandoBolaoSenha(msg: IncomingMessage, usuarioId: string, session: Session) {
  const senha = msg.text.trim();
  if (!isValidPassword(senha)) {
    await sendText({ to: msg.waId, text: '⚠️ Senha deve ter entre 6 e 100 caracteres. Tenta de novo:' });
    return;
  }

  const nomeBolao = session.ctx?.nomeBolao;
  if (!nomeBolao) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Sessão expirou. Envie *criar bolão* pra começar de novo.' });
    return;
  }

  const senhaHash = await hashPassword(senha);

  // PIX DESATIVADO nesta fase — bolao criado de graca pra ganhar tracao.
  // Quando reativar pagamento, voltar a chamar `pagamentoService.gerarCobranca`
  // e setar o estado CRIANDO_BOLAO_AGUARDANDO_PIX.
  const bolao = await bolaoService.criarBolao({
    nome: nomeBolao,
    senhaHash,
    adminId: usuarioId,
    campeonatoId: env.DEFAULT_CAMPEONATO,
    campeonatoNome: 'Copa do Mundo FIFA 2026 — Fase de Grupos',
  });

  await resetSession(msg.waId);

  // Mensagem 1: confirmacao + explicacao do "convite encaminhavel".
  await sendText({
    to: msg.waId,
    text:
      `🏆 Bolão *${bolao.nome}* criado, craque!\n` +
      `👑 Você é o admin.\n\n` +
      `🎟️ *ID do bolão:* \`#${bolao.codigo}\`\n` +
      `🔒 *Senha:* (a que você acabou de definir)\n\n` +
      `📨 Pra convidar gente, encaminha a mensagem abaixo. Quem mandar ela pro meu número entra direto no bolão certo, sem confusão de nome parecido. Depois você passa a senha pra cada um (em particular). 🤙`,
  });

  // Mensagem 2: convite pronto pra encaminhar (uma mensagem separada
  // facilita "manter pressionado → encaminhar").
  await sendText({
    to: msg.waId,
    text:
      `Olá! Quero entrar no bolão *${bolao.nome}* 🏆\n` +
      `ID: *#${bolao.codigo}*\n\n` +
      `Manda esse texto pro número *${env.WHATSAPP_BUSINESS_NUMBER || 'do VAR do Bolão'}* — eu mesmo te coloco no bolão certo! ⚽`,
  });
}

// PIX desativado — handler abaixo nao eh mais chamado, mas fica como referencia
// para quando o pagamento for reativado.
//
// async function handleCriandoBolaoAguardandoPix(msg: IncomingMessage) {
//   await sendText({
//     to: msg.waId,
//     text: '⏳ Ainda aguardando seu PIX cair. Assim que confirmar, eu te aviso!\n_Digite "cancelar" pra abortar._',
//   });
// }

// ============================================================
// Fast-path: usuario colou a mensagem-convite ("...#K3MZ8P...")
// ============================================================
/**
 * Tenta entrar no bolao identificado pelo codigo curto. Eh chamado tanto
 * a partir do estado IDLE (usuario encaminhou a mensagem do admin) quanto
 * de ENTRANDO_NOME (usuario digitou o ID no fluxo normal).
 *
 * Retorna `true` se conseguiu identificar o bolao (entrou no fluxo de
 * senha OU avisou que ja participa). Retorna `false` se o codigo nao
 * casou com nenhum bolao ativo — nesse caso, caller deve seguir com o
 * processamento normal (pode ser que o "codigo" detectado tenha sido
 * falso positivo, tipo o usuario mandou "ABACAXI").
 */
async function tentarEntrarPorCodigo(
  msg: IncomingMessage,
  usuarioId: string,
  codigo: string,
): Promise<boolean> {
  const bolao = await bolaoService.buscarBolaoAtivoPorCodigo(codigo);
  if (!bolao) return false;

  // Curto-circuito se ja participa ou eh admin (mesma logica do fluxo normal)
  if (bolao.adminId === usuarioId) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `👑 Você é o admin do bolão *${bolao.nome}* — já faz parte!\n\n${menuTexto()}`,
    });
    return true;
  }

  const jaParticipa = await bolaoService.ehParticipante(usuarioId, bolao.id);
  if (jaParticipa) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `✅ Você já está no bolão *${bolao.nome}*! Bom jogo!\n\n${menuTexto()}`,
    });
    return true;
  }

  const pendente = await prisma.solicitacaoEntrada.findFirst({
    where: { usuarioId, bolaoId: bolao.id, status: 'PENDENTE' },
  });
  if (pendente) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `⏳ Seu pedido pra entrar no *${bolao.nome}* já foi enviado — esperando o admin aprovar.\n\n${menuTexto()}`,
    });
    return true;
  }

  // Pula direto pra senha — ja achou o bolao certo pelo codigo.
  await setSession(msg.waId, {
    state: 'ENTRANDO_SENHA',
    ctx: { bolaoId: bolao.id, nomeBolao: bolao.nome },
  });
  await sendText({
    to: msg.waId,
    text:
      `🎯 Achei o bolão *${bolao.nome}* (\`#${bolao.codigo}\`).\n\n` +
      `Manda a *senha* que o admin te passou pra eu confirmar sua entrada:`,
  });
  return true;
}

// ============================================================
// Fluxo: ENTRAR EM BOLAO
// ============================================================
async function handleEntrandoNome(msg: IncomingMessage, usuarioId: string) {
  const texto = msg.text.trim();

  // Tenta achar codigo primeiro (caminho preferido, sem ambiguidade).
  // Se nada bater, cai pra busca por nome.
  const codigo = extrairCodigoBolao(texto);
  let bolao = codigo ? await bolaoService.buscarBolaoAtivoPorCodigo(codigo) : null;

  if (!bolao) {
    bolao = await bolaoService.buscarBolaoAtivoPorNome(texto);
  }

  if (!bolao) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text:
        `❌ Não achei nenhum bolão com isso.\n\n` +
        `Confere com o admin se o *ID* (formato \`#K3MZ8P\`) ou o nome estão certinhos e tenta de novo.\n\n${menuTexto()}`,
    });
    return;
  }

  // Curto-circuita se o usuario ja faz parte (admin OU participante OU
  // ja tem solicitacao pendente) — evita pedir senha desnecessariamente
  // e o erro feio "Voce ja esta neste bolao." que vinha depois.
  if (bolao.adminId === usuarioId) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `👑 Você é o admin do bolão *${bolao.nome}* — ja faz parte!\n\n${menuTexto()}`,
    });
    return;
  }

  const jaParticipa = await bolaoService.ehParticipante(usuarioId, bolao.id);
  if (jaParticipa) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `✅ Você já faz parte do bolão *${bolao.nome}*! Bom jogo!\n\n${menuTexto()}`,
    });
    return;
  }

  const pendente = await prisma.solicitacaoEntrada.findFirst({
    where: { usuarioId, bolaoId: bolao.id, status: 'PENDENTE' },
  });
  if (pendente) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `⏳ Você já pediu pra entrar no bolão *${bolao.nome}* — esperando o admin aprovar.\n\n${menuTexto()}`,
    });
    return;
  }

  await updateSession(msg.waId, { state: 'ENTRANDO_SENHA', ctxPatch: { bolaoId: bolao.id, nomeBolao: bolao.nome } });
  await sendText({
    to: msg.waId,
    text: `🔒 Bolão *${bolao.nome}* encontrado.\nQual a senha?`,
  });
}

async function handleEntrandoSenha(msg: IncomingMessage, usuarioId: string, session: Session) {
  const senha = msg.text.trim();
  const bolaoId = session.ctx?.bolaoId;
  if (!bolaoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Sessão expirou. Envie *entrar em bolão* pra começar.' });
    return;
  }

  const bolao = await bolaoService.buscarBolaoAtivoPorNome(session.ctx?.nomeBolao ?? '');
  if (!bolao) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Bolão não encontrado. Tente novamente.' });
    return;
  }

  const ok = await comparePassword(senha, bolao.senhaHash);
  if (!ok) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Senha incorreta. Tente novamente mais tarde.' });
    return;
  }

  // Cria solicitacao
  const solicitacao = await solicitacaoService.criarSolicitacao(usuarioId, bolao.id);

  await resetSession(msg.waId);
  await sendText({
    to: msg.waId,
    text:
      `✅ Senha correta!\n\n📤 Seu pedido foi enviado ao admin do bolão.\n` +
      `Assim que ele aprovar, eu te aviso e você já começa a receber os jogos! 🏆`,
  });

  // Notifica admin com instrucoes em linguagem natural. Se ele ja tem
  // varios pendentes, adiciona dica do "aprovar todos".
  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(bolao.adminId);

  let textoAdmin =
    `🔔 *Novo pedido de entrada!*\n\n` +
    `👤 *${solicitacao.usuario.nome}* quer entrar no bolão *${bolao.nome}*.\n\n` +
    `Responde com:\n` +
    `• *aprovado* — pra liberar a entrada\n` +
    `• *recusar* — pra rejeitar`;

  if (totalPendentes >= 3) {
    textoAdmin +=
      `\n\n💡 _Você tem ${totalPendentes} pedidos pendentes acumulados. Pode mandar *aprovar todos* pra liberar todo mundo de uma vez, ou me dizer só os nomes que quer recusar._`;
  } else if (totalPendentes > 1) {
    textoAdmin += `\n\n_(Você tem ${totalPendentes} pedidos pendentes no total. Manda *!pendentes* pra ver a lista.)_`;
  }

  await sendText({ to: bolao.admin.whatsappId, text: textoAdmin });
}

// ============================================================
// Fluxo: PALPITAR (setado pelo job send-daily-games)
// ============================================================
async function handlePalpitando(msg: IncomingMessage, usuarioId: string, session: Session) {
  const rodadaId = session.ctx?.rodadaId;
  if (!rodadaId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '⏳ Sessão de palpite expirou.\n\n' + menuTexto() });
    return;
  }

  // 1a tentativa: parser regex (rapido). Se nada, tenta LLM em linguagem natural.
  let palpites = parseMultiplePalpites(msg.text);

  if (palpites.length === 0) {
    const rodada = await prisma.rodada.findUnique({
      where: { id: rodadaId },
      include: { jogos: true },
    });
    if (rodada && rodada.jogos.length > 0) {
      palpites = await extrairPalpites(
        msg.text,
        rodada.jogos.map((j) => ({ timeCasa: j.timeCasa, timeVisitante: j.timeVisitante })),
      );
    }
  }

  if (palpites.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '🤔 Não consegui identificar nenhum palpite aí.\n\n' +
        'Tenta no formato: *Time1 NxN Time2*\n_ex: Flamengo 2x1 Palmeiras_\n\n' +
        'Ou em linguagem natural mesmo, tipo "_acho que o brasil ganha de 3 a 1_".',
    });
    return;
  }

  let registrados = 0;
  const erros: string[] = [];
  for (const p of palpites) {
    try {
      await palpiteService.registrarPalpiteEmRodada({
        usuarioId,
        rodadaId,
        timeCasa: p.timeCasa,
        timeVisitante: p.timeVisitante,
        golsCasa: p.golsCasa,
        golsVisitante: p.golsVisitante,
      });
      registrados++;
    } catch (e) {
      erros.push(`• ${p.timeCasa} x ${p.timeVisitante}: ${(e as Error).message}`);
    }
  }

  const { faltam, completo } = await palpiteService.statusPalpitesRodada(usuarioId, rodadaId);

  let resposta = `${confirmacao()} ${registrados} palpite(s) registrado(s)!`;
  if (erros.length > 0) resposta += `\n\n⚠️ Não rolou:\n${erros.join('\n')}`;

  if (completo) {
    resposta += '\n\n🔒 Todos os palpites desta rodada registrados! Boa sorte! 🍀';
    await resetSession(msg.waId);
  } else {
    resposta += `\n\nAinda faltam ${faltam} jogo(s). Manda quando puder!`;
  }

  await sendText({ to: msg.waId, text: resposta });
}

// ============================================================
// Fluxo: PALPITE INLINE EM IDLE
// ============================================================
/**
 * Usuario mandou "Brasil 2x1 Marrocos" sem estar em PALPITANDO. Procura
 * em todas as rodadas abertas dos bolaes do usuario onde o jogo bate.
 *
 * - 1 match: registra direto.
 * - >1 matches (mesmo jogo em multiplos bolaes do usuario): pergunta qual.
 * - 0 matches: explica que nao achou.
 */
async function handlePalpiteInlineEmIdle(msg: IncomingMessage, usuarioId: string) {
  // Caso multi-linha: tenta extrair varios palpites de uma vez. Cada
  // linha vira uma busca por jogo aberto + registro.
  const todosPalpites = parseMultiplePalpites(msg.text);
  if (todosPalpites.length > 1) {
    await handleMultiPalpiteInlineEmIdle(msg, usuarioId, todosPalpites);
    return;
  }

  const parsed = parseIntencao(msg.text);
  if (!parsed.palpite) {
    // Nao deveria cair aqui se intencao=PALPITE_INLINE, mas blindagem
    await sendText({ to: msg.waId, text: '🤔 Não captei o palpite, manda no formato *Time1 NxN Time2*.' });
    return;
  }
  const p = parsed.palpite;

  const matches = await palpiteService.buscarBoloesComJogo(
    usuarioId,
    p.timeCasa,
    p.timeVisitante,
  );

  if (matches.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        `🤔 Não achei o jogo *${p.timeCasa} x ${p.timeVisitante}* em rodada aberta de nenhum dos seus bolões.\n\n` +
        `Confere se o jogo já está disponível pra palpite com *próximos jogos*.`,
    });
    return;
  }

  if (matches.length === 1) {
    const m = matches[0];
    await registrarPalpiteInline(msg, usuarioId, m, p.golsCasa, p.golsVisitante);
    return;
  }

  // Multiplos bolaes com o mesmo jogo — pergunta
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PALPITE_INLINE',
    ctx: {
      boloesParaEscolher: matches.map((m) => ({ id: m.bolaoId, nome: m.bolaoNome })),
      palpiteInlinePendente: {
        timeCasa: p.timeCasa,
        timeVisitante: p.timeVisitante,
        golsCasa: p.golsCasa,
        golsVisitante: p.golsVisitante,
      },
    },
  });

  const lista = matches.map((m) => `• *${m.bolaoNome}* (\`#${m.bolaoCodigo}\`)`).join('\n');
  await sendText({
    to: msg.waId,
    text:
      `🤔 Esse jogo está aberto em mais de um bolão seu. Pra qual você quer registrar o palpite *${p.timeCasa} ${p.golsCasa}x${p.golsVisitante} ${p.timeVisitante}*?\n\n${lista}\n\n_(Manda o nome do bolão. Pra registrar em todos, manda *todos*.)_`,
  });
}

/**
 * Multi-palpite em IDLE: usuario mandou varias linhas de palpite de uma
 * vez (depois de "proximos jogos"). Pra cada palpite, busca em qual
 * bolao registrar e tenta. Se acabar com ambiguidade em qualquer, avisa
 * pra usuario refazer aquele especifico.
 */
async function handleMultiPalpiteInlineEmIdle(
  msg: IncomingMessage,
  usuarioId: string,
  palpites: Array<{ timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number }>,
) {
  let registrados = 0;
  const erros: string[] = [];
  const ambiguos: string[] = [];

  for (const p of palpites) {
    const matches = await palpiteService.buscarBoloesComJogo(
      usuarioId,
      p.timeCasa,
      p.timeVisitante,
    );
    if (matches.length === 0) {
      erros.push(`• ${p.timeCasa} x ${p.timeVisitante}: jogo não encontrado em rodada aberta`);
      continue;
    }
    if (matches.length > 1) {
      ambiguos.push(`• ${p.timeCasa} x ${p.timeVisitante} (existe em ${matches.length} bolões)`);
      continue;
    }
    const m = matches[0];
    try {
      await palpiteService.registrarPalpiteEmRodada({
        usuarioId,
        rodadaId: m.rodadaId,
        timeCasa: m.jogoTimeCasa,
        timeVisitante: m.jogoTimeVisitante,
        golsCasa: p.golsCasa,
        golsVisitante: p.golsVisitante,
      });
      registrados++;
    } catch (err) {
      erros.push(`• ${p.timeCasa} x ${p.timeVisitante}: ${(err as Error).message}`);
    }
  }

  let resposta =
    registrados > 0
      ? `${confirmacao()} ${registrados} palpite(s) registrado(s)!`
      : '⚠️ Não consegui registrar nenhum palpite.';
  if (erros.length > 0) resposta += `\n\n⚠️ Não rolou:\n${erros.join('\n')}`;
  if (ambiguos.length > 0) {
    resposta += `\n\n🤔 Estes jogos existem em múltiplos bolões seus — manda um de cada vez pra escolher:\n${ambiguos.join('\n')}`;
  }
  await sendText({ to: msg.waId, text: resposta });
}

async function handleEscolhendoBolaoPalpiteInline(msg: IncomingMessage, usuarioId: string, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  const pendente = session.ctx?.palpiteInlinePendente;
  if (opcoes.length === 0 || !pendente) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda o palpite de novo.' });
    return;
  }

  // "todos" → registra em todos os bolaes
  if (/^todos?\b/i.test(msg.text.trim())) {
    await resetSession(msg.waId);
    let okCount = 0;
    const matches = await palpiteService.buscarBoloesComJogo(
      usuarioId,
      pendente.timeCasa,
      pendente.timeVisitante,
    );
    for (const m of matches) {
      try {
        await palpiteService.registrarPalpiteEmRodada({
          usuarioId,
          rodadaId: m.rodadaId,
          timeCasa: m.jogoTimeCasa,
          timeVisitante: m.jogoTimeVisitante,
          golsCasa: pendente.golsCasa,
          golsVisitante: pendente.golsVisitante,
        });
        okCount++;
      } catch (err) {
        console.warn('[palpite-inline-todos] erro:', (err as Error).message);
      }
    }
    await sendText({
      to: msg.waId,
      text: `✅ Palpite *${pendente.timeCasa} ${pendente.golsCasa}x${pendente.golsVisitante} ${pendente.timeVisitante}* registrado em ${okCount} bolão(s)! 🍀`,
    });
    return;
  }

  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei qual bolão. Manda o nome de um destes ou *todos*:\n\n${lista}`,
    });
    return;
  }

  await resetSession(msg.waId);
  const matches = await palpiteService.buscarBoloesComJogo(
    usuarioId,
    pendente.timeCasa,
    pendente.timeVisitante,
  );
  const escolhidoMatch = matches.find((m) => m.bolaoId === escolhido.id);
  if (!escolhidoMatch) {
    await sendText({
      to: msg.waId,
      text: `❌ Não consegui registrar o palpite no bolão *${escolhido.nome}*. Tenta de novo.`,
    });
    return;
  }
  await registrarPalpiteInline(
    msg,
    usuarioId,
    escolhidoMatch,
    pendente.golsCasa,
    pendente.golsVisitante,
  );
}

/**
 * Tenta extrair palpites em linguagem natural usando o LLM, dentro da
 * janela de palpite livre aberta apos "proximos jogos". Itera os
 * bolaes do usuario e roda o extrator com a lista de jogos da rodada
 * aberta de cada um. Se conseguiu registrar algum palpite, retorna true.
 *
 * Funciona pra coisas que regex nao pega:
 *   - "2 a zero pra Africa"     (1 time, com extenso)
 *   - "1 a 1 Coreia"            (1 time)
 *   - "brasil ganha de 3"       (placar parcial)
 *   - varias linhas misturadas
 */
async function tentarPalpiteLivreViaLLM(
  msg: IncomingMessage,
  usuarioId: string,
): Promise<boolean> {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  let totalRegistrados = 0;
  const erros: string[] = [];
  const palpitesPorBolao: Array<{ nome: string; count: number }> = [];

  for (const b of boloes) {
    const rodada = await prisma.rodada.findFirst({
      where: { bolaoId: b.id, status: 'ABERTA' },
      include: { jogos: { where: { status: { in: ['AGENDADO', 'AO_VIVO'] } } } },
    });
    if (!rodada || rodada.jogos.length === 0) continue;

    const palpites = await extrairPalpites(
      msg.text,
      rodada.jogos.map((j) => ({ timeCasa: j.timeCasa, timeVisitante: j.timeVisitante })),
    );
    if (palpites.length === 0) continue;

    let countBolao = 0;
    for (const p of palpites) {
      try {
        await palpiteService.registrarPalpiteEmRodada({
          usuarioId,
          rodadaId: rodada.id,
          timeCasa: p.timeCasa,
          timeVisitante: p.timeVisitante,
          golsCasa: p.golsCasa,
          golsVisitante: p.golsVisitante,
        });
        countBolao++;
        totalRegistrados++;
      } catch (err) {
        erros.push(`• ${p.timeCasa} x ${p.timeVisitante}: ${(err as Error).message}`);
      }
    }
    if (countBolao > 0) palpitesPorBolao.push({ nome: b.nome, count: countBolao });
  }

  if (totalRegistrados === 0) return false;

  const resumo = palpitesPorBolao.map((p) => `• ${p.count} palpite(s) em *${p.nome}*`).join('\n');
  let resposta = `${confirmacao()} Registrei ${totalRegistrados} palpite(s) em linguagem natural!\n\n${resumo}`;
  if (erros.length > 0) resposta += `\n\n⚠️ Não rolou:\n${erros.join('\n')}`;
  await sendText({ to: msg.waId, text: resposta });
  return true;
}

async function registrarPalpiteInline(
  msg: IncomingMessage,
  usuarioId: string,
  match: { bolaoId: string; bolaoNome: string; rodadaId: string; jogoTimeCasa: string; jogoTimeVisitante: string },
  golsCasa: number,
  golsVisitante: number,
) {
  try {
    await palpiteService.registrarPalpiteEmRodada({
      usuarioId,
      rodadaId: match.rodadaId,
      timeCasa: match.jogoTimeCasa,
      timeVisitante: match.jogoTimeVisitante,
      golsCasa,
      golsVisitante,
    });
    const { faltam } = await palpiteService.statusPalpitesRodada(usuarioId, match.rodadaId);
    let resp = `${confirmacao()} Palpite registrado no *${match.bolaoNome}*:\n` +
      `*${match.jogoTimeCasa} ${golsCasa} x ${golsVisitante} ${match.jogoTimeVisitante}* ⚽`;
    if (faltam > 0) {
      resp += `\n\nFaltam ${faltam} jogo(s) nessa rodada — manda quando quiser.`;
    } else {
      resp += '\n\n🔒 Todos os palpites desta rodada registrados! Boa sorte! 🍀';
    }
    await sendText({ to: msg.waId, text: resp });
  } catch (err) {
    await sendText({
      to: msg.waId,
      text: `❌ Não consegui registrar: ${(err as Error).message}`,
    });
  }
}

// ============================================================
// Fluxo: ABRIR_RODADA (admin)
// ============================================================
/**
 * Admin perguntou "abrir rodada". Como a rodada eh criada automaticamente
 * no `criarBolao` (seed FIFA), na maioria dos casos ja esta aberta. Aqui
 * a gente:
 *   1. Lista bolaes em que ele eh admin.
 *   2. Pra cada um, checa se ja tem rodada ABERTA.
 *   3. Resposta clara: "X ja esta aberta com N jogos / vou abrir Y / aqui sao todas".
 *
 * Versao mais simples por enquanto: nao re-cria rodada se faltou. Apenas
 * informa o estado e direciona pra "proximos jogos".
 */
async function handleAbrirRodada(msg: IncomingMessage, usuarioId: string) {
  const adminados = await prisma.bolao.findMany({
    where: { adminId: usuarioId, status: 'ATIVO' },
    include: { rodadas: { orderBy: { numero: 'desc' }, take: 1, include: { jogos: true } } },
  });

  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '🤷 Só admin de bolão pode abrir/iniciar rodada. Você ainda não é admin de nenhum.\n\n' +
        'Para criar um bolão: *criar bolão*\n' +
        'Para palpitar nos jogos: *próximos jogos*',
    });
    return;
  }

  const partes: string[] = [];
  for (const b of adminados) {
    const rodada = b.rodadas[0];
    if (rodada && rodada.status === 'ABERTA') {
      partes.push(
        `✅ *${b.nome}* — Rodada ${rodada.numero} já está aberta com *${rodada.jogos.length}* jogo(s).`,
      );
    } else if (rodada) {
      partes.push(
        `⏸️ *${b.nome}* — última rodada (${rodada.numero}) está *${rodada.status.toLowerCase()}*.`,
      );
    } else {
      partes.push(`⚠️ *${b.nome}* — ainda não tem rodada. Recrie o bolão ou avise o suporte.`);
    }
  }

  await sendText({
    to: msg.waId,
    text:
      `📅 *Status das rodadas dos seus bolões:*\n\n${partes.join('\n')}\n\n` +
      `_Pra ver os jogos pendentes, manda *próximos jogos*._\n` +
      `_Os palpites são aceitos até o início de cada jogo automaticamente._`,
  });
}

// ============================================================
// Fluxo: COMO_CONVIDAR (admin reenvia convite-encaminhavel)
// ============================================================
async function handleComoConvidar(msg: IncomingMessage, usuarioId: string) {
  const adminados = await prisma.bolao.findMany({
    where: { adminId: usuarioId, status: 'ATIVO' },
    select: { id: true, nome: true, codigo: true },
    orderBy: { criadoEm: 'desc' },
  });

  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '🤷 Só o admin do bolão pode convidar.\n\nVocê ainda não criou nenhum bolão.\nPara criar: *criar bolão*',
    });
    return;
  }

  if (adminados.length === 1) {
    await enviarConvitePraBolao(msg, adminados[0]);
    return;
  }

  // Múltiplos bolões — pergunta qual
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_CONVITE',
    ctx: { boloesParaEscolher: adminados.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = adminados.map((b) => `• *${b.nome}* (\`#${b.codigo}\`)`).join('\n');
  await sendText({
    to: msg.waId,
    text: `📨 Pra qual bolão você quer o convite?\n\n${lista}`,
  });
}

async function handleEscolhendoBolaoConvite(msg: IncomingMessage, usuarioId: string, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *como convido* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o nome de um destes:\n\n${lista}`,
    });
    return;
  }
  // Busca codigo completo
  const bolao = await prisma.bolao.findUnique({
    where: { id: escolhido.id },
    select: { id: true, nome: true, codigo: true, adminId: true },
  });
  if (!bolao || bolao.adminId !== usuarioId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Não consegui achar esse bolão.' });
    return;
  }
  await resetSession(msg.waId);
  await enviarConvitePraBolao(msg, bolao);
}

async function enviarConvitePraBolao(
  msg: IncomingMessage,
  bolao: { nome: string; codigo: string },
) {
  await sendText({
    to: msg.waId,
    text:
      `📨 *Pra convidar gente pro bolão "${bolao.nome}"*:\n\n` +
      `Encaminha a mensagem abaixo pra galera, pedindo pra mandar ela no meu número *${env.WHATSAPP_BUSINESS_NUMBER || 'do VAR do Bolão'}*. Quem mandar entra direto no bolão certo (sem confusão de nome parecido). Depois você passa a senha pra cada um em particular.`,
  });
  // Mensagem 2 (separada pra facilitar encaminhar)
  await sendText({
    to: msg.waId,
    text:
      `Olá! Quero entrar no bolão *${bolao.nome}* 🏆\n` +
      `ID: *#${bolao.codigo}*\n\n` +
      `Manda esse texto pro número *${env.WHATSAPP_BUSINESS_NUMBER || 'do VAR do Bolão'}* — eu mesmo te coloco no bolão certo! ⚽`,
  });
}

// ============================================================
// Fluxo: SAIR_BOLAO
// ============================================================
async function handleSairBolao(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  // So pode sair de bolaes que ele NAO eh admin (admin nao pode sair do
  // proprio bolao via este fluxo — teria que excluir o bolao)
  const elegiveis = boloes.filter((b) => b.adminId !== usuarioId);

  if (elegiveis.length === 0) {
    if (boloes.length > 0) {
      await sendText({
        to: msg.waId,
        text:
          '🤷 Você só é admin dos seus bolões — admin não sai assim. Pra encerrar o bolão, fale com o suporte (em breve teremos *!excluir bolão*).',
      });
    } else {
      await sendText({ to: msg.waId, text: '📭 Você não participa de nenhum bolão pra sair.' });
    }
    return;
  }

  if (elegiveis.length === 1) {
    await pedirConfirmacaoSairBolao(msg, elegiveis[0]);
    return;
  }

  // Múltiplos — pergunta qual
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_SAIR',
    ctx: { boloesParaEscolher: elegiveis.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = elegiveis.map((b) => `• *${b.nome}*`).join('\n');
  await sendText({
    to: msg.waId,
    text: `De qual bolão você quer sair?\n\n${lista}`,
  });
}

async function handleEscolhendoBolaoSair(msg: IncomingMessage, usuarioId: string, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *sair do bolão* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({ to: msg.waId, text: `🤔 Não identifiquei. Manda o nome de um destes:\n\n${lista}` });
    return;
  }
  void usuarioId;
  await pedirConfirmacaoSairBolao(msg, escolhido);
}

async function pedirConfirmacaoSairBolao(msg: IncomingMessage, bolao: { id: string; nome: string }) {
  await setSession(msg.waId, {
    state: 'CONFIRMANDO_SAIR_BOLAO',
    ctx: { bolaoId: bolao.id, nomeBolao: bolao.nome },
  });
  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai sair do bolão *${bolao.nome}* mesmo? Seus palpites ficam salvos pra histórico, mas você não recebe mais notificações de jogos.\n\n` +
      `_Responde *sim* pra confirmar ou *não* pra cancelar._`,
  });
}

async function handleConfirmandoSairBolao(msg: IncomingMessage, usuarioId: string, session: Session) {
  const bolaoId = session.ctx?.bolaoId;
  const nomeBolao = session.ctx?.nomeBolao ?? 'o bolão';
  if (!bolaoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *sair do bolão* de novo.' });
    return;
  }
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: `👍 Beleza, você segue no *${nomeBolao}*.` });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({ to: msg.waId, text: `🤔 Manda *sim* pra confirmar a saída ou *não* pra cancelar.` });
    return;
  }
  await resetSession(msg.waId);
  await prisma.participacao.deleteMany({ where: { usuarioId, bolaoId } });
  await sendText({
    to: msg.waId,
    text: `👋 Você saiu do bolão *${nomeBolao}*. Foi divertido! Quando quiser voltar, manda *entrar em bolão*.`,
  });
}

// ============================================================
// Fluxo: QUEM_PARTICIPA
// ============================================================
async function handleQuemParticipa(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({ to: msg.waId, text: '📭 Você não participa de nenhum bolão.' });
    return;
  }

  if (boloes.length === 1) {
    await enviarListaParticipantes(msg, boloes[0].id, boloes[0].nome);
    return;
  }

  // Múltiplos — pergunta
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PARTICIPANTES',
    ctx: { boloesParaEscolher: boloes.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = boloes.map((b) => `• *${b.nome}*`).join('\n');
  await sendText({
    to: msg.waId,
    text: `De qual bolão você quer ver os participantes?\n\n${lista}`,
  });
}

async function handleEscolhendoBolaoParticipantes(msg: IncomingMessage, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *quem participa* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({ to: msg.waId, text: `🤔 Não identifiquei. Manda o nome de um destes:\n\n${lista}` });
    return;
  }
  await resetSession(msg.waId);
  await enviarListaParticipantes(msg, escolhido.id, escolhido.nome);
}

async function enviarListaParticipantes(msg: IncomingMessage, bolaoId: string, nomeBolao: string) {
  const participacoes = await prisma.participacao.findMany({
    where: { bolaoId },
    include: { usuario: true, bolao: { select: { adminId: true } } },
    orderBy: { entradaEm: 'asc' },
  });

  if (participacoes.length === 0) {
    await sendText({ to: msg.waId, text: `📭 Ninguém ainda no bolão *${nomeBolao}*.` });
    return;
  }

  const lista = participacoes
    .map((p) => {
      const ehAdmin = p.bolao?.adminId === p.usuarioId;
      return `• ${p.usuario.nome}${ehAdmin ? ' 👑' : ''}`;
    })
    .join('\n');
  await sendText({
    to: msg.waId,
    text: `🏆 *Quem está no ${nomeBolao}* (${participacoes.length}):\n\n${lista}`,
  });
}

// ============================================================
// Comandos IDLE auxiliares
// ============================================================
async function handleMeusBoloes(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '📭 Você não participa de nenhum bolão ativo ainda.\n\nPara entrar: *entrar em bolão*\nPara criar: *criar bolão*',
    });
    return;
  }

  const lista = boloes
    .map((b) => {
      const admin = b.adminId === usuarioId ? ' 👑 _admin_' : '';
      // Mostra o codigo so quando o usuario eh admin — pra ele poder
      // reenviar o convite. Pra participante o codigo nao agrega muito
      // (ele ja esta dentro).
      const idLinha =
        b.adminId === usuarioId
          ? `\n   _ID:_ \`#${b.codigo}\``
          : '';
      return `• *${b.nome}* (${b.campeonatoNome})${admin}${idLinha}`;
    })
    .join('\n');

  await sendText({ to: msg.waId, text: `🏆 *Seus bolões:*\n\n${lista}` });
}

async function handleRanking(msg: IncomingMessage, usuarioId: string, raw: string) {
  // raw comeca com "ranking ..." — extrai nome
  const nomeBolao = raw.replace(/^ranking\s*/i, '').trim();
  const boloesDoUsuario = await bolaoService.listarBoloesDoUsuario(usuarioId);

  let bolaoId: string | null = null;

  if (nomeBolao) {
    // Tenta achar entre os bolaoes do usuario primeiro (mais provavel),
    // depois busca global. Aceita variacao de case/acentos.
    const dosBoloes = await escolherBolaoDaLista(
      nomeBolao,
      boloesDoUsuario.map((b) => ({ id: b.id, nome: b.nome })),
    );
    if (dosBoloes) {
      bolaoId = dosBoloes.id;
    } else {
      const b = await bolaoService.buscarBolaoAtivoPorNome(nomeBolao);
      if (b) bolaoId = b.id;
    }
    if (!bolaoId) {
      await sendText({ to: msg.waId, text: `❌ Bolão "${nomeBolao}" não encontrado.` });
      return;
    }
  } else {
    if (boloesDoUsuario.length === 0) {
      await sendText({ to: msg.waId, text: '📭 Você não participa de nenhum bolão ativo.' });
      return;
    }
    if (boloesDoUsuario.length > 1) {
      // Setai estado pro proximo turno entender que o texto eh a escolha
      await setSession(msg.waId, {
        state: 'ESCOLHENDO_BOLAO_RANKING',
        ctx: {
          boloesParaEscolher: boloesDoUsuario.map((b) => ({ id: b.id, nome: b.nome })),
        },
      });
      const lista = boloesDoUsuario.map((b) => `• *${b.nome}*`).join('\n');
      await sendText({
        to: msg.waId,
        text: `Você está em vários bolões. De qual deles você quer ver o ranking?\n\n${lista}`,
      });
      return;
    }
    bolaoId = boloesDoUsuario[0].id;
  }

  await enviarRankingDoBolao(msg.waId, bolaoId);
}

async function enviarRankingDoBolao(waId: string, bolaoId: string) {
  const dados = await rankingService.getRankingPorBolao(bolaoId);
  const texto = formatRanking(dados.bolao.nome, dados.rodadaAtual, dados.bolao.campeonatoNome, dados.ranking);
  await sendText({ to: waId, text: texto });
}

async function handleEscolhendoBolaoRanking(msg: IncomingMessage, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *ranking* de novo.' });
    return;
  }

  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei qual bolão. Diz o nome de um destes:\n\n${lista}`,
    });
    return;
  }

  await resetSession(msg.waId);
  await enviarRankingDoBolao(msg.waId, escolhido.id);
}

async function handlePendentes(msg: IncomingMessage, usuarioId: string) {
  const pendentes = await solicitacaoService.listarPendentesDoAdmin(usuarioId);
  if (pendentes.length === 0) {
    await sendText({ to: msg.waId, text: '📭 Nenhum pedido pendente.' });
    return;
  }

  const lista = pendentes
    .map((p) => `• ${p.usuario.nome} → ${p.bolao.nome}`)
    .join('\n');

  let resposta = `📋 *Pedidos pendentes:*\n\n${lista}\n\n`;
  if (pendentes.length === 1) {
    resposta +=
      `Responde com *aprovado* pra liberar ou *recusar* pra rejeitar.`;
  } else {
    resposta +=
      `Manda *aprovar todos* pra liberar todo mundo de uma vez,\n` +
      `ou diz *aprovar NOME* / *recusar NOME* pra cada um.`;
  }
  await sendText({ to: msg.waId, text: resposta });
}

async function handleAprovar(msg: IncomingMessage, usuarioId: string, raw: string) {
  // Aceita formatos: "!aprovar NOME", "aprovar NOME", "aprovado NOME"
  const nome = raw
    .replace(/^!?\s*(?:aprovar|aprovado|aprovo|aprova)\s+/i, '')
    .trim();
  if (!nome) {
    await sendText({ to: msg.waId, text: '❌ Manda: *aprovar NomeDoSolicitante*' });
    return;
  }
  await aprovarPorNome(msg, usuarioId, nome);
}

async function aprovarPorNome(msg: IncomingMessage, usuarioId: string, nome: string) {
  const pendente = await solicitacaoService.buscarPendentePorNome(usuarioId, nome);
  if (!pendente) {
    await sendText({ to: msg.waId, text: `❌ Não achei pedido pendente de "${nome}".` });
    return;
  }

  await solicitacaoService.aprovarSolicitacao(pendente.id, usuarioId);

  await sendText({
    to: msg.waId,
    text: `✅ ${pendente.usuario.nome} aprovado no bolão ${pendente.bolao.nome}!`,
  });
  // Notifica o solicitante
  await sendText({
    to: pendente.usuario.whatsappId,
    text: `🎉 Boa notícia! Você foi aprovado no bolão *${pendente.bolao.nome}*! ⚽\n\nNos próximos jogos eu te mando direto aqui pra palpitar.`,
  });
}

async function handleRecusar(msg: IncomingMessage, usuarioId: string, raw: string) {
  const nome = raw.replace(/^!recusar\s+/i, '').trim();
  if (!nome) {
    await sendText({ to: msg.waId, text: '❌ Manda: *recusar NomeDoSolicitante*' });
    return;
  }
  await pedirConfirmacaoRecusar(msg, usuarioId, nome);
}

/**
 * Pede confirmacao antes de recusar — recusa eh irreversivel via UI atual,
 * entao vale o sim/nao pra evitar acidente. Aprovar nao precisa confirmar
 * porque eh o caminho feliz e o admin pode aprovar errado depois sem dano
 * (mas recusar tira o cara do bolao silenciosamente).
 */
async function pedirConfirmacaoRecusar(
  msg: IncomingMessage,
  usuarioId: string,
  nome: string,
) {
  const pendente = await solicitacaoService.buscarPendentePorNome(usuarioId, nome);
  if (!pendente) {
    await sendText({ to: msg.waId, text: `❌ Não achei pedido pendente de "${nome}".` });
    return;
  }

  await setSession(msg.waId, {
    state: 'CONFIRMANDO_RECUSAR_NOMEADO',
    ctx: {
      solicitacaoIdParaConfirmar: pendente.id,
      nomeSolicitanteParaConfirmar: pendente.usuario.nome,
      nomeBolaoSolicitacao: pendente.bolao.nome,
    },
  });

  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai recusar *${pendente.usuario.nome}* no bolão *${pendente.bolao.nome}*?\n\n` +
      `_Responde *sim* pra confirmar ou *não* pra cancelar._`,
  });
}

// ============================================================
// Fluxo: AÇÃO DE ADMIN EM IDLE (linguagem natural)
// ============================================================
/**
 * Roteia uma mensagem em IDLE quando o usuario tem pendentes:
 *   - "aprovado fulano" → aprova direto
 *   - "recusar fulano" → pede confirmacao
 *   - "aprovar todos" → pede confirmacao em lote
 *   - "aprovado" / "ok" / "sim" sem nome:
 *       - se ha 1 pendente: aprova esse
 *       - se ha varios: lista e instrui
 *   - "recusar" / "nao" sem nome: idem mas pra recusa
 *
 * Retorna `true` se interceptou (entao caller nao processa o caminho IDLE
 * normal). `false` significa "passa pra dispatcher de intencoes normal".
 *
 * Importante: o parser do admin so dispara se ja existem pendentes — pra
 * "sim" / "ok" / "aprovado" nao virarem acoes fantasma quando o admin
 * abriu uma conversa do nada.
 */
/**
 * Se o admin esta num estado FSM "stale" (de outro fluxo de leitura, tipo
 * ESCOLHENDO_BOLAO_RANKING/PALPITES) e mandou claramente uma acao admin
 * (aprovar/recusar), reseta a sessao pra deixar o handler IDLE processar.
 *
 * Estados criticos (CRIANDO_BOLAO_*, ENTRANDO_*, PALPITANDO, CONFIRMANDO_*)
 * NAO sao interrompidos — o admin pode estar no meio de algo que precisa
 * terminar antes.
 *
 * Retorna true se reseta o estado.
 */
async function escapouFsmStaleParaAcaoAdmin(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
): Promise<boolean> {
  // States que sao "leitura/escolha" e podem ser interrompidos
  const ESTADOS_INTERROMPIVEIS = new Set<string>([
    'ESCOLHENDO_BOLAO_RANKING',
    'ESCOLHENDO_BOLAO_PALPITES',
    'CONFIRMANDO_VER_PALPITES',
  ]);
  if (!ESTADOS_INTERROMPIVEIS.has(session.state)) return false;

  // So escapa se ha pendentes pra agir
  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(usuarioId);
  if (totalPendentes === 0) return false;

  // So escapa se a mensagem realmente parece acao admin
  const acao = detectarAcaoAdmin(msg.text);
  if (!acao) return false;

  console.log(
    `[fsm-escape] usuario=${usuarioId} state=${session.state} acao=${acao.tipo} pendentes=${totalPendentes} — resetando`,
  );
  await resetSession(msg.waId);
  return true;
}

async function tentarAcaoAdminEmIdle(
  msg: IncomingMessage,
  usuarioId: string,
  intencaoDetectada: Intencao,
): Promise<boolean> {
  // Otimizacao: contar pendentes evita query pesada quando nao tem nada
  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(usuarioId);
  if (totalPendentes === 0) return false;

  // Se a mensagem ja foi reconhecida como intencao explicita do bot (criar
  // bolao, ranking, etc), NAO interceptar — o admin pode querer outra coisa
  // mesmo tendo pendentes. So intercepta TEXTO_LIVRE OU intencoes que se
  // confundem com aprovacao (SAUDACAO/MENU geralmente nao confundem, mas
  // SAUDACAO sim em casos tipo "tranquilo, libera").
  const intencoesQueNaoCedem = new Set<Intencao>([
    Intencao.CRIAR_BOLAO,
    Intencao.ENTRAR_BOLAO,
    Intencao.MEUS_BOLOES,
    Intencao.RANKING,
    Intencao.MEUS_PONTOS,
    Intencao.MEU_PALPITE,
    Intencao.JOGOS_HOJE,
    Intencao.PROXIMOS_JOGOS,
    Intencao.AJUDA,
    Intencao.PENDENTES,
    Intencao.PALPITE_INLINE,
  ]);
  if (intencoesQueNaoCedem.has(intencaoDetectada)) return false;

  const acao = detectarAcaoAdmin(msg.text);
  if (!acao) return false;

  await despacharAcaoAdmin(msg, usuarioId, acao, totalPendentes);
  return true;
}

async function despacharAcaoAdmin(
  msg: IncomingMessage,
  usuarioId: string,
  acao: AdminAcao,
  totalPendentes: number,
): Promise<void> {
  switch (acao.tipo) {
    case 'APROVAR_TODOS':
      await pedirConfirmacaoAprovarTodos(msg, totalPendentes);
      return;

    case 'RECUSAR_TODOS':
      await pedirConfirmacaoRecusarTodos(msg, totalPendentes);
      return;

    case 'APROVAR_NOMEADO':
      await aprovarPorNome(msg, usuarioId, acao.nome);
      return;

    case 'RECUSAR_NOMEADO':
      await pedirConfirmacaoRecusar(msg, usuarioId, acao.nome);
      return;

    case 'AFIRMATIVO_GENERICO': {
      if (totalPendentes === 1) {
        const [unico] = await solicitacaoService.listarPendentesDoAdmin(usuarioId);
        await aprovarPorNome(msg, usuarioId, unico.usuario.nome);
        return;
      }
      // Multiplos pendentes — instrui
      const pendentes = await solicitacaoService.listarPendentesDoAdmin(usuarioId);
      const lista = pendentes
        .map((p) => `• ${p.usuario.nome} → ${p.bolao.nome}`)
        .join('\n');
      await sendText({
        to: msg.waId,
        text:
          `🤔 Você tem *${totalPendentes} pedidos pendentes*. De qual você quer aprovar?\n\n` +
          `${lista}\n\n` +
          `Pra liberar todo mundo de uma vez, manda *aprovar todos*.\n` +
          `Pra um especifico: *aprovar NOME*.`,
      });
      return;
    }

    case 'NEGATIVO_GENERICO': {
      if (totalPendentes === 1) {
        const [unico] = await solicitacaoService.listarPendentesDoAdmin(usuarioId);
        await pedirConfirmacaoRecusar(msg, usuarioId, unico.usuario.nome);
        return;
      }
      const pendentes = await solicitacaoService.listarPendentesDoAdmin(usuarioId);
      const lista = pendentes
        .map((p) => `• ${p.usuario.nome} → ${p.bolao.nome}`)
        .join('\n');
      await sendText({
        to: msg.waId,
        text:
          `🤔 Você tem *${totalPendentes} pedidos pendentes*. Qual você quer recusar?\n\n` +
          `${lista}\n\n` +
          `Manda *recusar NOME* (eu peço confirmação antes).`,
      });
      return;
    }
  }
}

async function pedirConfirmacaoAprovarTodos(msg: IncomingMessage, total: number) {
  if (total === 0) {
    await sendText({ to: msg.waId, text: '📭 Nenhum pedido pendente.' });
    return;
  }
  await setSession(msg.waId, { state: 'CONFIRMANDO_APROVAR_TODOS', ctx: {} });
  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai aprovar *${total}* pedido(s) de uma vez. Confirma?\n\n` +
      `_Responde *sim* pra liberar todo mundo, ou *não* pra cancelar._`,
  });
}

async function pedirConfirmacaoRecusarTodos(msg: IncomingMessage, total: number) {
  if (total === 0) {
    await sendText({ to: msg.waId, text: '📭 Nenhum pedido pendente.' });
    return;
  }
  await setSession(msg.waId, { state: 'CONFIRMANDO_RECUSAR_TODOS', ctx: {} });
  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai *recusar* todos os ${total} pedidos pendentes. Confirma?\n\n` +
      `_Responde *sim* pra recusar todo mundo, ou *não* pra cancelar._`,
  });
}

// ============================================================
// Estados de confirmacao (admin)
// ============================================================
async function handleConfirmandoAprovarTodos(msg: IncomingMessage, usuarioId: string) {
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Beleza, cancelei. Nenhum pedido foi aprovado.' });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: '🤔 Manda *sim* pra confirmar a aprovação em lote, ou *não* pra cancelar.',
    });
    return;
  }

  await resetSession(msg.waId);
  const aprovadas = await solicitacaoService.aprovarTodosPendentes(usuarioId);
  if (aprovadas.length === 0) {
    await sendText({ to: msg.waId, text: '📭 Nenhum pedido foi aprovado (lista vazia agora).' });
    return;
  }

  // Notifica cada solicitante
  await Promise.all(
    aprovadas.map((sol) =>
      sendText({
        to: sol.usuario.whatsappId,
        text: `🎉 Boa notícia! Você foi aprovado no bolão *${sol.bolao.nome}*! ⚽\n\nNos próximos jogos eu te mando direto aqui pra palpitar.`,
      }).catch(() => undefined),
    ),
  );

  const nomes = aprovadas.map((s) => `• ${s.usuario.nome} → ${s.bolao.nome}`).join('\n');
  await sendText({
    to: msg.waId,
    text: `✅ Aprovados ${aprovadas.length} pedido(s):\n\n${nomes}`,
  });
}

async function handleConfirmandoRecusarTodos(msg: IncomingMessage, usuarioId: string) {
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Beleza, cancelei. Nenhum pedido foi recusado.' });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: '🤔 Manda *sim* pra confirmar a recusa em lote, ou *não* pra cancelar.',
    });
    return;
  }

  await resetSession(msg.waId);
  const recusadas = await solicitacaoService.recusarTodosPendentes(usuarioId);
  if (recusadas.length === 0) {
    await sendText({ to: msg.waId, text: '📭 Nenhum pedido foi recusado (lista vazia agora).' });
    return;
  }

  await Promise.all(
    recusadas.map((sol) =>
      sendText({
        to: sol.usuario.whatsappId,
        text: `😕 Seu pedido pra entrar no bolão *${sol.bolao.nome}* foi recusado.`,
      }).catch(() => undefined),
    ),
  );

  const nomes = recusadas.map((s) => `• ${s.usuario.nome} → ${s.bolao.nome}`).join('\n');
  await sendText({
    to: msg.waId,
    text: `❌ Recusados ${recusadas.length} pedido(s):\n\n${nomes}`,
  });
}

async function handleConfirmandoRecusarNomeado(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const solicitacaoId = session.ctx?.solicitacaoIdParaConfirmar;
  const nomeSolicitante = session.ctx?.nomeSolicitanteParaConfirmar;
  const nomeBolao = session.ctx?.nomeBolaoSolicitacao;
  if (!solicitacaoId || !nomeSolicitante) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *!pendentes* pra começar de novo.' });
    return;
  }

  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `👍 Cancelei a recusa. *${nomeSolicitante}* segue pendente — pode mandar *aprovado* quando decidir.`,
    });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: `🤔 Manda *sim* pra confirmar que vai recusar *${nomeSolicitante}*, ou *não* pra cancelar.`,
    });
    return;
  }

  await resetSession(msg.waId);
  await solicitacaoService.recusarSolicitacao(solicitacaoId, usuarioId);

  await sendText({
    to: msg.waId,
    text: `❌ Pedido de *${nomeSolicitante}* recusado${nomeBolao ? ` (bolão ${nomeBolao})` : ''}.`,
  });

  // Notifica o solicitante (best-effort: precisamos do whatsappId)
  const sol = await prisma.solicitacaoEntrada.findUnique({
    where: { id: solicitacaoId },
    include: { usuario: true, bolao: true },
  });
  if (sol) {
    await sendText({
      to: sol.usuario.whatsappId,
      text: `😕 Seu pedido pra entrar no bolão *${sol.bolao.nome}* foi recusado.`,
    }).catch(() => undefined);
  }
}

// ============================================================
// Fluxo: PROXIMOS JOGOS / JOGOS HOJE
// ============================================================
/**
 * Lista os jogos pendentes que o usuario ainda nao palpitou, agregados
 * pelos bolaes em que ele participa. Mostra ate ~10 proximos jogos por
 * bolao pra nao estourar 4kb do WhatsApp. Se nao houver rodada aberta
 * em lugar nenhum, explica que nao tem jogo aberto pra palpite agora.
 */
async function handleProximosJogos(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '📭 Você não participa de nenhum bolão ainda.\n\nPara entrar: *entrar em bolão*',
    });
    return;
  }

  const agora = new Date();
  const partes: string[] = [];

  for (const b of boloes) {
    // Pega a rodada mais recente ABERTA pra esse bolao (caso geral em
    // Copa: uma rodada so com varios jogos espalhados ao longo da fase).
    const rodada = await prisma.rodada.findFirst({
      where: { bolaoId: b.id, status: 'ABERTA' },
      include: {
        jogos: {
          where: { dataHora: { gte: agora }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
          orderBy: { dataHora: 'asc' },
          take: 10,
        },
      },
    });

    if (!rodada || rodada.jogos.length === 0) continue;

    // Quais jogos o usuario ja palpitou?
    const palpite = await prisma.palpite.findUnique({
      where: { usuarioId_rodadaId: { usuarioId, rodadaId: rodada.id } },
      include: { jogos: true },
    });
    const palpitadosIds = new Set(palpite?.jogos.map((p) => p.jogoId) ?? []);

    const linhas = rodada.jogos.map((j) => {
      const data = j.dataHora.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const marcado = palpitadosIds.has(j.id) ? '✅' : '⚪';
      return `${marcado} ${data} — ${j.timeCasa} x ${j.timeVisitante}`;
    });

    const faltam = rodada.jogos.filter((j) => !palpitadosIds.has(j.id)).length;
    partes.push(
      `🏆 *${b.nome}*\n` +
      linhas.join('\n') +
      (faltam > 0 ? `\n_Faltam *${faltam}* palpite(s) — manda no formato \`Time1 NxN Time2\` pra registrar._` : '\n_Todos os palpites desta rodada já estão registrados! 🍀_'),
    );
  }

  if (partes.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '⚽ Não tem rodada aberta com jogos pendentes nos seus bolões agora.\n\n' +
        'Eu te aviso assim que abrir a próxima rodada pra palpite. 🍀',
    });
    return;
  }

  await sendText({
    to: msg.waId,
    text: `📅 *Próximos jogos:*\n\n${partes.join('\n\n')}\n\n_✅ = você já palpitou • ⚪ = falta palpitar_\n\n💡 _Pode mandar palpites de qualquer formato: "Brasil 2x1 Marrocos", "Brasil 2 a 1 Marrocos", ou ate "2 a zero pra Brasil contra Marrocos"._`,
  });

  // Abre janela de palpite livre — proximas msgs em IDLE serao
  // testadas via LLM extrator mesmo se nao casarem regex.
  await abrirJanelaPalpiteLivre(msg.waId);
}

// ============================================================
// Fluxo: MEUS PALPITES / MEUS PONTOS
// ============================================================
async function handleMeusPalpites(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '📭 Você não participa de nenhum bolão ainda.\n\nPara entrar: *entrar em bolão*',
    });
    return;
  }

  if (boloes.length === 1) {
    await mostrarPontuacaoEPerguntarPalpites(msg, usuarioId, boloes[0].id, boloes[0].nome);
    return;
  }

  // Mais de 1 bolao — pergunta qual
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PALPITES',
    ctx: {
      boloesParaEscolher: boloes.map((b) => ({ id: b.id, nome: b.nome })),
    },
  });
  const lista = boloes.map((b) => `• *${b.nome}*`).join('\n');
  await sendText({
    to: msg.waId,
    text: `Você está em vários bolões. De qual você quer ver os pontos?\n\n${lista}`,
  });
}

async function handleEscolhendoBolaoPalpites(msg: IncomingMessage, usuarioId: string, session: Session) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *meus palpites* de novo.' });
    return;
  }

  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((b) => `• *${b.nome}*`).join('\n');
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei qual bolão. Diz o nome de um destes:\n\n${lista}`,
    });
    return;
  }

  await mostrarPontuacaoEPerguntarPalpites(msg, usuarioId, escolhido.id, escolhido.nome);
}

async function mostrarPontuacaoEPerguntarPalpites(
  msg: IncomingMessage,
  usuarioId: string,
  bolaoId: string,
  nomeBolao: string,
) {
  const meusDados = await rankingService.getMeusPontosNoBolao(usuarioId, bolaoId);
  const totalPalpites = meusDados.rodadas.reduce((acc, r) => acc + r.jogos.length, 0);

  const texto =
    `📊 *Sua pontuação no ${nomeBolao}*\n\n` +
    `Total geral: *${meusDados.pontuacaoTotal} pts*\n` +
    (meusDados.posicaoAtual > 0 ? `Posição: ${meusDados.posicaoAtual}º\n` : '') +
    `Palpites registrados: ${totalPalpites}\n\n` +
    `Quer ver todos os seus palpites detalhados? _(responda sim ou não)_`;

  await setSession(msg.waId, {
    state: 'CONFIRMANDO_VER_PALPITES',
    ctx: { bolaoId, nomeBolao },
  });
  await sendText({ to: msg.waId, text: texto });
}

async function handleConfirmandoVerPalpites(msg: IncomingMessage, usuarioId: string, session: Session) {
  const bolaoId = session.ctx?.bolaoId;
  const nomeBolao = session.ctx?.nomeBolao ?? '';
  if (!bolaoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *meus palpites* de novo.' });
    return;
  }

  const resposta = await interpretarSimNao(msg.text);

  if (resposta === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Beleza! Volta quando quiser.\n\n' + menuTexto() });
    return;
  }

  if (resposta !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: '🤔 Não entendi se é sim ou não. Manda *sim* ou *não*.',
    });
    return;
  }

  // Mostra todos os palpites do usuario nesse bolao com resultado oficial
  const detalhes = await rankingService.getMeusPontosNoBolao(usuarioId, bolaoId);
  if (detalhes.rodadas.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Você ainda não palpitou em nenhum jogo deste bolão.' });
    return;
  }

  await resetSession(msg.waId);

  // Monta a mensagem por rodada
  const partes: string[] = [`📋 *Seus palpites — ${nomeBolao}*\n`];
  for (const rodada of detalhes.rodadas) {
    if (rodada.jogos.length === 0) continue;
    partes.push(`*Rodada ${rodada.rodada.numero}*${rodada.calculado ? ` (${rodada.pontuacao} pts)` : ''}`);
    for (const pj of rodada.jogos) {
      const j = pj.jogo;
      const meu = `${pj.golsCasa}x${pj.golsVisitante}`;
      const oficial = j.golsCasa !== null && j.golsVisitante !== null
        ? `${j.golsCasa}x${j.golsVisitante}`
        : null;

      let linha = `• ${j.timeCasa} ${meu} ${j.timeVisitante}`;
      if (oficial) {
        const emoji = resultadoEmoji(pj.pontosObtidos);
        linha += `\n   ↳ oficial: *${oficial}* ${emoji} (${pj.pontosObtidos} pts)`;
      } else if (j.status === 'AGENDADO') {
        linha += `\n   ↳ _ainda não rolou_`;
      } else if (j.status === 'AO_VIVO') {
        linha += `\n   ↳ _ao vivo_`;
      }
      partes.push(linha);
    }
    partes.push('');
  }
  partes.push(`Total: *${detalhes.pontuacaoTotal} pts*`);

  // WhatsApp aceita ate ~4096 chars; em geral cabe. Se passar, paginamos no futuro.
  await sendText({ to: msg.waId, text: partes.join('\n') });
}

// ============================================================
// Textos utilitarios
// ============================================================
function boasVindasTexto(nome: string): string {
  return (
    `👋 Opa ${nome}! Sou o *VAR do Bolão* ⚽\n\n` +
    'Aqui você pode criar bolões, entrar em bolões existentes e palpitar nos jogos.\n\n' +
    menuTexto()
  );
}

function menuTexto(): string {
  return (
    '*O que você quer fazer?*\n\n' +
    '• *criar bolão* — crio um novo bolão (gratuito!)\n' +
    '• *entrar em bolão* — pode me mandar o ID (\\`#ABCD12\\`) ou o nome\n' +
    '• *meus bolões* — bolões que você participa\n' +
    '• *próximos jogos* — jogos abertos pra palpite\n' +
    '• *meus palpites* — palpites que já dei e pontuação\n' +
    '• *como convido* — pegar a mensagem-convite (admin)\n' +
    '• *quem participa* — lista de quem está no bolão\n' +
    '• *ranking* — ranking de um bolão\n' +
    '• *sair do bolão* — sair de algum bolão\n' +
    '• *ajuda* — ver todos os comandos\n\n' +
    '_Fala comigo no zap mesmo. Aceito palpite em qualquer formato: "Brasil 2x1 Marrocos", "Brasil 2 a 1 Marrocos", "2 a zero pra Brasil". E entendo perguntas tipo "quais meus palpites?", "tem jogo hoje?", "quem ta na frente?"._'
  );
}
