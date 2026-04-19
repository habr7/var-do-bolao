import { sendText } from './meta.client.js';
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
import * as pagamentoService from '../modules/pagamento/pagamento.service.js';
import * as solicitacaoService from '../modules/solicitacao/solicitacao.service.js';
import * as palpiteService from '../modules/palpite/palpite.service.js';
import * as rankingService from '../modules/ranking/ranking.service.js';
import { hashPassword, comparePassword, isValidPassword } from '../utils/password.js';
import { formatAjuda, formatRanking } from '../utils/formatting.js';
import { confirmacao } from '../utils/football.terms.js';

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
      case 'CRIANDO_BOLAO_AGUARDANDO_PIX':
        return await handleCriandoBolaoAguardandoPix(msg);
      case 'ENTRANDO_NOME':
        return await handleEntrandoNome(msg, usuario.id);
      case 'ENTRANDO_SENHA':
        return await handleEntrandoSenha(msg, usuario.id, session);
      case 'PALPITANDO':
        return await handlePalpitando(msg, usuario.id, session);
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
  switch (intencao) {
    case Intencao.SAUDACAO:
    case Intencao.MENU:
      await sendText({ to: msg.waId, text: boasVindasTexto(msg.senderName) });
      return;

    case Intencao.AJUDA:
      await sendText({ to: msg.waId, text: formatAjuda(env.BOT_PREFIX) });
      return;

    case Intencao.CRIAR_BOLAO:
      await setSession(msg.waId, { state: 'CRIANDO_BOLAO_NOME', ctx: {} });
      await sendText({
        to: msg.waId,
        text: '⚽ Criar novo bolão!\n\nComo quer chamar o bolão?\n_(ex: Bolão da Firma)_',
      });
      return;

    case Intencao.ENTRAR_BOLAO:
      await setSession(msg.waId, { state: 'ENTRANDO_NOME', ctx: {} });
      await sendText({
        to: msg.waId,
        text: '🎯 Qual o nome do bolão que você quer entrar?',
      });
      return;

    case Intencao.MEUS_BOLOES:
      await handleMeusBoloes(msg, usuarioId);
      return;

    case Intencao.RANKING:
      await handleRanking(msg, usuarioId, raw);
      return;

    case Intencao.APROVAR:
      await handleAprovar(msg, usuarioId, raw);
      return;

    case Intencao.RECUSAR:
      await handleRecusar(msg, usuarioId, raw);
      return;

    case Intencao.PENDENTES:
      await handlePendentes(msg, usuarioId);
      return;

    case Intencao.JOGOS_HOJE:
    case Intencao.MEU_PALPITE:
    case Intencao.MEUS_PONTOS:
      await sendText({
        to: msg.waId,
        text: '🚧 Em construção — em breve disponível!\n\n' + menuTexto(),
      });
      return;

    case Intencao.PALPITE_INLINE:
      await sendText({
        to: msg.waId,
        text: '⚽ Recebi um palpite, mas não há rodada aberta esperando por ele agora.\nEu te aviso quando houver jogos pra palpitar!',
      });
      return;

    default:
      await sendText({
        to: msg.waId,
        text: `🤖 Não entendi. ${menuTexto()}`,
      });
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

  // Gera cobranca PIX
  const cobranca = await pagamentoService.gerarCobranca({
    usuarioId,
    valorCentavos: env.PIX_VALOR_CENTAVOS,
    nomeBolaoPretendido: nomeBolao,
    senhaBolaoHashPretendido: senhaHash,
  });

  await updateSession(msg.waId, {
    state: 'CRIANDO_BOLAO_AGUARDANDO_PIX',
    ctxPatch: { pagamentoId: cobranca.pagamentoId, senhaBolaoHash: senhaHash },
  });

  const valor = (env.PIX_VALOR_CENTAVOS / 100).toFixed(2).replace('.', ',');
  await sendText({
    to: msg.waId,
    text:
      `💰 *Pagamento pra criar o bolão "${nomeBolao}"*\n\n` +
      `Valor: R$ ${valor}\n\n` +
      `📱 *PIX Copia e Cola:*\n\`\`\`${cobranca.pixCopiaCola}\`\`\`\n\n` +
      `🔗 QR Code: ${cobranca.pixQrCodeUrl}\n\n` +
      `Assim que o PIX cair, eu crio o bolão e te aviso! ⚽\n\n` +
      `_Digite "cancelar" pra abortar._`,
  });
}

async function handleCriandoBolaoAguardandoPix(msg: IncomingMessage) {
  await sendText({
    to: msg.waId,
    text: '⏳ Ainda aguardando seu PIX cair. Assim que confirmar, eu te aviso!\n_Digite "cancelar" pra abortar._',
  });
}

// ============================================================
// Fluxo: ENTRAR EM BOLAO
// ============================================================
async function handleEntrandoNome(msg: IncomingMessage, _usuarioId: string) {
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

  const palpites = parseMultiplePalpites(msg.text);
  if (palpites.length === 0) {
    await sendText({
      to: msg.waId,
      text: '❌ Não consegui identificar palpites. Formato: *Time1 NxN Time2*\n\n_ex: Flamengo 2x1 Palmeiras_',
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

  let bolaoId: string | null = null;
  if (nomeBolao) {
    const b = await bolaoService.buscarBolaoAtivoPorNome(nomeBolao);
    if (!b) {
      await sendText({ to: msg.waId, text: `❌ Bolão "${nomeBolao}" não encontrado.` });
      return;
    }
    bolaoId = b.id;
  } else {
    const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
    if (boloes.length === 0) {
      await sendText({ to: msg.waId, text: '📭 Você não participa de nenhum bolão ativo.' });
      return;
    }
    if (boloes.length > 1) {
      await sendText({
        to: msg.waId,
        text: `Você está em vários bolões. Diga qual:\n${boloes.map((b) => `• ${b.nome}`).join('\n')}\n\nEx: *ranking ${boloes[0].nome}*`,
      });
      return;
    }
    bolaoId = boloes[0].id;
  }

  const dados = await rankingService.getRankingPorBolao(bolaoId);
  const texto = formatRanking(dados.bolao.nome, dados.rodadaAtual, dados.bolao.campeonatoNome, dados.ranking);
  await sendText({ to: msg.waId, text: texto });
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
    '• *criar bolão* — crio um novo bolão (R$ 99,90 via PIX)\n' +
    '• *entrar em bolão* — entro num bolão existente\n' +
    '• *meus bolões* — bolões que você participa\n' +
    '• *ranking* — ranking de um bolão\n' +
    '• *ajuda* — ver todos os comandos'
  );
}
