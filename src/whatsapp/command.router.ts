import { sendText } from './evolution.client.js';
import { Intencao, parseIntencao, parseMultiplePalpites } from './message.parser.js';
import {
  getSession,
  resetSession,
  setSession,
  updateSession,
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
    }

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

  // Ultimo recurso: resposta amigavel admitindo que nao entendeu
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
        text: '🎯 Qual o nome do bolão que você quer entrar?',
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
      await sendText({
        to: msg.waId,
        text: '🚧 Em construção — em breve disponível!\n\n' + menuTexto(),
      });
      return true;

    case Intencao.PALPITE_INLINE:
      await sendText({
        to: msg.waId,
        text: '⚽ Recebi um palpite, mas não há rodada aberta esperando por ele agora.\nEu te aviso quando houver jogos pra palpitar!',
      });
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

  await sendText({
    to: msg.waId,
    text:
      `🏆 Bolão *${bolao.nome}* criado com sucesso!\n` +
      `👑 Você é o admin.\n\n` +
      `Compartilhe o *nome* e a *senha* do bolão com quem você quer convidar.\n` +
      `Eles adicionam meu número, mandam *entrar em bolão* e informam nome + senha.\n` +
      `Os pedidos chegam aqui pra você aprovar.\n\n` +
      `Boa sorte, craque! ⚽`,
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
// Fluxo: ENTRAR EM BOLAO
// ============================================================
async function handleEntrandoNome(msg: IncomingMessage, usuarioId: string) {
  const nome = msg.text.trim();
  const bolao = await bolaoService.buscarBolaoAtivoPorNome(nome);
  if (!bolao) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `❌ Bolão "${nome}" não encontrado.\n\n${menuTexto()}`,
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

  // Notifica admin
  await sendText({
    to: bolao.admin.whatsappId,
    text:
      `🔔 *Novo pedido de entrada!*\n\n` +
      `👤 ${solicitacao.usuario.nome} quer entrar no bolão *${bolao.nome}*.\n\n` +
      `Pra aprovar: *!aprovar ${solicitacao.usuario.nome}*\n` +
      `Pra recusar: *!recusar ${solicitacao.usuario.nome}*`,
  });
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
      const admin = b.adminId === usuarioId ? '👑 _admin_' : '';
      return `• *${b.nome}* (${b.campeonatoNome}) ${admin}`;
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

  await sendText({
    to: msg.waId,
    text: `📋 *Pedidos pendentes:*\n\n${lista}\n\nUse *!aprovar NOME* ou *!recusar NOME*`,
  });
}

async function handleAprovar(msg: IncomingMessage, usuarioId: string, raw: string) {
  const nome = raw.replace(/^!aprovar\s+/i, '').trim();
  if (!nome) {
    await sendText({ to: msg.waId, text: '❌ Uso: *!aprovar NomeDoSolicitante*' });
    return;
  }

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
    await sendText({ to: msg.waId, text: '❌ Uso: *!recusar NomeDoSolicitante*' });
    return;
  }

  const pendente = await solicitacaoService.buscarPendentePorNome(usuarioId, nome);
  if (!pendente) {
    await sendText({ to: msg.waId, text: `❌ Não achei pedido pendente de "${nome}".` });
    return;
  }

  await solicitacaoService.recusarSolicitacao(pendente.id, usuarioId);

  await sendText({ to: msg.waId, text: `❌ Pedido de ${pendente.usuario.nome} recusado.` });
  await sendText({
    to: pendente.usuario.whatsappId,
    text: `😕 Seu pedido pra entrar no bolão *${pendente.bolao.nome}* foi recusado.`,
  });
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
    '• *entrar em bolão* — entro num bolão existente\n' +
    '• *meus bolões* — bolões que você participa\n' +
    '• *ranking* — ranking de um bolão\n' +
    '• *ajuda* — ver todos os comandos'
  );
}
