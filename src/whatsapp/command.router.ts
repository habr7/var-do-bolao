import { sendText } from './evolution.client.js';
import {
  Intencao,
  parseIntencao,
  parseMultiplePalpites,
  parseMultiplePalpitesDetalhado,
} from './message.parser.js';
import { formatarBoloesNumerados, DICA_RESPOSTA_NUMERICA } from './lista.helper.js';
import { normalizeTeamName, validarPlacar } from '../utils/validators.js';
import { formatarDataHoraCurtaBR, formatarDataHoraComDiaBR } from '../utils/datetime.js';
import { regrasTexto, boasVindasComRegras } from './regras.text.js';
import {
  getSession,
  resetSession,
  setSession,
  updateSession,
  abrirJanelaPalpiteLivre,
  janelaPalpiteLivreAtiva,
  fecharJanelaPalpiteLivre,
  setProximosJogosOffset,
  getProximosJogosOffset,
  resetProximosJogosOffset,
  type Session,
} from './session.manager.js';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import * as bolaoService from '../modules/bolao/bolao.service.js';
// PIX desativado nesta fase — ver handleCriandoBolaoSenha mais abaixo.
// import * as pagamentoService from '../modules/pagamento/pagamento.service.js';
import * as solicitacaoService from '../modules/solicitacao/solicitacao.service.js';
import * as palpiteService from '../modules/palpite/palpite.service.js';
import * as rankingService from '../modules/ranking/ranking.service.js';
import { classificarIntencao } from '../llm/intent.classifier.js';
import { responderConversacional } from '../llm/conversational.responder.js';
import { parecePalpiteMasNaoEntendi } from './palpite.heuristics.js';
import {
  construirFatosCopa2026,
  descreverGround,
  respostaForaDeEscopo,
} from '../llm/copa.ground.js';
import { extrairPalpites } from '../llm/palpite.extractor.js';
import { escolherBolaoDaLista, interpretarSimNao } from '../llm/bolao.matcher.js';
import { prisma } from '../config/database.js';
import { hashPassword, comparePassword, isValidPassword } from '../utils/password.js';
import { formatAjuda, formatRanking } from '../utils/formatting.js';
import { confirmacao, naoEntendi, resultadoEmoji } from '../utils/football.terms.js';
import { extrairCodigoBolao } from '../utils/bolao-codigo.js';
import { detectarAcaoAdmin, type AdminAcao } from './admin.parser.js';
import { renderizarConvite } from './convite.helper.js';
import { incContador, registrarMsgNaoEntendida } from '../utils/metrics.js';

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
  const t0 = Date.now();
  let tUser = t0;
  let tSession = t0;
  let tParse = t0;
  let intencaoFinal: Intencao | 'erro' = 'erro';
  let stateFinal: string = 'unknown';
  try {
    // ISSUE-008: contador total de mensagens (denominador da taxa de fallback).
    void incContador('msg.total');

    const usuario = await bolaoService.getOrCreateUsuario(msg.waId, msg.senderName);
    tUser = Date.now();
    const session = await getSession(msg.waId);
    tSession = Date.now();
    const parsed = parseIntencao(msg.text);
    tParse = Date.now();
    intencaoFinal = parsed.intencao;
    stateFinal = session.state;
    // ISSUE-008: por-intent counter. TEXTO_LIVRE = ainda nao classificada.
    void incContador(`intent.${parsed.intencao}`);

    // Cancelar sempre funciona — qualquer estado volta pra IDLE
    if (parsed.intencao === Intencao.CANCELAR) {
      await resetSession(msg.waId);
      await sendText({ to: msg.waId, text: '👍 Cancelado. O que quer fazer agora?\n\n' + menuTexto() });
      return;
    }

    // FAST-PATH: usuario colou a mensagem-convite ("quero entrar no bolão #K3MZ8P ...").
    // ISSUE-007: ao inves de WHITELIST de estados (IDLE/ENTRANDO_NOME),
    // usa BLACKLIST de estados destrutivos onde o codigo poderia ser
    // confundido com outro input (senha, palpite, confirmacao). Em todos
    // os outros estados (ranking, leitura, escolha), o user pode escapar
    // colando a mensagem-convite — bem-vinda como interrupcao.
    const codigoNaMsg = extrairCodigoBolao(msg.text);
    const ESTADOS_PROIBIDOS_CODIGO = new Set<string>([
      'CRIANDO_BOLAO_NOME',
      'CRIANDO_BOLAO_SENHA',
      'CRIANDO_BOLAO_AGUARDANDO_PIX',
      'ENTRANDO_SENHA', // senha podem parecer codigo
      'PALPITANDO',
      'CONFIRMANDO_PALPITES_INLINE',
      'CONFIRMANDO_APROVAR_TODOS',
      'CONFIRMANDO_RECUSAR_TODOS',
      'CONFIRMANDO_RECUSAR_NOMEADO',
      'CONFIRMANDO_SAIR_BOLAO',
      'CONFIRMANDO_EXCLUSAO_BOLAO',
      'ESCOLHENDO_BOLAO_PARA_PALPITAR',
      // Sprint 2 — destrutivos / com input em curso
      'RENOMEANDO_BOLAO_NOME', // nome novo pode parecer codigo
      'CONFIRMANDO_RENOMEACAO_BOLAO',
      'REMOVENDO_PARTICIPANTE_ESCOLHA_NOME', // nome pode parecer codigo
      'CONFIRMANDO_REMOCAO_PARTICIPANTE',
      'CONFIRMANDO_PALPITE_PLACAR_ABSURDO',
      'EDITANDO_PALPITE_NOVO_PLACAR',
      'CONFIRMANDO_APAGAR_PALPITE',
      // Sprint 3 (bug Jeni 17/05)
      'CONFIRMANDO_PALPITE_MULTI_BOLAO',
    ]);
    const podeAceitarCodigoAqui = !ESTADOS_PROIBIDOS_CODIGO.has(session.state);
    if (codigoNaMsg && podeAceitarCodigoAqui) {
      const handledByCodigo = await tentarEntrarPorCodigo(msg, usuario.id, codigoNaMsg);
      if (handledByCodigo) return;
    }

    // FSM ESCAPE #1: se admin tem pendentes E mandou claramente uma acao
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

    // FSM ESCAPE #2: se usuario esta em estado de "leitura/escolha" (ex:
    // CONFIRMANDO_VER_PALPITES, ESCOLHENDO_BOLAO_RANKING) e mandou uma
    // NOVA intent forte (ex: "ranking", "criar bolao"), abandona o
    // estado atual silenciosamente e processa a nova intent.
    if (escapouFsmStaleParaNovaIntent(session, parsed.intencao)) {
      console.log(
        `[fsm-escape] state=${session.state} → IDLE (nova intent=${parsed.intencao})`,
      );
      await resetSession(msg.waId);
      await handleIdle(msg, usuario.id, parsed.intencao, parsed.raw);
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
      case 'CONFIRMANDO_APROVAR_TODOS':
        return await handleConfirmandoAprovarTodos(msg, usuario.id);
      case 'CONFIRMANDO_RECUSAR_TODOS':
        return await handleConfirmandoRecusarTodos(msg, usuario.id);
      case 'CONFIRMANDO_RECUSAR_NOMEADO':
        return await handleConfirmandoRecusarNomeado(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_PARA_PALPITAR':
        return await handleEscolhendoBolaoParaPalpitar(msg, usuario.id, session);
      case 'CONFIRMANDO_PALPITES_INLINE':
        return await handleConfirmandoPalpitesInline(msg, usuario.id, session);
      case 'ESCOLHENDO_INTENCAO_PALPITES':
        return await handleEscolhendoIntencaoPalpites(msg, usuario.id);
      case 'ESCOLHENDO_BOLAO_CONVITE':
        return await handleEscolhendoBolaoConvite(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_SAIR':
        return await handleEscolhendoBolaoSair(msg, usuario.id, session);
      case 'CONFIRMANDO_SAIR_BOLAO':
        return await handleConfirmandoSairBolao(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_PARTICIPANTES':
        return await handleEscolhendoBolaoParticipantes(msg, session);
      case 'ESCOLHENDO_BOLAO_PARA_ENTRAR':
        return await handleEscolhendoBolaoParaEntrar(msg, usuario.id, session);
      case 'ESCOLHENDO_BOLAO_EXCLUIR':
        return await handleEscolhendoBolaoExcluir(msg, usuario.id, session);
      case 'CONFIRMANDO_EXCLUSAO_BOLAO':
        return await handleConfirmandoExclusaoBolao(msg, usuario.id, session);
      // Sprint 2 (ISSUE-016) — bolao padrao
      case 'ESCOLHENDO_BOLAO_PADRAO':
        return await handleEscolhendoBolaoPadrao(msg, usuario.id, session);
      // Sprint 2 (ISSUE-020) — renomear bolao
      case 'RENOMEANDO_BOLAO_ESCOLHA':
        return await handleEscolhendoBolaoRenomear(msg, usuario.id, session);
      case 'RENOMEANDO_BOLAO_NOME':
        return await handleRenomeandoBolaoNome(msg, usuario.id, session);
      case 'CONFIRMANDO_RENOMEACAO_BOLAO':
        return await handleConfirmandoRenomeacaoBolao(msg, usuario.id, session);
      // Sprint 2 (ISSUE-021) — remover participante
      case 'REMOVENDO_PARTICIPANTE_ESCOLHA_BOLAO':
        return await handleEscolhendoBolaoRemover(msg, usuario.id, session);
      case 'REMOVENDO_PARTICIPANTE_ESCOLHA_NOME':
        return await handleRemovendoParticipanteNome(msg, usuario.id, session);
      case 'CONFIRMANDO_REMOCAO_PARTICIPANTE':
        return await handleConfirmandoRemocaoParticipante(msg, usuario.id, session);
      // Sprint 2 (ISSUE-013) — placar absurdo
      case 'CONFIRMANDO_PALPITE_PLACAR_ABSURDO':
        return await handleConfirmandoPalpitePlacarAbsurdo(msg, usuario.id, session);
      // Sprint 2 (ISSUE-011) — editar palpite
      case 'EDITANDO_PALPITE_ESCOLHA_BOLAO':
        return await handleEscolhendoBolaoEditarPalpite(msg, usuario.id, session);
      case 'EDITANDO_PALPITE_NOVO_PLACAR':
        return await handleEditandoPalpiteNovoPlacar(msg, usuario.id, session);
      // Sprint 2 (ISSUE-012) — apagar palpite
      case 'APAGANDO_PALPITE_ESCOLHA_BOLAO':
        return await handleEscolhendoBolaoApagarPalpite(msg, usuario.id, session);
      case 'APAGANDO_PALPITE_ESCOLHA_JOGO':
        return await handleApagandoPalpiteEscolhaJogo(msg, usuario.id, session);
      case 'CONFIRMANDO_APAGAR_PALPITE':
        return await handleConfirmandoApagarPalpite(msg, usuario.id, session);
      // Sprint 3 (bug Jeni 17/05) — confirma auto-apply multi-bolao
      case 'CONFIRMANDO_PALPITE_MULTI_BOLAO':
        return await handleConfirmandoPalpiteMultiBolao(msg, usuario.id, session);
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
  } finally {
    // Log de timing por etapa. Sempre roda (mesmo nos early-returns
    // do switch de states). Procure linhas [llm] no log pra confirmar
    // se LLM rodou — pra mensagens simples (oi/menu/regras/etc) NAO
    // deve aparecer nenhuma chamada [llm].
    console.log(
      `[timing] waId=${msg.waId} intent=${intencaoFinal} state=${stateFinal}` +
      ` user=${tUser - t0}ms session=${tSession - tUser}ms parse=${tParse - tSession}ms` +
      ` dispatch=${Date.now() - tParse}ms total=${Date.now() - t0}ms`,
    );
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
  const outcomeLLM = await classificarIntencao(msg.text);
  const intencaoLLM = outcomeLLM.intencao;
  if (intencaoLLM && intencaoLLM !== Intencao.TEXTO_LIVRE) {
    void incContador('llm.intent.classifier.hit');
    const handledLLM = await dispatchIntencao(msg, usuarioId, intencaoLLM, raw);
    if (handledLLM) return;
  } else {
    void incContador('llm.intent.classifier.miss');
    // Low confidence: LLM tentou classificar mas ficou abaixo de 0.55.
    // Captura pra revisao offline — ouro pra descobrir variantes que merecem
    // virar regex/handler novo.
    if (outcomeLLM.intencaoTentada && typeof outcomeLLM.confianca === 'number') {
      void incContador('llm.intent.classifier.low_conf');
      void registrarMsgNaoEntendida(msg.text, 'IDLE', 'low_confidence', {
        whatsappId: msg.waId,
        usuarioId,
        llmIntent: outcomeLLM.intencaoTentada,
        llmConfianca: outcomeLLM.confianca,
      });
    }
  }

  // v3.10.0 — PRÉ-CHECK CRÍTICO ANTI-MENTIRA DO LLM (caso Valéria 22/05):
  // se a mensagem parece um lote de palpites (2+ âncoras "NxN") mas nada
  // de palpite válido foi extraído, NÃO chama LLM — em smart-fallback ele
  // pode dizer "Entendi, palpites registrados!" sem nada ter sido salvo.
  // Em vez disso, responde mensagem específica explicando o formato.
  if (parecePalpiteMasNaoEntendi(msg.text)) {
    void incContador('msg.parece_palpite_nao_entendi');
    console.warn(
      `[parece-palpite] waId=${msg.waId} bloqueando smart-fallback LLM pra evitar mentira de "registrei palpites". text=${JSON.stringify(msg.text.slice(0, 200))}`,
    );
    await sendText({
      to: msg.waId,
      text:
        `🤔 Parece que você quis mandar palpites, mas não consegui entender o formato.\n\n` +
        `*Formato aceito*:\n` +
        `• \`Brasil 2x1 Marrocos\` (placar ENTRE os times)\n` +
        `• \`Brasil 2 a 1 Marrocos\`\n` +
        `• \`1x1 México x África do Sul\` (placar antes dos times também funciona)\n\n` +
        `Pode mandar *vários palpites* de uma vez, *um por linha*:\n` +
        `\`\`\`\nBrasil 2x1 Marrocos\nFrança 1x0 Argentina\n\`\`\`\n\n` +
        `Manda *próximos jogos* pra ver os jogos abertos e os nomes oficiais dos times.`,
    });
    return;
  }

  // Smart fallback: em vez de devolver "nao entendi" direto, tenta uma
  // resposta conversacional via LLM com prompt que sabe redirecionar
  // pros comandos certos sem inventar dados. So se isso falhar, cai no
  // "nao entendi" textual + menu.
  const respostaLLM = await responderConversacional(msg.text);
  if (respostaLLM) {
    void incContador('llm.conversational.hit');
    void registrarMsgNaoEntendida(msg.text, 'IDLE', 'llm_fail', {
      whatsappId: msg.waId,
      usuarioId,
      llmIntent: outcomeLLM.intencaoTentada,
      llmConfianca: outcomeLLM.confianca,
    });
    console.log(
      `[smart-fallback] waId=${msg.waId} regex_intent=${intencao} llm_intent=${intencaoLLM ?? 'null'} llm_tried=${outcomeLLM.intencaoTentada ?? 'null'} conf=${outcomeLLM.confianca ?? 'null'} respondido_via_llm`,
    );
    await sendText({ to: msg.waId, text: respostaLLM });
    return;
  }
  void incContador('llm.conversational.miss');

  // Ultimo recurso: resposta amigavel admitindo que nao entendeu.
  // Loga em formato facil de grep ([nao-entendi]) pra revisar depois.
  void incContador('msg.nao_entendi');
  void registrarMsgNaoEntendida(msg.text, 'IDLE', 'final_fallback', {
    whatsappId: msg.waId,
    usuarioId,
    llmIntent: outcomeLLM.intencaoTentada,
    llmConfianca: outcomeLLM.confianca,
  });
  console.log(
    `[nao-entendi] waId=${msg.waId} regex_intent=${intencao} llm_intent=${intencaoLLM ?? 'null'} llm_tried=${outcomeLLM.intencaoTentada ?? 'null'} conf=${outcomeLLM.confianca ?? 'null'} text=${JSON.stringify(msg.text.slice(0, 200))}`,
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

    case Intencao.CRIAR_BOLAO: {
      // Bug Humberto 18/05: "Bolao teste oficial" virou CRIAR_BOLAO no LLM
      // classifier mesmo sem verbo de acao. Antes de iniciar fluxo de
      // criacao, checa se o raw bate fuzzy com bolao que o user ja
      // participa — se bater, oferece menu contextual em vez de criar.
      const interceptou = await tentarOferecerMenuContextualPorNomeBolao(
        msg,
        usuarioId,
        raw,
      );
      if (interceptou) return true;

      await setSession(msg.waId, { state: 'CRIANDO_BOLAO_NOME', ctx: {} });
      await sendText({
        to: msg.waId,
        text: '⚽ Bora criar um bolão novo!\n\nComo você quer chamar?\n_(ex: Bolão da Firma, Copa dos Amigos…)_',
      });
      return true;
    }

    case Intencao.ENTRAR_BOLAO:
      await setSession(msg.waId, { state: 'ENTRANDO_NOME', ctx: { tentativas: 0 } });
      await sendText({
        to: msg.waId,
        text:
          '🎯 Pra entrar, manda o *ID do bolão* (aquele tipo `#K3MZ8P` que o admin compartilhou).\n\n' +
          '_Se não tiver o ID, pode mandar o nome — mas com ID é mais rápido e sem risco de errar de bolão. Depois o admin aprova sua entrada._',
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

    case Intencao.MAIS_JOGOS:
      await handleMaisJogos(msg, usuarioId);
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

    // v3.8.0 — progresso dos palpites (qualquer participante) + cutucar (admin)
    case Intencao.PROGRESSO_PALPITES:
      await handleProgressoPalpites(msg, usuarioId);
      return true;

    case Intencao.CUTUCAR_PENDENTES:
      await handleCutucarPendentes(msg, usuarioId);
      return true;

    case Intencao.REGRAS:
      await sendText({ to: msg.waId, text: regrasTexto() });
      return true;

    case Intencao.PALPITES_AMBIGUO:
      await handlePalpitesAmbiguo(msg);
      return true;

    case Intencao.INFO_SENHA:
      await handleInfoSenha(msg);
      return true;

    case Intencao.EXCLUIR_BOLAO:
      await handleExcluirBolao(msg, usuarioId);
      return true;

    // Sprint 2 — handlers de info (ISSUE-009, 010, 017, 018)
    case Intencao.INFO_PRODUTO:
      await handleInfoProduto(msg);
      return true;

    case Intencao.INFO_PRECO:
      await handleInfoPreco(msg);
      return true;

    case Intencao.COMO_PALPITAR:
      await handleComoPalpitar(msg, usuarioId);
      return true;

    // v3.9.0 — onboarding leve pra novato (caso Valéria 22/05)
    case Intencao.DICAS_PALPITE:
      await handleDicasPalpite(msg, usuarioId);
      return true;

    case Intencao.ACOLHIMENTO_NOVATO:
      await handleAcolhimentoNovato(msg, usuarioId);
      return true;

    case Intencao.QUANDO_COMECA:
      await handleQuandoComeca(msg, usuarioId);
      return true;

    // Sprint 2 — fluxo de palpite (ISSUE-011, 012)
    case Intencao.EDITAR_PALPITE:
      await handleEditarPalpite(msg, usuarioId, raw);
      return true;

    case Intencao.APAGAR_PALPITE:
      await handleApagarPalpite(msg, usuarioId, raw);
      return true;

    // Sprint 2 — bolao padrao (ISSUE-016)
    case Intencao.DEFINIR_BOLAO_PADRAO:
      await handleDefinirBolaoPadrao(msg, usuarioId);
      return true;

    // Sprint 2 — admin actions (ISSUE-020, 021)
    case Intencao.RENOMEAR_BOLAO:
      await handleRenomearBolao(msg, usuarioId);
      return true;

    case Intencao.REMOVER_PARTICIPANTE:
      await handleRemoverParticipante(msg, usuarioId, raw);
      return true;

    // Sprint 2 — pontuacao cruzada (ISSUE-023)
    case Intencao.RESUMO_BOLOES:
      await handleResumoBoloes(msg, usuarioId);
      return true;

    // Sprint 3 — cordialidade (bug Jeni 17/05 + expansao)
    case Intencao.AGRADECIMENTO:
      await handleAgradecimento(msg);
      return true;

    case Intencao.DESPEDIDA:
      await handleDespedida(msg);
      return true;

    case Intencao.CUMPRIMENTO_CASUAL:
      await handleCumprimentoCasual(msg);
      return true;

    case Intencao.CONCORDANCIA_CASUAL:
      await handleConcordanciaCasual(msg);
      return true;

    case Intencao.RISADA:
      await handleRisada(msg);
      return true;

    // Sprint 4 — pergunta geral sobre futebol (nao sobre o bolao do user)
    case Intencao.PERGUNTA_GERAL_FUTEBOL:
      await handlePerguntaGeralFutebol(msg);
      return true;

    case Intencao.PALPITE_INLINE:
      await handlePalpiteInlineEmIdle(msg, usuarioId);
      return true;

    default:
      return false;
  }
}

/**
 * Handler ISSUE-006: admin quer excluir bolao.
 *   - 0 boloes que ele administra → mensagem amigavel
 *   - 1 bolao admin → vai direto pra confirmacao
 *   - >1 boloes admin → lista numerada pra ele escolher qual
 *
 * Apos escolha (ou auto-selecao), entra em CONFIRMANDO_EXCLUSAO_BOLAO
 * que exige "confirmar" (texto literal) pra evitar acidente.
 */
async function handleExcluirBolao(msg: IncomingMessage, usuarioId: string) {
  const adminados = await bolaoService.listarBoloesQueAdministra(usuarioId);
  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        `🤷 Só o admin pode excluir um bolão. Você ainda não criou nenhum.\n\n` +
        `Pra sair de um bolão em que participa, manda *sair do bolão*.`,
    });
    return;
  }

  if (adminados.length === 1) {
    await pedirConfirmacaoExclusaoBolao(msg, adminados[0]);
    return;
  }

  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_EXCLUIR',
    ctx: { boloesParaEscolher: adminados.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = formatarBoloesNumerados(adminados);
  await sendText({
    to: msg.waId,
    text: `⚠️ Qual bolão você quer *excluir*?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleEscolhendoBolaoExcluir(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *excluir bolão* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número ou o nome:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  // Re-confirma que ele eh admin do escolhido
  const bolao = await prisma.bolao.findUnique({
    where: { id: escolhido.id },
    select: { id: true, nome: true, adminId: true },
  });
  if (!bolao || bolao.adminId !== usuarioId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Você não é admin desse bolão.' });
    return;
  }
  await pedirConfirmacaoExclusaoBolao(msg, bolao);
}

async function pedirConfirmacaoExclusaoBolao(
  msg: IncomingMessage,
  bolao: { id: string; nome: string },
) {
  await setSession(msg.waId, {
    state: 'CONFIRMANDO_EXCLUSAO_BOLAO',
    ctx: { bolaoId: bolao.id, nomeBolao: bolao.nome },
  });
  await sendText({
    to: msg.waId,
    text:
      `⚠️ *Excluir o bolão "${bolao.nome}"?*\n\n` +
      `Todos os participantes vão receber um aviso de que o bolão foi encerrado, e ele some das listagens. ` +
      `Os palpites e ranking ficam guardados pra histórico, mas ninguém mais palpita.\n\n` +
      `_Pra confirmar manda *confirmar*. Pra desistir manda *cancelar* (ou qualquer outra coisa)._`,
  });
}

async function handleConfirmandoExclusaoBolao(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const bolaoId = session.ctx?.bolaoId;
  const nomeBolao = session.ctx?.nomeBolao ?? 'esse bolão';
  if (!bolaoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *excluir bolão* de novo.' });
    return;
  }
  const texto = msg.text.trim().toLowerCase();
  // Exige texto explicito "confirmar" — sim/yes/ok nao basta (acao destrutiva)
  const confirmou = /^(?:confirmar|confirmo|excluir agora|sim, excluir|tenho certeza)\b/.test(texto);
  if (!confirmou) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `👍 Beleza, mantive o bolão *${nomeBolao}* ativo. (Pra excluir, era preciso mandar *confirmar* explicitamente.)`,
    });
    return;
  }

  try {
    const { participantesPraNotificar } = await bolaoService.excluirBolao(bolaoId, usuarioId);
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `🗑️ Bolão *${nomeBolao}* encerrado. Avisei os ${participantesPraNotificar.length} participante(s).`,
    });
    // Notifica participantes em paralelo (best-effort)
    await Promise.all(
      participantesPraNotificar.map((p) =>
        sendText({
          to: p.whatsappId,
          text: `📢 O admin encerrou o bolão *${nomeBolao}*. Os palpites e ranking ficam guardados, mas não tem mais jogos pra palpitar nele.`,
        }).catch(() => undefined),
      ),
    );
  } catch (err) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
}

/**
 * Handler ISSUE-005: pergunta sobre senha. Bolao agora usa ID curto
 * (#ABCD12) + aprovacao manual do admin. Sem custo de LLM.
 */
async function handleInfoSenha(msg: IncomingMessage) {
  await sendText({
    to: msg.waId,
    text:
      `🔓 Bolões no *VAR do Bolão* não usam senha — a entrada é pelo *ID do bolão* (formato \`#ABCD12\`).\n\n` +
      `O admin do bolão te manda o ID (ou um link de convite). Você me envia, e eu peço aprovação pra ele.\n\n` +
      `Quer entrar em algum bolão agora? Manda *entrar em bolão*.`,
  });
}

/**
 * Bug Jeni 17/05: "obrigada" disparava SAUDACAO → menu completo de
 * boas-vindas. Resposta esperada eh uma cordialidade curta sem reabrir
 * o menu. Pequena variacao no texto pra nao soar robotico se o usuario
 * agradecer varias vezes na mesma conversa.
 */
function escolherRespostaAgradecimento(nome: string): string {
  const variantes = [
    `🤙 Magina, *${nome}*! Tamo junto. Precisando, só chamar. ⚽`,
    `👍 Disponha! Quando precisar é só mandar bala.`,
    `🍀 De nada! Boa sorte nos palpites — qualquer coisa, chama.`,
    `🤝 Tranquilo, *${nome}*! Tô aqui pra isso. Bora pra cima!`,
    `😄 Imagina! Tamo junto na missão da Copa.`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

async function handleAgradecimento(msg: IncomingMessage) {
  const usuario = await prisma.usuario.findUnique({
    where: { whatsappId: msg.waId },
    select: { nome: true },
  });
  const nome = usuario?.nome?.split(' ')[0] ?? 'craque';
  await sendText({
    to: msg.waId,
    text: escolherRespostaAgradecimento(nome),
  });
}

/**
 * Helper compartilhado: pega o primeiro nome do usuario (com fallback).
 */
async function primeiroNomeDoUsuario(waId: string): Promise<string> {
  const usuario = await prisma.usuario.findUnique({
    where: { whatsappId: waId },
    select: { nome: true },
  });
  return usuario?.nome?.split(' ')[0] ?? 'craque';
}

/**
 * DESPEDIDA — "tchau", "flw", "abraço", "fui"...
 * Resposta curta de saída sem reabrir menu. Multiplas variantes pra
 * naturalidade.
 */
function escolherRespostaDespedida(nome: string): string {
  const variantes = [
    `🤙 Falou, *${nome}*! Tamo junto.`,
    `👋 Abraço, *${nome}*! Até a próxima.`,
    `⚽ Beleza! Bora pra cima nos próximos jogos. 🍀`,
    `✌️ Tchau! Qualquer coisa, chama.`,
    `🙋 Até mais, *${nome}*! Boa sorte com os palpites.`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

async function handleDespedida(msg: IncomingMessage) {
  const nome = await primeiroNomeDoUsuario(msg.waId);
  await sendText({ to: msg.waId, text: escolherRespostaDespedida(nome) });
}

/**
 * CUMPRIMENTO_CASUAL — "tudo bem?", "blz?", "como vai?"
 * Responde de volta + oferece ajuda contextual leve (não reabre menu cru).
 */
function escolherRespostaCumprimento(nome: string): string {
  const variantes = [
    `Tudo certo por aqui, *${nome}*! E você?\n\nQuer ver o *ranking*, *meus palpites* ou ver os *próximos jogos*?`,
    `De boa, *${nome}*! 🤙 Manda *ranking*, *meus pontos* ou *próximos jogos* — tô pronto.`,
    `Tô na área, *${nome}*! Bora pra alguma jogada? *ranking*, *palpitar* ou *meus bolões*.`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

async function handleCumprimentoCasual(msg: IncomingMessage) {
  const nome = await primeiroNomeDoUsuario(msg.waId);
  await sendText({ to: msg.waId, text: escolherRespostaCumprimento(nome) });
}

/**
 * CONCORDANCIA_CASUAL — "ok", "beleza", "show", "fechou", "perfeito"
 * IMPORTANTE: dentro de CONFIRMANDO_* states, o FSM dispatcher pega ANTES
 * via interpretarSimNao. Esse handler so dispara em IDLE (fluxo padrao).
 * Reposta curta sem reabrir menu.
 */
function escolherRespostaConcordancia(): string {
  const variantes = [
    `👍 Show! Tô por aqui se precisar.`,
    `🤙 Beleza! Manda quando quiser palpitar ou ver o ranking.`,
    `✅ Tranquilo! Qualquer coisa, chama.`,
    `🙌 Combinado!`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

async function handleConcordanciaCasual(msg: IncomingMessage) {
  await sendText({ to: msg.waId, text: escolherRespostaConcordancia() });
}

/**
 * RISADA — "kkkk", "rsrs", "hahaha", "😂😂😂"
 * Resposta minimalista, só emoji ou frase super curta.
 */
function escolherRespostaRisada(): string {
  const variantes = [
    `😄`,
    `😆`,
    `kkkkk`,
    `🤣`,
    `haha`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

async function handleRisada(msg: IncomingMessage) {
  await sendText({ to: msg.waId, text: escolherRespostaRisada() });
}

/**
 * Sprint 4 (Bug VPS 18/05) — pergunta geral sobre futebol que nao eh
 * sobre o bolao do user. Ex: "qual canal passa o Brasil?", "quem joga
 * hoje a Inglaterra?", "quem ganhou copa de 94?".
 *
 * Antes desta intent, perguntas assim viravam comando do bot por engano
 * (handleProximosJogos do bolao do user, ou handleRanking buscando bolao
 * com nome do time). Agora chama o LLM conversacional diretamente —
 * autorizado a responder com conhecimento geral, sem inventar dados do
 * banco do bot.
 *
 * Fallback gracioso quando LLM falha (timeout/no-key): mensagem amigavel
 * admitindo que nao consegue ajudar agora.
 */
async function handlePerguntaGeralFutebol(msg: IncomingMessage) {
  void incContador('intent.PERGUNTA_GERAL_FUTEBOL');

  // Grounding: extrai entidades da pergunta e monta bloco [FATOS VERIFICADOS]
  // a partir do JSON oficial (openfootball, src/data/copa-2026/).
  // Se for futebol fora da Copa 2026 (Brasileirao, Libertadores, jogador
  // especifico), recusa com elegancia ANTES de chamar a LLM.
  const fatos = construirFatosCopa2026(msg.text);
  console.log(`[handlePerguntaGeralFutebol] waId=${msg.waId} ${descreverGround(fatos)}`);

  if (!fatos.dentroDoEscopo) {
    void incContador('llm.conversational.fora_escopo');
    await sendText({ to: msg.waId, text: respostaForaDeEscopo() });
    return;
  }

  void incContador(`llm.conversational.ground.${fatos.motivo}`);
  const resposta = await responderConversacional(msg.text, fatos.bloco);
  if (resposta) {
    void incContador('llm.conversational.hit');
    await sendText({ to: msg.waId, text: resposta });
    return;
  }

  // Fallback quando LLM esgotou retries (Gemini overloaded + Ollama nao
  // configurado/falhou). A mensagem nao culpa o user e oferece retry.
  void incContador('llm.conversational.miss');
  console.warn(
    `[handlePerguntaGeralFutebol] LLM esgotou retries pra waId=${msg.waId} text=${JSON.stringify(msg.text.slice(0, 100))}`,
  );
  await sendText({
    to: msg.waId,
    text:
      `🤖 Caraca, foi mal — fiquei sem fôlego pra responder essa agora ` +
      `(o assistente que responde perguntas gerais tá congestionado). Tenta de novo daqui a uns segundinhos? 🙏\n\n` +
      `Pra dados do *seu bolão* (que não dependem do assistente), manda *ranking*, *meus pontos* ou *meus palpites*.`,
  });
}

// ============================================================
// Handlers de pergunta frequente — Sprint 2 (ISSUE-009, 010, 017, 018)
// ============================================================

/**
 * ISSUE-009: pitch curto do produto pra primeira interacao. Sem LLM.
 */
async function handleInfoProduto(msg: IncomingMessage) {
  await sendText({
    to: msg.waId,
    text:
      `🤖 *VAR do Bolão* — sou o bot que organiza bolões de futebol direto aqui no WhatsApp, sem grupo nem app.\n\n` +
      `*Como funciona:*\n` +
      `• Admin cria um bolão e ganha um *ID curto* + link pra encaminhar\n` +
      `• Convidados clicam → entram com 1 mensagem\n` +
      `• Todo mundo manda palpites em DM (palpite privado: ninguém vê o seu)\n` +
      `• Ranking sai automático após cada rodada\n\n` +
      `*Bora começar?*\n` +
      `• *criar bolão* — abre um novo\n` +
      `• *entrar em bolão* — entra em um existente`,
  });
}

/**
 * ISSUE-010: resposta fixa sobre custo. PIX desativado nesta fase.
 */
async function handleInfoPreco(msg: IncomingMessage) {
  await sendText({
    to: msg.waId,
    text:
      `🆓 *É grátis!*\n\n` +
      `Pra participar de bolão — sempre grátis.\n` +
      `Pra criar bolão — também grátis nesta fase (estamos crescendo a base).\n\n` +
      `_Mais pra frente, criar pode ter custo (R$ 99,90 via PIX, anual) — mas avisaremos com antecedência._\n\n` +
      `Bora? *criar bolão* ou *entrar em bolão*.`,
  });
}

/**
 * ISSUE-017: explica como dar palpite + lista alguns jogos abertos se o
 * usuario ja esta em bolao. Diferente de PROXIMOS_JOGOS, este eh pedagogico.
 */
async function handleComoPalpitar(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);

  let texto =
    `📝 *Como dar palpite:*\n\n` +
    `É só mandar o placar direto em DM. Vários formatos funcionam:\n\n` +
    `• \`Brasil 2x1 Marrocos\`\n` +
    `• \`Brasil 2 a 1 Marrocos\`\n` +
    `• \`Brasil 2-1 Marrocos\`\n` +
    `• \`Brasil dois a um Marrocos\` (extenso)\n` +
    `• \`Brasil perde de 1 a 0 do Marrocos\` (eu entendo!)\n\n` +
    `Pode mandar *vários palpites de uma vez*, um por linha:\n\n` +
    `\`\`\`\nBrasil 2x1 Marrocos\nFrança 1x0 Argentina\n\`\`\`\n\n` +
    `Eu mostro um preview e você confirma com *sim* antes de eu registrar.`;

  if (boloes.length === 0) {
    texto += `\n\nVocê ainda não está em nenhum bolão. Manda *entrar em bolão* pra começar.`;
  } else {
    texto += `\n\nManda *próximos jogos* pra ver os jogos abertos pra palpitar agora.`;
  }

  await sendText({ to: msg.waId, text: texto });
}

// ============================================================
// v3.9.0 — DICAS_PALPITE: estratégia (não formato)
// ============================================================
/**
 * Resposta determinística pra "tem dicas?", "como monto palpite?", "qual
 * placar é mais comum?". NÃO dá dica de aposta (regras de aposta nem
 * fazem sentido aqui — bolão é de pontos, não de dinheiro). Só dá:
 *
 * - Resumo da pontuação (10/7/5/3/0) — quem entende o sistema palpita melhor
 * - Placares mais comuns em Copa do Mundo (fato histórico, não predição)
 * - 4 dicas práticas de uso do bolão
 *
 * Pessoa real que motivou (Valéria 22/05): perguntou "você tem dicas de
 * como montar os palpites?" e bot deu pitch do produto. Resposta atual
 * é acolhedora e prática.
 */
async function handleDicasPalpite(msg: IncomingMessage, usuarioId: string) {
  void incContador('intent.DICAS_PALPITE');
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);

  let texto =
    `🎯 *Dicas pra montar palpite*\n\n` +
    `O bolão é mais sobre diversão que sobre acerto perfeito — mas se quer estratégia, vamos lá:\n\n` +
    `📊 *Como pontua* (manda *regras* pra ver completo):\n` +
    `• Placar exato → *10 pts*\n` +
    `• Diferença de gols certa → *7 pts*\n` +
    `• Vencedor + 1 gol certo → *5 pts*\n` +
    `• Só o vencedor → *3 pts*\n` +
    `• Errou tudo → *0*\n\n` +
    `⚽ *Placares mais comuns em Copa do Mundo*:\n` +
    `\`1x0\`, \`2x1\`, \`2x0\`, \`1x1\`, \`0x0\`\n\n` +
    `🧠 *Dicas práticas*:\n` +
    `1. *Palpita em TODOS os jogos* — só pontua quem tem palpite registrado. Em branco vale zero.\n` +
    `2. *Foco no vencedor*: acertar só quem ganha já dá 3 pts e é bem mais fácil que cravar placar exato.\n` +
    `3. *Não sabe nada do jogo?* Vai no coração, na sorte, no time da casa. Gente que palpita \`1x0\` sempre costuma ir bem.\n` +
    `4. *Dá pra editar* — manda *corrigir palpite* até o jogo começar. Mudou de ideia? Sem problema.`;

  if (boloes.length === 0) {
    texto += `\n\n*Bora começar?* Manda *entrar em bolão* pra entrar em algum. 🍀`;
  } else {
    texto += `\n\n*Bora?* Manda *próximos jogos* pra ver o que tá aberto pra palpitar. 🍀`;
  }

  await sendText({ to: msg.waId, text: texto });
}

// ============================================================
// v3.9.0 — ACOLHIMENTO_NOVATO: validação emocional
// ============================================================
/**
 * Responde a sinais de insegurança/vulnerabilidade: "nao entendo de
 * futebol", "to perdida", "primeira vez", "nunca palpitei", "to com
 * medo de errar".
 *
 * Pessoa real que motivou (Valéria 22/05): mandou "nao entendo de
 * futebol" depois de pedir dicas. Bot caiu em fallback genérico (menu),
 * perdendo oportunidade clara de engajamento.
 *
 * Tom: acolhedor, sem condescendência. Valida que palpitar no aleatório
 * funciona. 3 passos básicos. CTAs leves (dicas, próximos jogos,
 * regras) — não força a pessoa a já entrar em bolão.
 */
async function handleAcolhimentoNovato(msg: IncomingMessage, usuarioId: string) {
  void incContador('intent.ACOLHIMENTO_NOVATO');
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);

  let texto =
    `🍀 *Relaxa!* Não precisa entender nada de futebol pra palpitar.\n\n` +
    `Sério — muita gente que ganha bolão é assim:\n` +
    `• Chuta no aleatório 🎲\n` +
    `• Vai no coração ❤️\n` +
    `• Escolhe pela cor da camisa 👕\n` +
    `• Palpita sempre \`1x0\` e ganha 😄\n\n` +
    `⚽ *Como funciona aqui*:\n` +
    `1. *Você palpita o placar* de cada jogo (ex: \`Brasil 2x1 Marrocos\`)\n` +
    `2. *Ganha pontos* se acertar — placar exato vale 10, só o vencedor já vale 3\n` +
    `3. *Errou? Sem stress* — cada jogo é uma chance nova, e dá pra editar palpite até o jogo começar\n\n` +
    `✨ *Bora começar leve*:\n` +
    `• *dicas* — dicas pra montar palpite\n` +
    `• *regras* — pontuação completa`;

  if (boloes.length === 0) {
    texto += `\n• *entrar em bolão* — quando alguém te mandar um convite, é só clicar no link`;
    texto += `\n\nE se ficar perdida, manda *ajuda* a qualquer momento. Tô aqui. 🍀`;
  } else {
    texto += `\n• *próximos jogos* — eu te mostro os jogos abertos`;
    texto += `\n\nQuando for palpitar, manda assim: \`Brasil 2 a 1 Marrocos\`. Eu mostro um preview e você confirma — *nada vai pro bolão sem você dizer sim*. 🍀`;
  }

  await sendText({ to: msg.waId, text: texto });
}

/**
 * ISSUE-018: data da proxima rodada. Usa bolao padrao do usuario se setado,
 * senao tenta deduzir (1 bolao → ele; >1 → pergunta).
 */
async function handleQuandoComeca(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        `📅 Você ainda não está em nenhum bolão — não tem rodada pra te mostrar.\n\n` +
        `Manda *entrar em bolão* pra começar.`,
    });
    return;
  }

  // Bolao padrao tem preferencia
  const bolaoPadraoId = await bolaoService.getBolaoPadrao(usuarioId);
  const bolaoEscolhido =
    boloes.find((b) => b.id === bolaoPadraoId) ??
    (boloes.length === 1 ? boloes[0] : null);

  if (!bolaoEscolhido) {
    // >1 bolao e sem padrao → mostra geral do primeiro
    await sendText({
      to: msg.waId,
      text:
        `📅 Você participa de *${boloes.length}* bolões — manda *meu bolão padrão* pra setar um padrão, ou *meus bolões* pra ver todos.`,
    });
    return;
  }

  const rodadaAberta = await prisma.rodada.findFirst({
    where: { bolaoId: bolaoEscolhido.id, status: 'ABERTA' },
    include: {
      jogos: {
        where: { status: { in: ['AGENDADO', 'AO_VIVO'] } },
        orderBy: { dataHora: 'asc' },
        take: 1,
      },
    },
    orderBy: { numero: 'desc' },
  });

  if (!rodadaAberta || rodadaAberta.jogos.length === 0) {
    await sendText({
      to: msg.waId,
      text: `📅 O bolão *${bolaoEscolhido.nome}* não tem rodada aberta com jogos agendados agora.`,
    });
    return;
  }

  const proxJogo = rodadaAberta.jogos[0];
  const dataStr = formatarDataHoraComDiaBR(proxJogo.dataHora);
  const fechaStr = formatarDataHoraCurtaBR(rodadaAberta.dataFechamento);
  await sendText({
    to: msg.waId,
    text:
      `📅 *${bolaoEscolhido.nome}* — Rodada ${rodadaAberta.numero}\n\n` +
      `🚀 Próximo jogo: *${proxJogo.timeCasa} x ${proxJogo.timeVisitante}*\n` +
      `🗓️ ${dataStr}\n\n` +
      `🔒 Palpites aceitos até: *${fechaStr}*`,
  });
}

// ============================================================
// Fluxo: CRIAR BOLAO
// ============================================================

/**
 * Bug Humberto 18/05: usuario no estado CRIANDO_BOLAO_NOME ou _SENHA manda
 * "Proximos jogos" / "Quero ver os proximos jogos..." achando que esta
 * conversando normalmente. Bot aceita como nome/senha do bolao e cria um
 * bolao chamado "Proximos jogos" — desastre.
 *
 * Fix: detectar se o input bate intent forte (PROXIMOS_JOGOS / RANKING /
 * MEUS_BOLOES / AJUDA / MENU / CANCELAR / etc) e, se sim, auto-cancelar
 * a criacao + processar a intent ate fim. Mensagem clara informando o
 * que aconteceu.
 *
 * Estados protegidos (NAO escapam): nenhum aqui (CRIAR_BOLAO eh seguro
 * abandonar — nada foi persistido ainda).
 *
 * Returns `true` se interceptou.
 */
async function tentarFsmEscapeCriandoBolao(
  msg: IncomingMessage,
  usuarioId: string,
): Promise<boolean> {
  // Intencoes "fortes" que indicam claramente que user nao queria criar
  const INTENCOES_FORTES_QUE_ESCAPAM = new Set<Intencao>([
    Intencao.PROXIMOS_JOGOS,
    Intencao.JOGOS_HOJE,
    Intencao.RANKING,
    Intencao.MEU_PALPITE,
    Intencao.MEUS_PONTOS,
    Intencao.MEUS_BOLOES,
    Intencao.AJUDA,
    Intencao.MENU,
    Intencao.CANCELAR,
    Intencao.COMO_CONVIDAR,
    Intencao.QUEM_PARTICIPA,
    Intencao.INFO_PRODUTO,
    Intencao.INFO_PRECO,
    Intencao.COMO_PALPITAR,
    Intencao.QUANDO_COMECA,
    Intencao.REGRAS,
    Intencao.RESUMO_BOLOES,
    Intencao.SAIR_BOLAO,
    Intencao.EXCLUIR_BOLAO,
    Intencao.DEFINIR_BOLAO_PADRAO,
    Intencao.RENOMEAR_BOLAO,
    Intencao.PENDENTES,
  ]);

  const { intencao } = parseIntencao(msg.text);
  if (!INTENCOES_FORTES_QUE_ESCAPAM.has(intencao)) return false;

  console.log(
    `[fsm-escape] usuario=${usuarioId} state=CRIANDO_BOLAO_* nova_intent=${intencao} — auto-cancelando criacao`,
  );

  await resetSession(msg.waId);
  await sendText({
    to: msg.waId,
    text:
      `🤔 "${msg.text}" parece um comando, não nome/senha do bolão.\n\n` +
      `Cancelei a criação. Vou processar o comando agora — se você quiser criar bolão depois, é só mandar *criar bolão*.`,
  });
  // Re-processa a mensagem do zero (agora em IDLE, sem state ativo)
  await handleIncomingMessage(msg);
  return true;
}

async function handleCriandoBolaoNome(msg: IncomingMessage, usuarioId: string) {
  // FSM escape: se input bate intent forte, abandona criacao
  if (await tentarFsmEscapeCriandoBolao(msg, usuarioId)) return;

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
  // FSM escape: se input bate intent forte, abandona criacao
  if (await tentarFsmEscapeCriandoBolao(msg, usuarioId)) return;

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
  //
  // HOTFIX 17/05: `criarBolao` agora pode lancar (atomicidade + falha alto
  // no seed de jogos). Antes da mudanca, a sessao ficava presa em
  // CRIANDO_BOLAO_SENHA se o erro borbulhasse pra cima. Aqui resetamos
  // explicitamente antes de propagar a mensagem de erro.
  let bolao;
  try {
    bolao = await bolaoService.criarBolao({
      nome: nomeBolao,
      senhaHash,
      adminId: usuarioId,
      campeonatoId: env.DEFAULT_CAMPEONATO,
      campeonatoNome: 'Copa do Mundo FIFA 2026 — Fase de Grupos',
    });
  } catch (error) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text:
        `❌ ${(error as Error).message}\n\n` +
        `Manda *criar bolão* pra tentar de novo.`,
    });
    return;
  }

  await resetSession(msg.waId);

  const convite = renderizarConvite({
    nomeBolao: bolao.nome,
    codigoBolao: bolao.codigo,
    numeroBot: env.WHATSAPP_BUSINESS_NUMBER,
  });

  // Mensagem 1: confirmacao da criacao + ID
  await sendText({
    to: msg.waId,
    text:
      `🏆 Bolão *${bolao.nome}* criado, craque!\n` +
      `👑 Você é o admin.\n\n` +
      `🎟️ *ID do bolão:* \`#${bolao.codigo}\`\n\n` +
      (convite.linkWaMe
        ? `📨 Pra convidar gente é fácil: encaminha a mensagem abaixo pra galera. Quem clicar no link entra direto no bolão certo — sem precisar digitar nada. 🤙`
        : `📨 Pra convidar gente, encaminha a mensagem abaixo. Quem mandar ela pro meu número entra direto no bolão certo. 🤙`),
  });

  // Mensagem 2: convite pronto pra encaminhar (uma mensagem separada
  // facilita "manter pressionado → encaminhar").
  await sendText({ to: msg.waId, text: convite.textoEncaminhavel });
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

  // ISSUE-004: entrada via CODIGO pula a senha — o ID curto ja eh
  // suficientemente "privado" (admin escolhe pra quem mandar) e a
  // aprovacao manual do admin garante controle. UX: 1 turno do user +
  // 1 do admin (antes eram 3-4 turnos pedindo senha).
  await resetSession(msg.waId);
  const solicitacao = await solicitacaoService.criarSolicitacao(usuarioId, bolao.id);
  await sendText({
    to: msg.waId,
    text:
      `✅ Pedido enviado pro bolão *${bolao.nome}* (\`#${bolao.codigo}\`).\n\n` +
      `📤 Mandei pro admin aprovar. Assim que ele liberar, te aviso aqui e você já começa a palpitar! 🏆`,
  });

  // Notifica o admin
  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(bolao.adminId);
  let textoAdmin =
    `🔔 *Novo pedido de entrada!*\n\n` +
    `👤 *${solicitacao.usuario.nome}* quer entrar no bolão *${bolao.nome}*.\n\n` +
    `Responde com:\n` +
    `• *aprovado* — pra liberar a entrada\n` +
    `• *recusar* — pra rejeitar`;
  if (totalPendentes >= 3) {
    textoAdmin +=
      `\n\n💡 _Você tem ${totalPendentes} pedidos pendentes acumulados. Pode mandar *aprovar todos* pra liberar todo mundo de uma vez._`;
  } else if (totalPendentes > 1) {
    textoAdmin += `\n\n_(Você tem ${totalPendentes} pedidos pendentes no total. Manda *!pendentes* pra ver a lista.)_`;
  }
  await sendText({ to: bolao.admin.whatsappId, text: textoAdmin });
  return true;
}

// ============================================================
// Fluxo: ENTRAR EM BOLAO
// ============================================================
/**
 * Recebe texto livre em ENTRANDO_NOME (pode ser ID `#ABCD12` ou nome
 * livre tipo "Bolão da Jeni").
 *
 * Mudancas vs versao antiga:
 *   - ISSUE-001: extrator de codigo aceita codigos legados (alfabeto amplo)
 *   - ISSUE-002: NAO reseta sessao na 1a falha. Da 3 chances antes de voltar
 *     ao menu. Tentativas vivem em session.ctx.tentativas.
 *   - ISSUE-003: busca fuzzy por nome (tolerante a acento + substring). Se
 *     retornar multiplos boloes, mostra lista numerada (state ESCOLHENDO_BOLAO_PARA_ENTRAR).
 *   - ISSUE-004: quando achar bolao (via codigo ou nome unico), cria
 *     solicitacao direto SEM pedir senha. Admin aprova manualmente.
 */
async function handleEntrandoNome(msg: IncomingMessage, usuarioId: string) {
  const texto = msg.text.trim();
  const session = await getSession(msg.waId);
  const tentativas = (session.ctx?.tentativas ?? 0) + 1;

  // 1) Tenta codigo primeiro (mais especifico, sem ambiguidade)
  const codigo = extrairCodigoBolao(texto);
  if (codigo) {
    const porCodigo = await bolaoService.buscarBolaoAtivoPorCodigo(codigo);
    if (porCodigo) {
      await processarEntradaEmBolao(msg, usuarioId, porCodigo);
      return;
    }
  }

  // 2) Busca fuzzy por nome (tolerante a acento, case, substring)
  const matches = await bolaoService.buscarBoloesAtivosPorNomeFuzzy(texto);

  if (matches.length === 1) {
    await processarEntradaEmBolao(msg, usuarioId, matches[0]);
    return;
  }

  if (matches.length > 1) {
    // Multiplos boloes batem — mostra lista pro user escolher
    const top = matches.slice(0, 8);
    await setSession(msg.waId, {
      state: 'ESCOLHENDO_BOLAO_PARA_ENTRAR',
      ctx: {
        boloesParaEscolher: top.map((b) => ({ id: b.id, nome: b.nome })),
      },
    });
    const lista = formatarBoloesNumerados(
      top.map((b) => ({ id: b.id, nome: b.nome, codigo: b.codigo })),
    );
    await sendText({
      to: msg.waId,
      text:
        `🤔 Achei *${matches.length}* bolões com esse nome. Qual é o seu?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }

  // 3) Nada encontrado — ISSUE-002: nao resetar, contar tentativas
  if (tentativas >= 3) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text:
        `❌ Ainda não achei nenhum bolão com isso. Vou te voltar pro menu.\n\n` +
        `Pede pro admin te mandar o *ID* exato (formato \`#K3MZ8P\`) ou o link de convite.\n\n${menuTexto()}`,
    });
    return;
  }

  // Mantem estado, dica mais especifica a cada tentativa
  await updateSession(msg.waId, { state: 'ENTRANDO_NOME', ctxPatch: { tentativas } });
  const dica =
    tentativas === 1
      ? `Confere com o admin se o *ID* (formato \`#K3MZ8P\`) ou o *nome completo* estão certinhos.`
      : `O ideal é o *ID* mesmo (formato \`#K3MZ8P\`) — sem ele, preciso do *nome exato* do bolão.`;
  await sendText({
    to: msg.waId,
    text:
      `❌ Não achei "${texto}".\n\n${dica}\n\n` +
      `_Tentativa ${tentativas} de 3. Manda *cancelar* pra voltar ao menu._`,
  });
}

/**
 * Caminho comum apos achar UM bolao (via codigo unico ou nome unico):
 *   - se ja faz parte → mensagem amigavel + reset
 *   - se nao → cria solicitacao pendente (ISSUE-004: sem pedir senha)
 *
 * Usado por handleEntrandoNome E por handleEscolhendoBolaoParaEntrar.
 */
async function processarEntradaEmBolao(
  msg: IncomingMessage,
  usuarioId: string,
  bolao: { id: string; nome: string; codigo: string; adminId: string; admin?: { whatsappId: string } },
) {
  if (bolao.adminId === usuarioId) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `👑 Você é o admin do bolão *${bolao.nome}* — já faz parte!\n\n${menuTexto()}`,
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

  // ISSUE-004: nao pede mais senha — cria solicitacao direto
  await resetSession(msg.waId);
  const solicitacao = await solicitacaoService.criarSolicitacao(usuarioId, bolao.id);
  await sendText({
    to: msg.waId,
    text:
      `✅ Pedido enviado pro bolão *${bolao.nome}* (\`#${bolao.codigo}\`).\n\n` +
      `📤 Mandei pro admin aprovar. Assim que ele liberar, te aviso aqui! 🏆`,
  });

  // Notifica admin
  const adminWhatsappId =
    bolao.admin?.whatsappId ??
    (await prisma.usuario.findUnique({ where: { id: bolao.adminId }, select: { whatsappId: true } }))?.whatsappId;
  if (!adminWhatsappId) return;

  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(bolao.adminId);
  let textoAdmin =
    `🔔 *Novo pedido de entrada!*\n\n` +
    `👤 *${solicitacao.usuario.nome}* quer entrar no bolão *${bolao.nome}*.\n\n` +
    `Responde com:\n` +
    `• *aprovado* — pra liberar a entrada\n` +
    `• *recusar* — pra rejeitar`;
  if (totalPendentes >= 3) {
    textoAdmin +=
      `\n\n💡 _Você tem ${totalPendentes} pedidos pendentes. Pode mandar *aprovar todos* pra liberar todo mundo de uma vez._`;
  } else if (totalPendentes > 1) {
    textoAdmin += `\n\n_(Você tem ${totalPendentes} pedidos pendentes. Manda *!pendentes* pra ver a lista.)_`;
  }
  await sendText({ to: adminWhatsappId, text: textoAdmin });
}

/**
 * Handler do state ESCOLHENDO_BOLAO_PARA_ENTRAR (ISSUE-003). Usuario
 * escolheu entre multiplos boloes que bateram com o nome dado.
 */
async function handleEscolhendoBolaoParaEntrar(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *entrar em bolão* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o *número* ou o nome de um destes bolões:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  // Re-busca pra ter admin + codigo completos
  const bolao = await prisma.bolao.findUnique({
    where: { id: escolhido.id },
    include: { admin: true },
  });
  if (!bolao) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Não achei esse bolão. Manda *entrar em bolão* de novo.' });
    return;
  }
  await processarEntradaEmBolao(msg, usuarioId, bolao);
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

  // v3.5.0: oferece mais jogos se fechou o lote
  if (registrados > 0) {
    await talvezOferecerMaisJogos(msg, usuarioId, rodadaId);
  }
}

// ============================================================
// Fluxo: PALPITE INLINE EM IDLE (3 passos)
//   1. handlePalpiteInlineEmIdle: detecta bolao(es) + se >1, pergunta qual
//   2. handleEscolhendoBolaoParaPalpitar: recebe escolha + extrai palpites
//   3. handleConfirmandoPalpitesInline: registra apos confirmacao do user
// ============================================================
/**
 * Step 1: usuario mandou texto que parece palpite em IDLE.
 * Lista os bolaes com rodada aberta:
 *   - 0 → mensagem amigavel
 *   - 1 → pula direto pro step 2 (extracao + preview)
 *   - >1 → pergunta qual bolao primeiro (state ESCOLHENDO_BOLAO_PARA_PALPITAR)
 */
async function handlePalpiteInlineEmIdle(msg: IncomingMessage, usuarioId: string) {
  const boloesComRodadaAberta = await listarBoloesComRodadaAberta(usuarioId);

  if (boloesComRodadaAberta.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '🤔 Não achei rodada aberta em nenhum dos seus bolões agora.\n\n' +
        'Pra ver o que está aberto, manda *próximos jogos*.',
    });
    return;
  }

  if (boloesComRodadaAberta.length === 1) {
    const b = boloesComRodadaAberta[0];
    await iniciarConfirmacaoPalpites(msg, usuarioId, msg.text, b.bolaoId, b.nome, b.rodadaId);
    return;
  }

  // ISSUE-016: se ha bolao padrao setado E ele esta com rodada aberta, usa direto
  const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
  if (padraoId) {
    const match = boloesComRodadaAberta.find((b) => b.bolaoId === padraoId);
    if (match) {
      await iniciarConfirmacaoPalpites(msg, usuarioId, msg.text, match.bolaoId, match.nome, match.rodadaId);
      return;
    }
  }

  // ISSUE-015: se o palpite eh UMA LINHA SO + parseou em UM jogo + esse jogo
  // existe em MULTIPLOS boloes com rodada aberta, aplica em TODOS sem
  // perguntar. UX: usuario digita "Brasil 2x1 Marrocos" uma vez e fica
  // registrado em todos os bolaes da Copa onde ele participa.
  const linhas = msg.text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (linhas.length === 1) {
    const parsed = parseIntencao(linhas[0]);
    if (parsed.intencao === Intencao.PALPITE_INLINE && parsed.palpite) {
      const p = parsed.palpite;
      const matches = await palpiteService.buscarBoloesComJogo(usuarioId, p.timeCasa, p.timeVisitante);
      if (matches.length > 1) {
        // Bug Jeni 17/05: ANTES registrava direto sem preview. Agora pede
        // confirmacao mostrando todos os boloes onde vai aplicar.
        await setSession(msg.waId, {
          state: 'CONFIRMANDO_PALPITE_MULTI_BOLAO',
          ctx: {
            palpiteMultiBolaoPendente: {
              timeCasa: p.timeCasa,
              timeVisitante: p.timeVisitante,
              golsCasa: p.golsCasa,
              golsVisitante: p.golsVisitante,
              bolaoNomes: matches.map((m) => m.bolaoNome),
            },
          },
        });
        const placarLabel = `${p.timeCasa} ${p.golsCasa} × ${p.golsVisitante} ${p.timeVisitante}`;
        const listaBoloes = matches.map((m) => `• ${m.bolaoNome}`).join('\n');
        await sendText({
          to: msg.waId,
          text:
            `📝 Vou registrar o palpite:\n\n` +
            `*${placarLabel}*\n\n` +
            `Aplicado em *${matches.length}* bolões:\n${listaBoloes}\n\n` +
            `Confirma? _(responda *sim*, *não* ou *refazer*)_`,
        });
        return;
      }
      // ISSUE-014: parseou palpite mas nao casou jogo em nenhuma rodada aberta
      if (matches.length === 0) {
        // Lista jogos abertos pra ajudar o usuario
        const sample = boloesComRodadaAberta[0];
        const rodada = await prisma.rodada.findUnique({
          where: { id: sample.rodadaId },
          include: {
            jogos: {
              where: { status: 'AGENDADO' },
              orderBy: { dataHora: 'asc' },
              take: 5,
            },
          },
        });
        const lista = rodada?.jogos.map((j) => `• ${j.timeCasa} x ${j.timeVisitante}`).join('\n') ?? '';
        await sendText({
          to: msg.waId,
          text:
            `🤔 Não achei jogo *${p.timeCasa} x ${p.timeVisitante}* em nenhuma rodada aberta.\n\n` +
            (lista
              ? `Jogos abertos no *${sample.nome}*:\n${lista}\n\nQuis dizer um destes?`
              : `Manda *próximos jogos* pra ver o que está aberto pra palpitar.`),
        });
        return;
      }
    }
  }

  // >1 bolao com rodada aberta — guarda texto cru e pergunta qual
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PARA_PALPITAR',
    ctx: {
      palpiteTextoCru: msg.text,
      boloesParaEscolher: boloesComRodadaAberta.map((b) => ({
        id: b.bolaoId,
        nome: b.nome,
      })),
    },
  });
  const lista = formatarBoloesNumerados(
    boloesComRodadaAberta.map((b) => ({ id: b.bolaoId, nome: b.nome, codigo: b.codigo })),
  );
  await sendText({
    to: msg.waId,
    text:
      `🤔 Pra qual bolão é esse palpite?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function listarBoloesComRodadaAberta(
  usuarioId: string,
): Promise<Array<{ bolaoId: string; nome: string; codigo: string; rodadaId: string }>> {
  const participacoes = await prisma.participacao.findMany({
    where: { usuarioId },
    include: {
      bolao: {
        include: {
          rodadas: {
            where: { status: 'ABERTA' },
            orderBy: { numero: 'desc' },
            take: 1,
          },
        },
      },
    },
  });
  return participacoes
    .filter((p) => p.bolao.status === 'ATIVO' && p.bolao.rodadas.length > 0)
    .map((p) => ({
      bolaoId: p.bolao.id,
      nome: p.bolao.nome,
      codigo: p.bolao.codigo,
      rodadaId: p.bolao.rodadas[0].id,
    }));
}

/**
 * Step 2 handler: usuario respondeu "1" ou "Bolao da Jeni".
 */
async function handleEscolhendoBolaoParaPalpitar(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  const textoCru = session.ctx?.palpiteTextoCru;
  if (opcoes.length === 0 || !textoCru) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda o palpite de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o *número* ou o nome de um destes bolões:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  // Acha a rodada aberta do bolao escolhido
  const rodada = await prisma.rodada.findFirst({
    where: { bolaoId: escolhido.id, status: 'ABERTA' },
    orderBy: { numero: 'desc' },
  });
  if (!rodada) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `❌ O bolão *${escolhido.nome}* não tem rodada aberta agora.`,
    });
    return;
  }
  await iniciarConfirmacaoPalpites(
    msg,
    usuarioId,
    textoCru,
    escolhido.id,
    escolhido.nome,
    rodada.id,
  );
}

/**
 * Step 2 (parte 2): extrai palpites do texto cru (regex + LLM combinados)
 * e apresenta preview pra confirmacao (state CONFIRMANDO_PALPITES_INLINE).
 */
async function iniciarConfirmacaoPalpites(
  msg: IncomingMessage,
  usuarioId: string,
  textoCru: string,
  bolaoId: string,
  bolaoNome: string,
  rodadaId: string,
) {
  const rodada = await prisma.rodada.findUnique({
    where: { id: rodadaId },
    include: { jogos: { where: { status: { in: ['AGENDADO', 'AO_VIVO'] } } } },
  });
  if (!rodada || rodada.jogos.length === 0) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `❌ O bolão *${bolaoNome}* não tem jogos abertos pra palpite agora.`,
    });
    return;
  }
  const jogos = rodada.jogos;

  // 1) Regex (rapido, cobre formato canonico)
  const regexResult = parseMultiplePalpitesDetalhado(textoCru);

  // 2) LLM (sempre — robusto a frases naturais como "Brasil perde do
  //    Marrocos de 1 a 0"). Usa os jogos da rodada como ground truth.
  const llmPalpites = await extrairPalpites(
    textoCru,
    jogos.map((j) => ({ timeCasa: j.timeCasa, timeVisitante: j.timeVisitante })),
  );

  // 3) Mescla os 2 resultados, dedup por jogoId. LLM vence empate
  //    porque tende a normalizar nomes pros oficiais da rodada.
  const acumulado = new Map<
    string,
    { jogoId: string; timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number }
  >();

  // helper local: dado um par (timeCasa, timeVisitante), acha o jogoId
  const acharJogo = (tc: string, tv: string) => {
    const normTc = normalizeTeamName(tc);
    const normTv = normalizeTeamName(tv);
    return jogos.find((j) => {
      const jc = normalizeTeamName(j.timeCasa);
      const jv = normalizeTeamName(j.timeVisitante);
      return (jc.includes(normTc) || normTc.includes(jc)) && (jv.includes(normTv) || normTv.includes(jv));
    });
  };

  for (const p of regexResult.ok) {
    const j = acharJogo(p.timeCasa, p.timeVisitante);
    if (j) {
      acumulado.set(j.id, {
        jogoId: j.id,
        timeCasa: j.timeCasa,
        timeVisitante: j.timeVisitante,
        golsCasa: p.golsCasa,
        golsVisitante: p.golsVisitante,
      });
    }
  }
  for (const p of llmPalpites) {
    const j = acharJogo(p.timeCasa, p.timeVisitante);
    if (j) {
      // LLM vence (sobrescreve regex)
      acumulado.set(j.id, {
        jogoId: j.id,
        timeCasa: j.timeCasa,
        timeVisitante: j.timeVisitante,
        golsCasa: p.golsCasa,
        golsVisitante: p.golsVisitante,
      });
    }
  }

  const palpitesParaConfirmar = [...acumulado.values()];

  // Linhas descartadas pelo regex que o LLM tambem nao pegou
  const naoEntendidos = regexResult.descartadas.filter((linha) => {
    // se o LLM extraiu algo "similar" pra essa linha (mesmo time
    // mencionado), considera como entendido
    const norm = normalizeTeamName(linha);
    for (const p of palpitesParaConfirmar) {
      if (
        norm.includes(normalizeTeamName(p.timeCasa)) ||
        norm.includes(normalizeTeamName(p.timeVisitante))
      ) {
        return false;
      }
    }
    return true;
  });

  if (palpitesParaConfirmar.length === 0) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text:
        `🤔 Não consegui entender nenhum palpite dessa mensagem pro bolão *${bolaoNome}*.\n\n` +
        `Tenta de novo no formato *Time1 NxN Time2* (ex: \`Brasil 2x1 Marrocos\`).\n` +
        `Pra ver os jogos abertos: *próximos jogos*.`,
    });
    return;
  }

  await setSession(msg.waId, {
    state: 'CONFIRMANDO_PALPITES_INLINE',
    ctx: {
      palpiteRodadaIdEscolhida: rodadaId,
      palpiteBolaoNomeEscolhido: bolaoNome,
      palpitesParaConfirmar,
      palpitesNaoEntendidos: naoEntendidos,
    },
  });

  const linhasPalpite = palpitesParaConfirmar
    .map(
      (p, i) =>
        `${i + 1}. ${p.timeCasa} ${p.golsCasa} × ${p.golsVisitante} ${p.timeVisitante}`,
    )
    .join('\n');
  let texto = `📝 Vou registrar ${palpitesParaConfirmar.length} palpite(s) no *${bolaoNome}*:\n\n${linhasPalpite}`;
  if (naoEntendidos.length > 0) {
    const lista = naoEntendidos.slice(0, 3).map((l) => `• "${l}"`).join('\n');
    texto += `\n\n⚠️ Não entendi:\n${lista}`;
  }
  texto += `\n\nConfirma? _(responda *sim*, *não* ou *refazer*)_`;
  void bolaoId; // referencia futura — guardado p log/telemetria
  await sendText({ to: msg.waId, text: texto });
}

/**
 * Step 3: usuario respondeu sim/nao/refazer.
 */
async function handleConfirmandoPalpitesInline(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const rodadaId = session.ctx?.palpiteRodadaIdEscolhida;
  const bolaoNome = session.ctx?.palpiteBolaoNomeEscolhido ?? 'o bolão';
  const palpites = session.ctx?.palpitesParaConfirmar ?? [];
  if (!rodadaId || palpites.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda o palpite de novo.' });
    return;
  }
  const texto = msg.text.trim().toLowerCase();
  // "refazer" → cancela mas mantem usuario livre pra mandar de novo
  if (/^(refazer|refaz|de novo|tentar de novo)\b/.test(texto)) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: '🔄 Beleza, esqueci esses palpites. Manda de novo no formato que preferir.',
    });
    return;
  }
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: '👍 Beleza, não registrei nada. Quando quiser palpitar de novo é só mandar.',
    });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: '🤔 Responde *sim* pra confirmar, *não* pra cancelar, ou *refazer* pra mandar de novo.',
    });
    return;
  }
  // ISSUE-013: antes de registrar, verifica se algum palpite tem placar absurdo
  const absurdo = palpites.find((p) => !validarPlacar(p.golsCasa, p.golsVisitante).ok);
  if (absurdo) {
    await updateSession(msg.waId, {
      state: 'CONFIRMANDO_PALPITE_PLACAR_ABSURDO',
      ctxPatch: {
        palpiteAbsurdoContexto: {
          timeCasa: absurdo.timeCasa,
          timeVisitante: absurdo.timeVisitante,
          golsCasa: absurdo.golsCasa,
          golsVisitante: absurdo.golsVisitante,
        },
      },
    });
    await sendText({
      to: msg.waId,
      text:
        `⚠️ Placar incomum: *${absurdo.timeCasa} ${absurdo.golsCasa} × ${absurdo.golsVisitante} ${absurdo.timeVisitante}*.\n\n` +
        `Tem certeza disso? Responde *sim* pra registrar mesmo, ou *não* pra cancelar todos os palpites.`,
    });
    return;
  }
  await registrarPalpitesConfirmados(msg, usuarioId, rodadaId, bolaoNome, palpites);
}

/**
 * Bug Jeni 17/05: confirma o auto-apply multi-bolao do ISSUE-015.
 * Antes desse handler, o palpite ia direto pro registro sem preview.
 * Sim → aplica em todos os bolaes que tem o jogo. Nao/refazer → cancela.
 */
async function handleConfirmandoPalpiteMultiBolao(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const pendente = session.ctx?.palpiteMultiBolaoPendente;
  if (!pendente) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda o palpite de novo.' });
    return;
  }
  const texto = msg.text.trim().toLowerCase();
  if (/^(refazer|refaz|de novo|tentar de novo)\b/.test(texto)) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: '🔄 Beleza, esqueci esse palpite. Manda de novo no formato que preferir.',
    });
    return;
  }
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: '👍 Beleza, não registrei nada. Quando quiser palpitar de novo é só mandar.',
    });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({
      to: msg.waId,
      text: '🤔 Responde *sim* pra confirmar, *não* pra cancelar, ou *refazer* pra mandar de novo.',
    });
    return;
  }
  // Registra em todos os boloes que tem o jogo
  const { registrados, erros } = await palpiteService.registrarPalpiteEmTodosBoloes({
    usuarioId,
    timeCasa: pendente.timeCasa,
    timeVisitante: pendente.timeVisitante,
    golsCasa: pendente.golsCasa,
    golsVisitante: pendente.golsVisitante,
  });
  await resetSession(msg.waId);
  const placarLabel = `${pendente.timeCasa} ${pendente.golsCasa} × ${pendente.golsVisitante} ${pendente.timeVisitante}`;
  let textoResp = registrados.length === 1
    ? `${confirmacao()} Palpite registrado: *${placarLabel}* (no *${registrados[0].bolaoNome}*).`
    : `${confirmacao()} Palpite registrado: *${placarLabel}*\n\nAplicado em *${registrados.length}* bolões:\n${registrados.map((r) => `• ${r.bolaoNome}`).join('\n')}`;
  if (erros.length > 0) {
    textoResp += `\n\n⚠️ Não rolou em:\n${erros.map((e) => `• ${e.bolaoNome}: ${e.motivo}`).join('\n')}`;
  }
  await sendText({ to: msg.waId, text: textoResp });
}

async function registrarPalpitesConfirmados(
  msg: IncomingMessage,
  usuarioId: string,
  rodadaId: string,
  bolaoNome: string,
  palpites: Array<{ timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number }>,
) {
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
    } catch (err) {
      erros.push(`• ${p.timeCasa} x ${p.timeVisitante}: ${(err as Error).message}`);
    }
  }
  await resetSession(msg.waId);
  let resposta = `${confirmacao()} ${registrados} palpite(s) registrado(s) no *${bolaoNome}*!`;
  if (erros.length > 0) resposta += `\n\n⚠️ Não rolou:\n${erros.join('\n')}`;
  await sendText({ to: msg.waId, text: resposta });

  // v3.5.0: se o user fechou todos os jogos do lote visível, oferece mais
  if (registrados > 0) {
    await talvezOferecerMaisJogos(msg, usuarioId, rodadaId);
  }
}

/**
 * Handler ISSUE-013: usuario confirma se quer mesmo registrar placar absurdo.
 */
async function handleConfirmandoPalpitePlacarAbsurdo(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const rodadaId = session.ctx?.palpiteRodadaIdEscolhida;
  const bolaoNome = session.ctx?.palpiteBolaoNomeEscolhido ?? 'o bolão';
  const palpites = session.ctx?.palpitesParaConfirmar ?? [];
  if (!rodadaId || palpites.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda o palpite de novo.' });
    return;
  }
  const resp = await interpretarSimNao(msg.text);
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Cancelei tudo. Manda os palpites de novo quando quiser.' });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({ to: msg.waId, text: '🤔 Manda *sim* ou *não*.' });
    return;
  }
  // SIM — registra mesmo com placar incomum
  await registrarPalpitesConfirmados(msg, usuarioId, rodadaId, bolaoNome, palpites);
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

// (dead code `registrarPalpiteInline` removido em 2026-05-18 — nunca foi
// chamado em lugar algum. O fluxo correto eh `iniciarConfirmacaoPalpites`
// que mostra preview antes de registrar.)

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
  const lista = formatarBoloesNumerados(adminados);
  await sendText({
    to: msg.waId,
    text: `📨 Pra qual bolão você quer o convite?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número ou o nome de um destes:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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
  const convite = renderizarConvite({
    nomeBolao: bolao.nome,
    codigoBolao: bolao.codigo,
    numeroBot: env.WHATSAPP_BUSINESS_NUMBER,
  });
  // Mensagem 1: explicacao curta pro admin entender como funciona
  await sendText({
    to: msg.waId,
    text: convite.linkWaMe
      ? `📨 *Convite pronto pro bolão "${bolao.nome}"*\n\nEncaminha a mensagem abaixo pra galera (grupo ou DM). Quem clicar no link entra direto no bolão certo — sem precisar copiar nada. 🤙`
      : convite.textoPrincipal,
  });
  // Mensagem 2 (separada pra facilitar "manter pressionado → encaminhar")
  await sendText({ to: msg.waId, text: convite.textoEncaminhavel });
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
          '🤷 Você só é admin dos seus bolões — admin não sai assim.\n\nSe quiser encerrar o bolão de vez, manda *excluir bolão*.',
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
  const lista = formatarBoloesNumerados(elegiveis);
  await sendText({
    to: msg.waId,
    text: `De qual bolão você quer sair?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({ to: msg.waId, text: `🤔 Não identifiquei. Manda o número ou o nome de um destes:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}` });
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
  // ISSUE-022: deixar claro o que se perde
  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai sair do bolão *${bolao.nome}* mesmo?\n\n` +
      `*O que acontece:*\n` +
      `• 🏆 Você *some do ranking* desse bolão (não vai mais aparecer na classificação)\n` +
      `• 📋 Seus palpites passados *ficam no histórico* (mas sem somar pontos novos)\n` +
      `• 🔕 Você *não recebe mais notificações* de jogos desse bolão\n` +
      `• 🤝 Pra voltar depois, você precisa pedir entrada de novo (admin aprova)\n\n` +
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
  const lista = formatarBoloesNumerados(boloes);
  await sendText({
    to: msg.waId,
    text: `De qual bolão você quer ver os participantes?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({ to: msg.waId, text: `🤔 Não identifiquei. Manda o número ou o nome de um destes:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}` });
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
// v3.8.0 — Progresso de palpites no bolão (qualquer participante)
// ============================================================
/**
 * Mostra, pro user, quem palpitou e quem ainda não palpitou em CADA
 * bolão ativo dele. Diferente de MEU_PALPITE (sobre o próprio user),
 * este é sobre TODOS os participantes — útil pra admin cobrar e pra
 * participantes verem que não estão sozinhos.
 *
 * Não é sensível: a contagem de palpites por pessoa não revela o
 * conteúdo dos palpites (que continua privado). Só "quantos jogos
 * cada um já palpitou".
 *
 * Reaproveita a lógica que já está em send-reminders.job.ts:28 e
 * send-palpite-call.job.ts:103 (jaPalpitou = Set de usuarioIds), mas
 * sob demanda pelo user (não cron).
 */
async function handleProgressoPalpites(msg: IncomingMessage, usuarioId: string) {
  void incContador('intent.PROGRESSO_PALPITES');
  const boloes = await bolaoService.listarBoloesAtivosDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '📭 Você não tem bolões ativos pra ver o progresso.',
    });
    return;
  }

  const agora = new Date();
  const partes: string[] = [];

  for (const b of boloes) {
    const rodada = await prisma.rodada.findFirst({
      where: { bolaoId: b.id, status: 'ABERTA' },
      include: {
        jogos: {
          where: { dataHora: { gte: agora }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
        },
        palpites: {
          include: {
            usuario: { select: { id: true, nome: true } },
            jogos: { select: { jogoId: true } },
          },
        },
        bolao: {
          include: {
            participacoes: { include: { usuario: { select: { id: true, nome: true } } } },
          },
        },
      },
    });

    if (!rodada || rodada.jogos.length === 0) continue;

    const totalJogosAbertos = rodada.jogos.length;
    const adminId = rodada.bolao.adminId;

    // Mapa usuarioId → quantos jogos da rodada ele palpitou (só jogos abertos)
    const jogosAbertosIds = new Set(rodada.jogos.map((j) => j.id));
    const palpitesPorUsuario = new Map<string, number>();
    for (const p of rodada.palpites) {
      const cnt = p.jogos.filter((pj) => jogosAbertosIds.has(pj.jogoId)).length;
      palpitesPorUsuario.set(p.usuarioId, cnt);
    }

    const participantes = rodada.bolao.participacoes.map((part) => ({
      id: part.usuarioId,
      nome: part.usuario.nome,
      ehAdmin: part.usuarioId === adminId,
      palpitouQtd: palpitesPorUsuario.get(part.usuarioId) ?? 0,
    }));

    const comPalpite = participantes.filter((p) => p.palpitouQtd > 0);
    const semPalpite = participantes.filter((p) => p.palpitouQtd === 0);

    // Ordena: palpitantes por qtd desc; pendentes por nome
    comPalpite.sort((a, b) => b.palpitouQtd - a.palpitouQtd || a.nome.localeCompare(b.nome));
    semPalpite.sort((a, b) => a.nome.localeCompare(b.nome));

    const linhasCom = comPalpite
      .map((p) => {
        const adm = p.ehAdmin ? ' 👑' : '';
        const fechou = p.palpitouQtd >= totalJogosAbertos ? ' ✅' : '';
        return `• ${p.nome}${adm} — ${p.palpitouQtd}/${totalJogosAbertos} palpites${fechou}`;
      })
      .join('\n');

    const linhasSem = semPalpite
      .map((p) => `• ${p.nome}${p.ehAdmin ? ' 👑' : ''}`)
      .join('\n');

    const blocos: string[] = [
      `🏆 *${b.nome}* — Fase de Grupos`,
      `📊 ${participantes.length} participantes / ${totalJogosAbertos} jogos abertos`,
    ];
    if (comPalpite.length > 0) {
      blocos.push(`✅ *Já palpitaram (${comPalpite.length}):*\n${linhasCom}`);
    }
    if (semPalpite.length > 0) {
      blocos.push(`⚪ *Ainda não palpitaram (${semPalpite.length}):*\n${linhasSem}`);
    }

    // Convite pra ação só se o user é admin do bolão E tem pendentes
    if (usuarioId === adminId && semPalpite.length > 0) {
      blocos.push(`💬 _Pra cutucar quem não palpitou, manda *cutucar pendentes* — eu mando DM pra cada uma citando você._`);
    }

    partes.push(blocos.join('\n\n'));
  }

  if (partes.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '⚽ Não tem rodada aberta com jogos pendentes nos seus bolões agora.\n\n' +
        'Manda *próximos jogos* quando abrir uma nova rodada.',
    });
    return;
  }

  await sendText({
    to: msg.waId,
    text: `${partes.join('\n\n━━━━━━━━━━\n\n')}\n\n_(O placar do palpite de cada um continua privado — só mostro a quantidade.)_`,
  });
}

// ============================================================
// v3.8.0 — Cutucar pendentes (admin only)
// ============================================================
/**
 * Admin do bolão pede pra bot mandar DM pra cada participante que ainda
 * não palpitou. Cada DM identifica o admin como quem pediu, pra dar
 * accountability (não é mensagem anônima do bot).
 *
 * Idempotência: flag Redis `cutucar_admin:{bolaoId}` com TTL de 30 min —
 * admin não pode spammar.
 *
 * Reaproveita exatamente a lógica de listagem do
 * `handleProgressoPalpites`, mas além de listar, manda DM.
 */
async function handleCutucarPendentes(msg: IncomingMessage, usuarioId: string) {
  void incContador('intent.CUTUCAR_PENDENTES');

  const adminados = await bolaoService.listarBoloesQueAdministra(usuarioId);
  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text:
        '🤷 Esse comando é só pra *admin* do bolão. Você não administra nenhum bolão ativo no momento.\n\n' +
        'Pra ver quem palpitou no bolão que você participa, manda *progresso do bolão*.',
    });
    return;
  }

  // Se admin de mais de 1, pega bolão padrão se setado; senão pergunta
  let bolaoAlvo: { id: string; nome: string } | null = null;
  if (adminados.length === 1) {
    bolaoAlvo = { id: adminados[0].id, nome: adminados[0].nome };
  } else {
    const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
    const padrao = adminados.find((b) => b.id === padraoId);
    if (padrao) {
      bolaoAlvo = { id: padrao.id, nome: padrao.nome };
    }
  }

  if (!bolaoAlvo) {
    // Múltiplos bolões adminados sem padrão — UX simples: pede pra
    // mandar "cutucar pendentes do <nome>". Não vale a complexidade de
    // FSM novo só pra esse caso raro (admin com >1 bolão sem padrão).
    const nomes = adminados.map((b) => `• ${b.nome}`).join('\n');
    await sendText({
      to: msg.waId,
      text:
        `🤔 Você é admin de mais de um bolão:\n\n${nomes}\n\n` +
        `Define um como padrão com *definir bolão padrão* e tenta de novo, ou manda *cutucar pendentes do <nome>* (em breve).`,
    });
    return;
  }

  // Idempotência: 1x a cada 30min por bolão
  const flagKey = `cutucar_admin:${bolaoAlvo.id}`;
  const flag = await redis.get(flagKey);
  if (flag) {
    await sendText({
      to: msg.waId,
      text:
        `⏱️ Já cutuquei os pendentes do *${bolaoAlvo.nome}* há pouco. ` +
        `Aguarda uns minutos pra não encher a caixa da galera. 🙏`,
    });
    return;
  }

  const agora = new Date();
  const rodada = await prisma.rodada.findFirst({
    where: { bolaoId: bolaoAlvo.id, status: 'ABERTA' },
    include: {
      jogos: {
        where: { dataHora: { gte: agora }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
      },
      palpites: { select: { usuarioId: true, jogos: { select: { jogoId: true } } } },
      bolao: { include: { participacoes: { include: { usuario: true } } } },
    },
  });

  if (!rodada || rodada.jogos.length === 0) {
    await sendText({
      to: msg.waId,
      text: `📭 Não tem rodada aberta no *${bolaoAlvo.nome}* — nada pra cutucar.`,
    });
    return;
  }

  // Pendentes = participantes com 0 palpites em jogos abertos (excluindo o próprio admin)
  const jogosAbertosIds = new Set(rodada.jogos.map((j) => j.id));
  const palpitesPorUsuario = new Map<string, number>();
  for (const p of rodada.palpites) {
    const cnt = p.jogos.filter((pj) => jogosAbertosIds.has(pj.jogoId)).length;
    palpitesPorUsuario.set(p.usuarioId, cnt);
  }

  const adminNome = rodada.bolao.participacoes.find((p) => p.usuarioId === usuarioId)?.usuario.nome ?? 'O admin';
  const pendentes = rodada.bolao.participacoes.filter((p) => {
    if (p.usuarioId === usuarioId) return false; // não cutuca o próprio admin
    return (palpitesPorUsuario.get(p.usuarioId) ?? 0) === 0;
  });

  if (pendentes.length === 0) {
    await sendText({
      to: msg.waId,
      text: `🎉 Ninguém pendente no *${bolaoAlvo.nome}*! Todo mundo já palpitou. 🍀`,
    });
    return;
  }

  // Marca a flag ANTES de mandar — se o batch falhar no meio, evita reenvio em loop
  await redis.setex(flagKey, 30 * 60, '1');

  const textoDm =
    `🏁 *${adminNome}* (admin do bolão *${bolaoAlvo.nome}*) pediu pra te lembrar de palpitar!\n\n` +
    `Você ainda tem palpites pendentes. Manda *próximos jogos* pra ver o que falta. 🍀`;

  let enviados = 0;
  let falhas = 0;
  for (const p of pendentes) {
    try {
      await sendText({ to: p.usuario.whatsappId, text: textoDm });
      enviados++;
    } catch (err) {
      falhas++;
      console.warn(`[cutucar-pendentes] falha pra ${p.usuario.nome}:`, err);
    }
  }

  const resumo =
    `✅ Cutuquei *${enviados}* pendente(s) do *${bolaoAlvo.nome}*` +
    (falhas > 0 ? ` (${falhas} falha(s))` : '') +
    `.\n\n_(Próximo cutuque liberado em 30 min)_`;
  await sendText({ to: msg.waId, text: resumo });
}

// ============================================================
// Fluxo: PALPITES_AMBIGUO
// ============================================================
/**
 * Usuario digitou so "palpites" — ambiguo entre 3 intents possiveis.
 * Bot apresenta lista numerada e espera resposta no novo state.
 */
async function handlePalpitesAmbiguo(msg: IncomingMessage) {
  await setSession(msg.waId, { state: 'ESCOLHENDO_INTENCAO_PALPITES' });
  await sendText({
    to: msg.waId,
    text:
      '🤔 *Palpites* — me diz qual você quer:\n\n' +
      '1. Ver os meus palpites já dados 📋\n' +
      '2. Fazer novos palpites (jogos abertos) ⚽\n' +
      '3. Ver as regras de pontuação 📖\n\n' +
      '_Pode responder com o número correspondente que é mais fácil pra você._',
  });
}

async function handleEscolhendoIntencaoPalpites(
  msg: IncomingMessage,
  usuarioId: string,
) {
  const texto = msg.text.trim();
  // Aceita "1"/"2"/"3" como atalho, ou tenta classificar a frase
  const matchNum = texto.match(/^([123])\b/);
  let escolha: 1 | 2 | 3 | null = null;
  if (matchNum) {
    escolha = Number(matchNum[1]) as 1 | 2 | 3;
  } else {
    // Reusa o parser pra ver se ele disse algo claro tipo "meus palpites"
    const parsed = parseIntencao(texto);
    if (parsed.intencao === Intencao.MEU_PALPITE) escolha = 1;
    else if (parsed.intencao === Intencao.PROXIMOS_JOGOS) escolha = 2;
    else if (parsed.intencao === Intencao.REGRAS) escolha = 3;
  }

  if (!escolha) {
    await sendText({
      to: msg.waId,
      text:
        '🤔 Não identifiquei. Manda *1*, *2* ou *3* — ou então o que você quer:\n\n' +
        '1. *Meus palpites* — ver os palpites já dados\n' +
        '2. *Próximos jogos* — palpitar nos jogos abertos\n' +
        '3. *Regras* — como funciona a pontuação',
    });
    return;
  }

  await resetSession(msg.waId);
  if (escolha === 1) {
    await handleMeusPalpites(msg, usuarioId);
  } else if (escolha === 2) {
    await handleProximosJogos(msg, usuarioId);
  } else {
    await sendText({ to: msg.waId, text: regrasTexto() });
  }
}

// ============================================================
// Helper: intercepta "nome de bolão sozinho" no IDLE
// ============================================================
/**
 * Bug Humberto 18/05: o usuario manda "Bolao teste oficial" (depois de ver
 * a lista em "meus boloes") e o LLM classifier classifica como CRIAR_BOLAO
 * (mesmo sem verbo de acao). Bot inicia fluxo de criacao, criando um bolao
 * duplicado por engano.
 *
 * Fix: antes de despachar CRIAR_BOLAO, fuzzy-match o raw com boloes que o
 * user ja participa. Se match unico, oferece menu contextual ("voce ja
 * participa! quer: ranking / meus palpites / criar bolao novo com mesmo
 * nome?"). Se >1 match, lista. Se 0 match, segue fluxo normal de criacao.
 *
 * Retorna `true` se interceptou (caller nao deve seguir o fluxo padrao).
 */
async function tentarOferecerMenuContextualPorNomeBolao(
  msg: IncomingMessage,
  usuarioId: string,
  raw: string,
): Promise<boolean> {
  // Heuristica: so faz sentido pra inputs curtos sem verbo de acao explicito.
  // Se tem "criar/abrir/montar/fazer/novo", o user definitivamente quer
  // criar (mesmo que o nome bate com bolao existente — sera permitido).
  const textoLower = raw.toLowerCase().trim();
  const temVerboCriar = /\b(?:criar|abrir|montar|fazer|nov[ao]|novinho)\b/.test(textoLower);
  if (temVerboCriar) return false;

  // Texto muito curto (1-2 chars) ou muito longo (>60) — nao tenta match
  if (textoLower.length < 3 || textoLower.length > 60) return false;

  // Busca boloes do user (incluindo encerrados — fuzzy match historico)
  const todos = await bolaoService.listarBoloesDoUsuarioComHistorico(usuarioId);
  if (todos.length === 0) return false;

  // Fuzzy match: usa o mesmo helper de matcher (escolherBolaoDaLista)
  const escolhido = await escolherBolaoDaLista(
    raw,
    todos.map((b) => ({ id: b.id, nome: b.nome })),
  );
  if (!escolhido) return false;

  const bolao = todos.find((b) => b.id === escolhido.id);
  if (!bolao) return false;

  const ehAdmin = bolao.adminId === usuarioId;
  const ehEncerrado = bolao.status === 'FINALIZADO';
  const statusLabel = ehEncerrado ? ' 🏁 _(encerrado)_' : '';
  const adminLabel = ehAdmin ? ' 👑 _(admin)_' : '';

  // Menu contextual — opcoes diferentes pra encerrado vs ativo, admin vs nao
  const opcoes: string[] = [];
  opcoes.push(`*ranking* — ver classificação`);
  opcoes.push(`*meus palpites* — histórico no bolão`);
  opcoes.push(`*meus pontos* — sua pontuação`);
  if (!ehEncerrado) {
    opcoes.push(`*próximos jogos* — agenda pra palpitar`);
    if (ehAdmin) {
      opcoes.push(`*como convido* — pegar link wa.me`);
    }
  }
  opcoes.push(`*criar bolão* — criar um novo (com nome diferente)`);

  const lista = opcoes.map((o, i) => `${i + 1}. ${o}`).join('\n');

  await sendText({
    to: msg.waId,
    text:
      `🤔 Achei que você está se referindo ao bolão *${bolao.nome}*${statusLabel}${adminLabel}.\n\n` +
      `O que você quer fazer?\n\n${lista}\n\n` +
      `_Manda o nome do comando que quiser, ou *cancelar* pra ignorar._`,
  });
  return true;
}

// ============================================================
// Comandos IDLE auxiliares
// ============================================================
async function handleMeusBoloes(msg: IncomingMessage, usuarioId: string) {
  // HOTFIX 17/05: incluir FINALIZADOS — "meus bolões" eh consulta e a
  // promessa do bot ao encerrar foi "fica guardado". Senao a gente
  // contradiz a propria notificacao 17min depois.
  const todos = await bolaoService.listarBoloesDoUsuarioComHistorico(usuarioId);
  if (todos.length === 0) {
    await sendText({
      to: msg.waId,
      text: '📭 Você não participa de nenhum bolão ainda.\n\nPara entrar: *entrar em bolão*\nPara criar: *criar bolão*',
    });
    return;
  }

  const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
  const ativos = todos.filter((b) => b.status === 'ATIVO');
  const encerrados = todos.filter((b) => b.status === 'FINALIZADO');

  // ISSUE-019: mostrar ID sempre (admin e participante). Util pra
  // participante reenviar o link de convite, e pra admin nao precisar
  // procurar em outro lugar.
  const formatar = (b: typeof todos[number]) => {
    const ehAdmin = b.adminId === usuarioId;
    const adminLabel = ehAdmin ? ' 👑 _admin_' : '';
    const padraoLabel = b.id === padraoId ? ' ⭐ _padrão_' : '';
    return `• *${b.nome}* (${b.campeonatoNome})${adminLabel}${padraoLabel}\n   _ID:_ \`#${b.codigo}\``;
  };

  const partes: string[] = [];
  if (ativos.length > 0) {
    partes.push(`🏆 *Seus bolões ativos:*\n\n${ativos.map(formatar).join('\n')}`);
  }
  if (encerrados.length > 0) {
    partes.push(
      `🏁 *Bolões encerrados:*\n\n${encerrados.map(formatar).join('\n')}\n\n` +
      `_Manda *ranking* (ou o nome dele) pra ver o resultado final._`,
    );
  }

  // Dica de bolao padrao so faz sentido se tem >1 ATIVO e nao tem padrao
  if (ativos.length > 1 && !padraoId) {
    partes.push(
      '_Pra definir um bolão como padrão (e pular a pergunta "qual bolão?"), manda *bolão padrão*._',
    );
  }

  await sendText({ to: msg.waId, text: partes.join('\n\n') });
}

/**
 * Strip robusto de frases-gatilho pra ranking, pra evitar que o nome
 * extraido vire a frase inteira do usuario.
 *
 * Bug 17/05 (Jeni): "Quero ver o ranking" caia em RANKING (via LLM), mas
 * o replace antigo (so removia "ranking" no comeco) deixava "Quero ver
 * o ranking" inteiro como nomeBolao, e a busca falhava com
 * "bolao nao encontrado".
 *
 * Estrategia: enumera prefixos/sufixos de pergunta + palavras-trigger
 * (ranking/tabela/classificacao + verbos), tira tudo. O que sobra eh
 * o "ruido" do usuario — se for so artigo/preposicao, vira vazio
 * (fluxo: bot pergunta qual bolao).
 */
function extrairNomeBolaoDoRanking(raw: string): string {
  let resto = raw.trim().toLowerCase();
  // Normaliza acentos so pra match — preserva original em caso de retorno
  const normalizado = resto.normalize('NFD').replace(/[̀-ͯ]/g, '');
  resto = normalizado;

  // 1. Frases-gatilho de pergunta/pedido + trigger juntos
  const phrasesParaRemover = [
    /\b(?:eu )?(?:quero|gostaria de|queria|preciso|gostava de|posso)(?: ver| saber| consultar| conferir| dar uma olhada (?:em|no|na))?\b/g,
    /\b(?:me )?(?:mostra|mostrar|manda|passa|envia|exibe|exibir|abre|abrir)\b/g,
    /\b(?:qual|qual eh|qual o|qual a|como (?:ta|esta|anda)|como vai)\b/g,
    /\b(?:da uma )?olhada\b/g,
    /\bda hora\b/g,
    /\bagora\b/g,
    /\bpor favor\b/g,
    /\bpfv\b/g,
    // O trigger em si — RANKING_PATTERNS equivalente
    /\b(?:ranking|tabela|classificacao|placar geral|pontuacao geral)\b/g,
    /\bquem (?:ta|esta) (?:na frente|ganhando|liderando|em primeiro)\b/g,
    // Artigos/preposicoes soltos (limpa o cabecalho do nome)
    /^\s*(?:do|da|dos|das|de|o|a|os|as|para o|para a|pro|pra|no|na|nos|nas|em|em o|em a)\s+/g,
  ];
  for (const p of phrasesParaRemover) {
    resto = resto.replace(p, ' ');
  }

  // 2. Cleanup final: espacos, artigos isolados nos extremos
  resto = resto.replace(/\s+/g, ' ').trim();
  // remove artigos finais/iniciais soltos
  resto = resto.replace(/^(?:o|a|os|as|do|da|dos|das|de|no|na|em|para|pra)\s+/g, '');
  resto = resto.replace(/\s+(?:o|a|os|as|do|da|dos|das|de|no|na|em|para|pra)$/g, '');
  resto = resto.replace(/^[\s.,!?;:-]+|[\s.,!?;:-]+$/g, '').trim();

  // 3. Se sobrou so 1-2 chars ou ficou vazio, considera "sem nome"
  if (resto.length < 2) return '';
  return resto;
}

async function handleRanking(msg: IncomingMessage, usuarioId: string, raw: string) {
  // Extrai nome do bolao apos strip de frases gatilho (ver fix Jeni 17/05)
  const nomeBolao = extrairNomeBolaoDoRanking(raw);
  // HOTFIX 17/05: ranking eh consulta historica. Inclui FINALIZADOS pra
  // honrar a promessa "palpites e ranking ficam guardados" feita pelo bot
  // na hora do encerramento.
  const boloesDoUsuario = await bolaoService.listarBoloesDoUsuarioComHistorico(usuarioId);

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
      // Fallback global ainda restrito a ATIVOS — pra impedir bisbilhotar
      // ranking de bolao alheio finalizado so chutando o nome.
      const b = await bolaoService.buscarBolaoAtivoPorNome(nomeBolao);
      if (b) bolaoId = b.id;
    }
    if (!bolaoId) {
      await sendText({ to: msg.waId, text: `❌ Bolão "${nomeBolao}" não encontrado.` });
      return;
    }
  } else {
    if (boloesDoUsuario.length === 0) {
      await sendText({
        to: msg.waId,
        text:
          '📭 Você ainda não participa de nenhum bolão.\n\n' +
          'Para entrar: *entrar em bolão*\nPara criar: *criar bolão*',
      });
      return;
    }
    if (boloesDoUsuario.length > 1) {
      // ISSUE-016: se ha bolao padrao, usa direto
      const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
      const padraoMatch = boloesDoUsuario.find((b) => b.id === padraoId);
      if (padraoMatch) {
        bolaoId = padraoMatch.id;
      } else {
        // Setai estado pro proximo turno entender que o texto eh a escolha.
        // Marca os FINALIZADOS com 🏁 pra o usuario saber que ja terminaram.
        const temEncerrados = boloesDoUsuario.some((b) => b.status === 'FINALIZADO');
        const opcoes = boloesDoUsuario.map((b) => ({
          id: b.id,
          nome: b.status === 'FINALIZADO' ? `${b.nome} 🏁` : b.nome,
          codigo: b.codigo,
        }));
        await setSession(msg.waId, {
          state: 'ESCOLHENDO_BOLAO_RANKING',
          ctx: {
            boloesParaEscolher: opcoes.map((o) => ({ id: o.id, nome: o.nome })),
          },
        });
        const lista = formatarBoloesNumerados(opcoes);
        const legenda = temEncerrados
          ? '\n\n_🏁 = bolão encerrado (ranking final guardado)_'
          : '';
        await sendText({
          to: msg.waId,
          text:
            `Você está em vários bolões. De qual deles você quer ver o ranking?\n\n${lista}${legenda}\n\n${DICA_RESPOSTA_NUMERICA}\n\n` +
            `_Dica: manda *bolão padrão* pra pular essa pergunta sempre._`,
        });
        return;
      }
    } else {
      bolaoId = boloesDoUsuario[0].id;
    }
  }

  await enviarRankingDoBolao(msg.waId, bolaoId);
}

async function enviarRankingDoBolao(waId: string, bolaoId: string) {
  const dados = await rankingService.getRankingPorBolao(bolaoId);
  const texto = formatRanking(dados.bolao.nome, dados.rodadaAtual, dados.bolao.campeonatoNome, dados.ranking);
  // HOTFIX 17/05: deixa claro que e historico, nao status atual.
  const sufixo =
    dados.bolao.status === 'FINALIZADO'
      ? '\n\n🏁 _Este bolão foi encerrado — ranking final guardado pra consulta._'
      : '';
  await sendText({ to: waId, text: texto + sufixo });
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
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei qual bolão. Manda o número ou o nome de um destes:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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
    text: boasVindasComRegras(pendente.bolao.nome),
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

/**
 * Quando usuario esta num estado de "leitura/escolha" e manda uma intent
 * forte (PROXIMOS_JOGOS, RANKING, MEU_PALPITE, etc), abandona o estado
 * atual silenciosamente e processa a nova intent.
 *
 * Cobre o cenario "Quer ver palpites detalhados? (sim/não)" + usuario
 * manda "meus palpites no bolão da jeni" — antes o bot ficava preso
 * pedindo sim/não.
 *
 * Estados PROTEGIDOS (NAO interrompem):
 *   - CRIANDO_BOLAO_*, ENTRANDO_*: fluxos criticos de criacao
 *   - PALPITANDO: fluxo de palpite ja iniciado
 *   - CONFIRMANDO_APROVAR_X / CONFIRMANDO_RECUSAR_X: acoes admin destrutivas
 *   - CONFIRMANDO_PALPITES_INLINE: nova confirmacao de palpites (acao
 *     destrutiva — registra no banco)
 *   - ESCOLHENDO_BOLAO_PARA_PALPITAR: parte do fluxo de palpite acima
 *
 * Funciona puramente sincrono (so olha state + intencao). Nao toca DB.
 */
function escapouFsmStaleParaNovaIntent(session: Session, intencao: Intencao): boolean {
  // States onde a intent forte do user vence o estado anterior
  const ESTADOS_INTERROMPIVEIS = new Set<string>([
    'ESCOLHENDO_BOLAO_RANKING',
    'ESCOLHENDO_BOLAO_PALPITES',
    'CONFIRMANDO_VER_PALPITES',
    'ESCOLHENDO_BOLAO_CONVITE',
    'ESCOLHENDO_BOLAO_SAIR',
    'ESCOLHENDO_BOLAO_PARTICIPANTES',
    'CONFIRMANDO_SAIR_BOLAO',
    'ESCOLHENDO_INTENCAO_PALPITES',
    'ESCOLHENDO_BOLAO_PARA_ENTRAR',
    'ESCOLHENDO_BOLAO_EXCLUIR',
    // Sprint 2
    'ESCOLHENDO_BOLAO_PADRAO',
    'RENOMEANDO_BOLAO_ESCOLHA',
    'REMOVENDO_PARTICIPANTE_ESCOLHA_BOLAO',
    'EDITANDO_PALPITE_ESCOLHA_BOLAO',
    'APAGANDO_PALPITE_ESCOLHA_BOLAO',
    'APAGANDO_PALPITE_ESCOLHA_JOGO',
  ]);
  if (!ESTADOS_INTERROMPIVEIS.has(session.state)) return false;

  // Intents fortes — a UX considera elas como "comando explicito"
  const INTENTS_FORTES = new Set<Intencao>([
    Intencao.PROXIMOS_JOGOS,
    Intencao.JOGOS_HOJE,
    Intencao.MEU_PALPITE,
    Intencao.RANKING,
    Intencao.MEUS_PONTOS,
    Intencao.MEUS_BOLOES,
    Intencao.CRIAR_BOLAO,
    Intencao.ENTRAR_BOLAO,
    Intencao.COMO_CONVIDAR,
    Intencao.QUEM_PARTICIPA,
    Intencao.SAIR_BOLAO,
    Intencao.ABRIR_RODADA,
    Intencao.PENDENTES,
    Intencao.AJUDA,
    Intencao.MENU,
    Intencao.REGRAS,
    Intencao.INFO_SENHA,
    Intencao.EXCLUIR_BOLAO,
    // Sprint 2
    Intencao.INFO_PRODUTO,
    Intencao.INFO_PRECO,
    Intencao.COMO_PALPITAR,
    Intencao.QUANDO_COMECA,
    Intencao.EDITAR_PALPITE,
    Intencao.APAGAR_PALPITE,
    Intencao.DEFINIR_BOLAO_PADRAO,
    Intencao.RENOMEAR_BOLAO,
    Intencao.REMOVER_PARTICIPANTE,
    Intencao.RESUMO_BOLOES,
    Intencao.CANCELAR,
  ]);
  return INTENTS_FORTES.has(intencao);
}

async function tentarAcaoAdminEmIdle(
  msg: IncomingMessage,
  usuarioId: string,
  intencaoDetectada: Intencao,
): Promise<boolean> {
  // ORDEM IMPORTANTE: tudo sincrono primeiro, query DB so se realmente
  // precisar. Antes esta query rodava em TODA mensagem (inclusive "oi"),
  // adicionando ~50ms desnecessarios.

  // Step 1 (sync): intent explicita conhecida nao cede pra admin.
  // Se a mensagem ja foi reconhecida como intencao do bot, NAO
  // interceptar — admin pode querer ver ranking mesmo com pendentes.
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
    // Intents adicionadas depois — nenhuma se confunde com aprovacao:
    Intencao.MENU,
    Intencao.REGRAS,
    Intencao.PALPITES_AMBIGUO,
    Intencao.INFO_SENHA,
    Intencao.EXCLUIR_BOLAO,
    Intencao.COMO_CONVIDAR,
    Intencao.QUEM_PARTICIPA,
    Intencao.SAIR_BOLAO,
    Intencao.ABRIR_RODADA,
    Intencao.CANCELAR,
    // Sprint 2
    Intencao.INFO_PRODUTO,
    Intencao.INFO_PRECO,
    Intencao.COMO_PALPITAR,
    Intencao.QUANDO_COMECA,
    Intencao.EDITAR_PALPITE,
    Intencao.APAGAR_PALPITE,
    Intencao.DEFINIR_BOLAO_PADRAO,
    Intencao.RENOMEAR_BOLAO,
    Intencao.REMOVER_PARTICIPANTE,
    Intencao.RESUMO_BOLOES,
    Intencao.SAUDACAO, // "oi" jamais eh aprovacao. Se admin manda
                       // "tranquilo, libera" cai em TEXTO_LIVRE.
  ]);
  if (intencoesQueNaoCedem.has(intencaoDetectada)) return false;

  // Step 2 (sync): texto nao parece acao admin (aprovar/recusar/etc).
  // detectarAcaoAdmin eh pura regex, instantanea.
  const acao = detectarAcaoAdmin(msg.text);
  if (!acao) return false;

  // Step 3 (async, ~50ms): so agora valida que ha pendentes pra agir.
  const totalPendentes = await solicitacaoService.contarPendentesDoAdmin(usuarioId);
  if (totalPendentes === 0) return false;

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
        text: boasVindasComRegras(sol.bolao.nome),
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
const PROXIMOS_JOGOS_LOTE = 10;

/**
 * Handler do PROXIMOS_JOGOS — reseta paginação (offset = 0) e mostra o
 * 1º lote de 10 jogos abertos da rodada de cada bolão ativo. Usado
 * também quando user manda "jogos hoje".
 *
 * Pra paginar (lotes 11-20, 21-30, etc) o user manda "mais jogos" →
 * cai em `handleMaisJogos` que avança o offset salvo no Redis.
 */
async function handleProximosJogos(msg: IncomingMessage, usuarioId: string) {
  await mostrarProximosJogos(msg, usuarioId, { resetOffset: true });
}

/**
 * Handler do MAIS_JOGOS (v3.5.0) — avança a paginação em +10 por bolão.
 * Se for a 1ª vez (sem offset salvo), comporta-se como PROXIMOS_JOGOS.
 */
async function handleMaisJogos(msg: IncomingMessage, usuarioId: string) {
  void incContador('intent.MAIS_JOGOS');
  await mostrarProximosJogos(msg, usuarioId, { resetOffset: false, avancar: true });
}

/**
 * Núcleo compartilhado entre PROXIMOS_JOGOS e MAIS_JOGOS.
 *
 * Por bolão:
 *  - Busca TODOS os jogos abertos da rodada (sem `take`) — precisa do
 *    total pra mostrar contador honesto e detectar fim do scroll.
 *  - Aplica offset (persistido em Redis por bolão) + slice de 10.
 *  - Conta palpites do user no lote visível + na rodada inteira.
 *  - Persiste o offset usado.
 *
 * Decisões:
 *  - `resetOffset: true` (PROXIMOS_JOGOS) sempre começa do 0.
 *  - `avancar: true` (MAIS_JOGOS) soma +10 ao offset anterior. Se isso
 *    estourar o total da rodada, volta pro topo e avisa.
 */
async function mostrarProximosJogos(
  msg: IncomingMessage,
  usuarioId: string,
  opts: { resetOffset?: boolean; avancar?: boolean } = {},
) {
  const boloes = await bolaoService.listarBoloesAtivosDoUsuario(usuarioId);
  if (boloes.length === 0) {
    // HOTFIX 17/05: detecta caso "so tem encerrados" pra nao contradizer
    // a mensagem de encerramento ("seus palpites e ranking ficam guardados").
    const todos = await bolaoService.listarBoloesDoUsuarioComHistorico(usuarioId);
    if (todos.length > 0) {
      const encerrados = todos.filter((b) => b.status === 'FINALIZADO');
      await sendText({
        to: msg.waId,
        text:
          `📭 Você não tem bolões ativos no momento.\n\n` +
          (encerrados.length > 0
            ? `🏁 Você tem ${encerrados.length} bolão(ões) *encerrado(s)*. ` +
              `Manda *ranking* pra ver o resultado final ou *meus palpites* pra ver o histórico.\n\n`
            : '') +
          `Pra entrar em outro bolão: *entrar em bolão*\nPra criar um: *criar bolão*`,
      });
      return;
    }
    await sendText({
      to: msg.waId,
      text: '📭 Você não participa de nenhum bolão ainda.\n\nPara entrar: *entrar em bolão*',
    });
    return;
  }

  const agora = new Date();
  const partes: string[] = [];
  let algumLoteVoltouAoTopo = false;

  for (const b of boloes) {
    const rodada = await prisma.rodada.findFirst({
      where: { bolaoId: b.id, status: 'ABERTA' },
      include: {
        jogos: {
          where: { dataHora: { gte: agora }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
          orderBy: { dataHora: 'asc' },
        },
      },
    });

    if (!rodada || rodada.jogos.length === 0) continue;

    const palpite = await prisma.palpite.findUnique({
      where: { usuarioId_rodadaId: { usuarioId, rodadaId: rodada.id } },
      include: { jogos: true },
    });
    const palpitadosIds = new Set(palpite?.jogos.map((p) => p.jogoId) ?? []);

    const totalRodada = rodada.jogos.length;
    const palpitadosTotal = rodada.jogos.filter((j) => palpitadosIds.has(j.id)).length;

    // Resolver offset deste bolão
    let offset: number;
    if (opts.resetOffset) {
      offset = 0;
      await resetProximosJogosOffset(msg.waId, b.id);
    } else if (opts.avancar) {
      const atual = await getProximosJogosOffset(msg.waId, b.id);
      offset = atual + PROXIMOS_JOGOS_LOTE;
      if (offset >= totalRodada) {
        // Estourou: volta pro topo e sinaliza
        offset = 0;
        algumLoteVoltouAoTopo = true;
      }
    } else {
      offset = await getProximosJogosOffset(msg.waId, b.id);
      if (offset >= totalRodada) offset = 0;
    }

    const lote = rodada.jogos.slice(offset, offset + PROXIMOS_JOGOS_LOTE);
    if (lote.length === 0) continue;

    const palpitadosNoLote = lote.filter((j) => palpitadosIds.has(j.id)).length;
    const pendentesRodada = totalRodada - palpitadosTotal;
    const fimDoLote = offset + lote.length;

    const linhas = lote.map((j) => {
      // v3.11.0 — força Brasília (caso Jeni 11/06: VPS UTC mostrava 22:00 em vez de 19:00)
      const data = formatarDataHoraCurtaBR(j.dataHora);
      const marcado = palpitadosIds.has(j.id) ? '✅' : '⚪';
      return `${marcado} ${data} — ${j.timeCasa} x ${j.timeVisitante}`;
    });

    // Rodapé honesto: contador + indicação se há mais jogos
    const temMais = fimDoLote < totalRodada;
    const rodape: string[] = [];
    rodape.push(
      `📊 Mostrando jogos *${offset + 1}–${fimDoLote}* de *${totalRodada}* da rodada. ` +
        `Palpites seus neste lote: *${palpitadosNoLote}/${lote.length}*. ` +
        `Faltam *${pendentesRodada}* palpite(s) no bolão.`,
    );
    if (temMais) {
      rodape.push(`➡️ Manda *mais jogos* pra ver os próximos ${Math.min(PROXIMOS_JOGOS_LOTE, totalRodada - fimDoLote)}.`);
    } else if (pendentesRodada === 0) {
      rodape.push(`🎉 Você já palpitou em *todos* os ${totalRodada} jogos abertos. Bolão fechado pelo seu lado!`);
    } else {
      rodape.push(`🔁 Fim da lista. Manda *próximos jogos* pra voltar ao topo.`);
    }

    partes.push(`🏆 *${b.nome}*\n${linhas.join('\n')}\n\n${rodape.join('\n')}`);

    // Persiste o offset usado pra próxima chamada de "mais jogos"
    await setProximosJogosOffset(msg.waId, b.id, offset);
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

  const aviso = algumLoteVoltouAoTopo
    ? '\n\n_(Você já tinha visto até o fim — voltei pro topo da lista pra continuar)_'
    : '';

  await sendText({
    to: msg.waId,
    text:
      `📅 *Próximos jogos:*\n\n${partes.join('\n\n')}` +
      aviso +
      `\n\n_✅ = você já palpitou • ⚪ = falta palpitar_\n\n` +
      `💡 _Pode mandar *vários palpites de uma vez*, separados por vírgula ou em linhas diferentes._\n` +
      `_Ex: "Brasil 2x1 Marrocos, México 1x1 África do Sul" — registra ambos numa tacada._`,
  });

  // Abre janela de palpite livre — proximas msgs em IDLE serao
  // testadas via LLM extrator mesmo se nao casarem regex.
  await abrirJanelaPalpiteLivre(msg.waId);
}

/**
 * Cutucada inline (v3.5.0) — chamada após registrar palpite. Se o
 * usuário acabou de completar TODOS os jogos do último lote visto E
 * ainda há jogos pendentes na rodada, oferece o próximo lote.
 *
 * Idempotente via flag Redis (`pj_oferta:{waId}:{bolaoId}`) com TTL
 * curto — não cutuca duas vezes seguidas pelo mesmo evento.
 *
 * Não cutuca quando:
 *  - Offset = 0 e ninguém tinha visto lista ainda (palpite avulso fora do fluxo).
 *  - Já palpitou em tudo da rodada (manda parabens completo via outro caminho).
 *  - Falha em ler dados (silencioso — não trava o fluxo principal).
 */
async function talvezOferecerMaisJogos(
  msg: IncomingMessage,
  usuarioId: string,
  rodadaId: string,
): Promise<void> {
  try {
    const agora = new Date();
    const rodada = await prisma.rodada.findUnique({
      where: { id: rodadaId },
      include: {
        jogos: {
          where: { dataHora: { gte: agora }, status: { in: ['AGENDADO', 'AO_VIVO'] } },
          orderBy: { dataHora: 'asc' },
        },
      },
    });
    if (!rodada || rodada.jogos.length === 0) return;
    const bolaoId = rodada.bolaoId;

    // Só oferta se houve `próximos jogos` antes (offset salvo).
    const offsetSalvo = await getProximosJogosOffset(msg.waId, bolaoId);

    const palpite = await prisma.palpite.findUnique({
      where: { usuarioId_rodadaId: { usuarioId, rodadaId: rodada.id } },
      include: { jogos: true },
    });
    const palpitadosIds = new Set(palpite?.jogos.map((p) => p.jogoId) ?? []);

    const totalRodada = rodada.jogos.length;
    const palpitadosTotal = rodada.jogos.filter((j) => palpitadosIds.has(j.id)).length;
    const pendentes = totalRodada - palpitadosTotal;

    // Já palpitou em tudo? Sem mais oferta.
    if (pendentes === 0) return;

    // Lote em foco: do offset salvo até offset+10
    const lote = rodada.jogos.slice(offsetSalvo, offsetSalvo + PROXIMOS_JOGOS_LOTE);
    if (lote.length === 0) return;

    const palpitadosNoLote = lote.filter((j) => palpitadosIds.has(j.id)).length;
    // Só cutuca quando o lote inteiro está completo
    if (palpitadosNoLote < lote.length) return;

    // Idempotência: não cutuca de novo nas próximas 30 min pelo mesmo bolão
    const flagKey = `pj_oferta:${msg.waId}:${bolaoId}`;
    const flag = await redis.get(flagKey);
    if (flag) return;
    await redis.setex(flagKey, 30 * 60, '1');

    const proximoLote = Math.min(PROXIMOS_JOGOS_LOTE, pendentes);
    await sendText({
      to: msg.waId,
      text:
        `🔥 Fechou esses ${lote.length} 👏 Tá em dia com os palpites do lote!\n\n` +
        `📋 Ainda tem *${pendentes}* jogo(s) abertos no bolão pra você palpitar (libera até pouco antes do kickoff de cada um).\n\n` +
        `➡️ Manda *mais jogos* pra ver os próximos ${proximoLote}.`,
    });
  } catch (err) {
    // Não trava o fluxo principal se algo falhar aqui
    console.warn('[talvezOferecerMaisJogos] erro silencioso:', err);
  }
}

// ============================================================
// Fluxo: MEUS PALPITES / MEUS PONTOS
// ============================================================
async function handleMeusPalpites(msg: IncomingMessage, usuarioId: string) {
  // HOTFIX 17/05: palpites passados sao consulta historica — inclui
  // FINALIZADOS pro usuario poder ver o que palpitou em bolao encerrado.
  const boloes = await bolaoService.listarBoloesDoUsuarioComHistorico(usuarioId);
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

  // ISSUE-016: se ha bolao padrao, usa direto
  const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
  const padraoMatch = boloes.find((b) => b.id === padraoId);
  if (padraoMatch) {
    await mostrarPontuacaoEPerguntarPalpites(msg, usuarioId, padraoMatch.id, padraoMatch.nome);
    return;
  }

  // Mais de 1 bolao — pergunta qual. Marca encerrados com 🏁.
  const temEncerrados = boloes.some((b) => b.status === 'FINALIZADO');
  const opcoesMarcadas = boloes.map((b) => ({
    id: b.id,
    nome: b.status === 'FINALIZADO' ? `${b.nome} 🏁` : b.nome,
    codigo: b.codigo,
  }));
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PALPITES',
    ctx: {
      boloesParaEscolher: opcoesMarcadas.map((o) => ({ id: o.id, nome: o.nome })),
    },
  });
  const lista = formatarBoloesNumerados(opcoesMarcadas);
  const legenda = temEncerrados
    ? '\n\n_🏁 = bolão encerrado (palpites guardados no histórico)_'
    : '';
  await sendText({
    to: msg.waId,
    text: `Você está em vários bolões. De qual você quer ver os pontos?\n\n${lista}${legenda}\n\n${DICA_RESPOSTA_NUMERICA}\n\n_Dica: manda *bolão padrão* pra pular essa pergunta sempre._`,
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
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei qual bolão. Manda o número ou o nome de um destes:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
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

// ============================================================
// Sprint 2 — ISSUE-016: bolao padrao
// ============================================================
async function handleDefinirBolaoPadrao(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Você não participa de nenhum bolão ainda — não tem o que definir como padrão.',
    });
    return;
  }
  const atualPadraoId = await bolaoService.getBolaoPadrao(usuarioId);
  if (boloes.length === 1) {
    if (atualPadraoId === boloes[0].id) {
      await sendText({
        to: msg.waId,
        text: `⭐ Seu bolão padrão já é *${boloes[0].nome}* (único em que você participa).`,
      });
      return;
    }
    await bolaoService.definirBolaoPadrao(usuarioId, boloes[0].id);
    await sendText({
      to: msg.waId,
      text: `⭐ Bolão padrão definido: *${boloes[0].nome}*\n\nAgora comandos como *ranking*, *meus pontos* e *quando começa* usam ele direto.`,
    });
    return;
  }
  await setSession(msg.waId, {
    state: 'ESCOLHENDO_BOLAO_PADRAO',
    ctx: { boloesParaEscolher: boloes.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = formatarBoloesNumerados(boloes);
  const atualLinha = atualPadraoId
    ? `\n\n_Padrão atual: *${boloes.find((b) => b.id === atualPadraoId)?.nome ?? '(removido)'}*_`
    : '';
  await sendText({
    to: msg.waId,
    text: `⭐ Qual bolão você quer definir como *padrão*?\n\n${lista}${atualLinha}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleEscolhendoBolaoPadrao(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *bolão padrão* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número ou o nome:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  await resetSession(msg.waId);
  try {
    await bolaoService.definirBolaoPadrao(usuarioId, escolhido.id);
    await sendText({
      to: msg.waId,
      text: `⭐ Bolão padrão definido: *${escolhido.nome}*\n\nAgora comandos como *ranking*, *meus pontos*, *quando começa* usam ele direto.`,
    });
  } catch (err) {
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
}

// ============================================================
// Sprint 2 — ISSUE-020: renomear bolao (admin)
// ============================================================
async function handleRenomearBolao(msg: IncomingMessage, usuarioId: string) {
  const adminados = await bolaoService.listarBoloesQueAdministra(usuarioId);
  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Só o admin pode renomear. Você ainda não criou nenhum bolão.',
    });
    return;
  }
  if (adminados.length === 1) {
    await iniciarRenomeacaoBolao(msg, adminados[0]);
    return;
  }
  await setSession(msg.waId, {
    state: 'RENOMEANDO_BOLAO_ESCOLHA',
    ctx: { boloesParaEscolher: adminados.map((b) => ({ id: b.id, nome: b.nome })) },
  });
  const lista = formatarBoloesNumerados(adminados);
  await sendText({
    to: msg.waId,
    text: `✏️ Qual bolão você quer renomear?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleEscolhendoBolaoRenomear(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *renomear bolão* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número ou o nome:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  const bolao = await prisma.bolao.findUnique({
    where: { id: escolhido.id },
    select: { id: true, nome: true, adminId: true },
  });
  if (!bolao || bolao.adminId !== usuarioId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Você não é admin desse bolão.' });
    return;
  }
  await iniciarRenomeacaoBolao(msg, bolao);
}

async function iniciarRenomeacaoBolao(
  msg: IncomingMessage,
  bolao: { id: string; nome: string },
) {
  await setSession(msg.waId, {
    state: 'RENOMEANDO_BOLAO_NOME',
    ctx: { bolaoId: bolao.id, nomeBolao: bolao.nome },
  });
  await sendText({
    to: msg.waId,
    text:
      `✏️ Como você quer renomear o bolão *${bolao.nome}*?\n\n` +
      `_Manda o nome novo (3-60 caracteres). Ou *cancelar* pra desistir._`,
  });
}

async function handleRenomeandoBolaoNome(
  msg: IncomingMessage,
  _usuarioId: string,
  session: Session,
) {
  const nomeNovo = msg.text.trim();
  if (nomeNovo.length < 3 || nomeNovo.length > 60) {
    await sendText({
      to: msg.waId,
      text: '⚠️ Nome deve ter entre 3 e 60 caracteres. Tenta de novo (ou *cancelar*):',
    });
    return;
  }
  await updateSession(msg.waId, {
    state: 'CONFIRMANDO_RENOMEACAO_BOLAO',
    ctxPatch: { nomeNovoBolao: nomeNovo },
  });
  await sendText({
    to: msg.waId,
    text:
      `✏️ Confirma renomear *${session.ctx?.nomeBolao}* para *${nomeNovo}*?\n\n` +
      `_Responde *sim* pra confirmar ou *não* pra cancelar._`,
  });
}

async function handleConfirmandoRenomeacaoBolao(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const resp = await interpretarSimNao(msg.text);
  const bolaoId = session.ctx?.bolaoId;
  const nomeNovo = session.ctx?.nomeNovoBolao;
  if (!bolaoId || !nomeNovo) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *renomear bolão* de novo.' });
    return;
  }
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Beleza, mantive o nome atual.' });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({ to: msg.waId, text: '🤔 Manda *sim* pra confirmar ou *não* pra cancelar.' });
    return;
  }
  await resetSession(msg.waId);
  try {
    const { bolao, nomeAntigo, participantesPraNotificar } = await bolaoService.renomearBolao(
      bolaoId,
      usuarioId,
      nomeNovo,
    );
    await sendText({
      to: msg.waId,
      text: `✅ Bolão renomeado: *${nomeAntigo}* → *${bolao.nome}*. Avisei os ${participantesPraNotificar.length} participante(s).`,
    });
    await Promise.all(
      participantesPraNotificar.map((p) =>
        sendText({
          to: p.whatsappId,
          text: `📢 O admin renomeou o bolão *${nomeAntigo}* — agora ele se chama *${bolao.nome}*.`,
        }).catch(() => undefined),
      ),
    );
  } catch (err) {
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
}

// ============================================================
// Sprint 2 — ISSUE-021: remover participante (admin)
// ============================================================
async function handleRemoverParticipante(
  msg: IncomingMessage,
  usuarioId: string,
  raw: string,
) {
  const adminados = await bolaoService.listarBoloesQueAdministra(usuarioId);
  if (adminados.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Só o admin pode remover participantes. Você ainda não criou nenhum bolão.',
    });
    return;
  }

  // Tenta extrair nome do texto (ex: "remover Fulano do bolao")
  const nomeMatch = raw
    .toLowerCase()
    .replace(/^(?:remover|tirar|expulsar)\s+(?:o\s+|a\s+)?/i, '')
    .replace(/\s+(?:do|da|de)\s+bol[aã]?o.*$/i, '')
    .trim();
  const nomeProcurado = nomeMatch.length >= 2 && nomeMatch !== 'participante' ? nomeMatch : null;

  if (adminados.length === 1) {
    await processarRemocaoParticipante(msg, usuarioId, adminados[0].id, nomeProcurado);
    return;
  }

  await setSession(msg.waId, {
    state: 'REMOVENDO_PARTICIPANTE_ESCOLHA_BOLAO',
    ctx: {
      boloesParaEscolher: adminados.map((b) => ({ id: b.id, nome: b.nome })),
      participanteNomeParaRemover: nomeProcurado ?? undefined,
    },
  });
  const lista = formatarBoloesNumerados(adminados);
  const dica = nomeProcurado
    ? `\n\n_Quero remover *${nomeProcurado}* — de qual bolão?_`
    : '';
  await sendText({
    to: msg.waId,
    text: `🚫 De qual bolão você quer remover participante?${dica}\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleEscolhendoBolaoRemover(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou. Manda *remover participante* de novo.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número ou o nome:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  const nomeJaConhecido = session.ctx?.participanteNomeParaRemover ?? null;
  await processarRemocaoParticipante(msg, usuarioId, escolhido.id, nomeJaConhecido);
}

async function processarRemocaoParticipante(
  msg: IncomingMessage,
  usuarioId: string,
  bolaoId: string,
  nomeProcurado: string | null,
) {
  if (!nomeProcurado) {
    // Pede o nome
    const bolao = await prisma.bolao.findUnique({
      where: { id: bolaoId },
      select: { nome: true },
    });
    await setSession(msg.waId, {
      state: 'REMOVENDO_PARTICIPANTE_ESCOLHA_NOME',
      ctx: { bolaoId, nomeBolao: bolao?.nome ?? '' },
    });
    await sendText({
      to: msg.waId,
      text: `🚫 Quem você quer remover do bolão *${bolao?.nome}*?\n\n_Manda o nome (ou *cancelar*)._`,
    });
    return;
  }

  // Ja tem nome — busca direto
  try {
    const resultado = await bolaoService.removerParticipantePorNome(bolaoId, usuarioId, nomeProcurado);
    if (resultado.tipo === 'nao_encontrado') {
      const lista = resultado.candidatos
        .map((p) => `• ${p.usuario.nome}`)
        .join('\n');
      await resetSession(msg.waId);
      await sendText({
        to: msg.waId,
        text: `❌ Não achei *${nomeProcurado}* no bolão. Participantes desse bolão:\n\n${lista}\n\nManda *remover NOME* tentando outra grafia.`,
      });
      return;
    }
    await pedirConfirmacaoRemocaoParticipante(msg, resultado.participacao.id, resultado.participacao.usuario.nome, resultado.bolaoNome);
  } catch (err) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
}

async function handleRemovendoParticipanteNome(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const nome = msg.text.trim();
  const bolaoId = session.ctx?.bolaoId;
  if (!bolaoId || nome.length < 2) {
    await sendText({ to: msg.waId, text: '⚠️ Manda um nome válido (mínimo 2 chars):' });
    return;
  }
  await processarRemocaoParticipante(msg, usuarioId, bolaoId, nome);
}

async function pedirConfirmacaoRemocaoParticipante(
  msg: IncomingMessage,
  participacaoId: string,
  nomeUsuario: string,
  nomeBolao: string,
) {
  await setSession(msg.waId, {
    state: 'CONFIRMANDO_REMOCAO_PARTICIPANTE',
    ctx: {
      participacaoIdParaRemover: participacaoId,
      participanteNomeParaRemover: nomeUsuario,
      nomeBolao,
    },
  });
  await sendText({
    to: msg.waId,
    text:
      `⚠️ Vai remover *${nomeUsuario}* do bolão *${nomeBolao}*?\n\n` +
      `Os palpites passados dele(a) ficam no histórico, mas ele(a) some do ranking e não vai mais palpitar.\n\n` +
      `_Responde *sim* pra confirmar ou *não* pra cancelar._`,
  });
}

async function handleConfirmandoRemocaoParticipante(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const resp = await interpretarSimNao(msg.text);
  const participacaoId = session.ctx?.participacaoIdParaRemover;
  const nomeUsuario = session.ctx?.participanteNomeParaRemover ?? 'participante';
  const nomeBolao = session.ctx?.nomeBolao ?? 'bolão';
  if (!participacaoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: `👍 Beleza, mantive *${nomeUsuario}* no bolão.` });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({ to: msg.waId, text: '🤔 Manda *sim* ou *não*.' });
    return;
  }
  await resetSession(msg.waId);
  try {
    const { usuarioNome, usuarioWhatsappId, bolaoNome } = await bolaoService.executarRemocaoParticipante(
      participacaoId,
      usuarioId,
    );
    await sendText({
      to: msg.waId,
      text: `🚫 *${usuarioNome}* removido do bolão *${bolaoNome}*.`,
    });
    // Notifica o removido
    await sendText({
      to: usuarioWhatsappId,
      text: `😕 O admin te removeu do bolão *${bolaoNome}*. Seus palpites passados ficam guardados, mas você não vai receber mais notificações desse bolão.`,
    }).catch(() => undefined);
  } catch (err) {
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
  void nomeBolao;
}

// ============================================================
// Sprint 2 — ISSUE-011: editar palpite
// v3.7.0 — aceita placar inline ("corrigir Brasil 3x1"), LLM fallback,
// mostra palpite anterior na confirmação, valida jogo individual.
// ============================================================

/**
 * Tira o prefixo de comando ("corrigir palpite", "mudar", "errei o
 * palpite", etc) pra deixar SÓ o que sobrou — provavelmente o placar
 * novo. Ex: "corrigir Brasil 3x1 Marrocos" → "Brasil 3x1 Marrocos".
 * Se não sobrou nada relevante, retorna string vazia.
 */
function extrairPlacarInlineDoComando(raw: string): string {
  const prefixos = [
    /^(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer)\s+(?:meu\s+|o\s+|um\s+)?palpite\s*/i,
    /^(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer)\s+(?:o\s+)?placar\s*/i,
    /^errei\s+(?:o\s+|meu\s+)?palpite\s*/i,
    /^(?:quero|preciso|vou)\s+(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer)\s+(?:meu\s+|o\s+|um\s+)?palpite\s*/i,
    // Apenas o verbo + nome de time/placar: "corrigir Brasil 3x1"
    /^(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer)\s+/i,
  ];
  let resto = raw.trim();
  for (const re of prefixos) {
    const m = re.exec(resto);
    if (m) {
      resto = resto.slice(m[0].length).trim();
      break;
    }
  }
  // Remove conectores comuns ("pra", "para", "para:", ":", "→")
  resto = resto.replace(/^(?:pra|para|p\/|:|→|->)\s+/i, '').trim();
  return resto;
}

async function handleEditarPalpite(msg: IncomingMessage, usuarioId: string, raw: string) {
  const boloesAbertos = await listarBoloesComRodadaAberta(usuarioId);
  if (boloesAbertos.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Você não tem rodada aberta em nenhum bolão pra editar palpite.',
    });
    return;
  }

  // v3.7.0: extrai placar inline se o usuário mandou junto do comando
  // ("corrigir Brasil 3x1 Marrocos", "mudar palpite pra Brasil 2x1 Marrocos")
  const restoTexto = extrairPlacarInlineDoComando(raw);
  let placarInline: { timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number } | null = null;
  if (restoTexto.length > 0) {
    const parsed = parseIntencao(restoTexto);
    if (parsed.intencao === Intencao.PALPITE_INLINE && parsed.palpite) {
      placarInline = parsed.palpite;
    }
  }

  // Resolve qual bolão usar (padrão > único > escolha)
  const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
  const padraoMatch = boloesAbertos.find((b) => b.bolaoId === padraoId);
  const bolaoAlvo = padraoMatch ?? (boloesAbertos.length === 1 ? boloesAbertos[0] : null);

  // Atalho: placar inline + bolão resolvido → registra direto
  if (placarInline && bolaoAlvo) {
    await registrarEdicaoDireta(msg, usuarioId, bolaoAlvo.bolaoId, bolaoAlvo.nome, bolaoAlvo.rodadaId, placarInline);
    return;
  }

  // Vários bolões e placar inline: guardar o placar e pedir só pra escolher bolão
  if (placarInline && !bolaoAlvo) {
    await setSession(msg.waId, {
      state: 'EDITANDO_PALPITE_ESCOLHA_BOLAO',
      ctx: {
        boloesParaEscolher: boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome })),
        palpiteInline: placarInline,
      },
    });
    const lista = formatarBoloesNumerados(
      boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome, codigo: b.codigo })),
    );
    await sendText({
      to: msg.waId,
      text:
        `✏️ Em qual bolão você quer atualizar pra *${placarInline.timeCasa} ${placarInline.golsCasa} × ${placarInline.golsVisitante} ${placarInline.timeVisitante}*?\n\n` +
        `${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }

  // Sem placar inline: comportamento clássico (pede placar)
  if (bolaoAlvo) {
    await iniciarEdicaoPalpite(msg, bolaoAlvo.bolaoId, bolaoAlvo.nome, bolaoAlvo.rodadaId);
    return;
  }

  await setSession(msg.waId, {
    state: 'EDITANDO_PALPITE_ESCOLHA_BOLAO',
    ctx: {
      boloesParaEscolher: boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome })),
    },
  });
  const lista = formatarBoloesNumerados(
    boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome, codigo: b.codigo })),
  );
  await sendText({
    to: msg.waId,
    text: `✏️ De qual bolão é o palpite que você quer editar?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

/**
 * Registra/atualiza o palpite imediatamente quando o caller já tem
 * placar + bolão definidos. Encapsula o "fluxo curto" (atalho de edição
 * inline).
 */
async function registrarEdicaoDireta(
  msg: IncomingMessage,
  usuarioId: string,
  bolaoId: string,
  nomeBolao: string,
  rodadaId: string,
  p: { timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number },
) {
  void bolaoId;
  try {
    const r = await palpiteService.registrarPalpiteEmRodada({
      usuarioId,
      rodadaId,
      timeCasa: p.timeCasa,
      timeVisitante: p.timeVisitante,
      golsCasa: p.golsCasa,
      golsVisitante: p.golsVisitante,
    });
    await resetSession(msg.waId);
    const novoStr = `*${r.jogoTimeCasa} ${p.golsCasa} × ${p.golsVisitante} ${r.jogoTimeVisitante}*`;
    const texto = r.anterior
      ? `✅ Palpite atualizado no *${nomeBolao}*!\n` +
        `Era: *${r.jogoTimeCasa} ${r.anterior.golsCasa} × ${r.anterior.golsVisitante} ${r.jogoTimeVisitante}*\n` +
        `Agora: ${novoStr}`
      : `✅ Palpite registrado no *${nomeBolao}*: ${novoStr}\n_(não tinha palpite anterior pra esse jogo)_`;
    await sendText({ to: msg.waId, text: texto });
  } catch (err) {
    const m = (err as Error).message;
    const amigavel = m.includes('ja comecou') || m.includes('ja iniciou')
      ? `❌ Esse jogo já começou — palpite trava no kickoff.`
      : m.includes('jogo nao encontrado')
      ? `❌ Não achei o jogo *${p.timeCasa} x ${p.timeVisitante}* no bolão *${nomeBolao}*. Manda *próximos jogos* pra ver os times exatos.`
      : `❌ ${m}`;
    await sendText({ to: msg.waId, text: amigavel });
  }
}

async function iniciarEdicaoPalpite(
  msg: IncomingMessage,
  bolaoId: string,
  nomeBolao: string,
  rodadaId: string,
) {
  void bolaoId;
  await setSession(msg.waId, {
    state: 'EDITANDO_PALPITE_NOVO_PLACAR',
    ctx: { bolaoId, nomeBolao, rodadaId },
  });
  await sendText({
    to: msg.waId,
    text:
      `✏️ Manda o palpite *novo* — formato: \`Time1 NxN Time2\` (também aceito linguagem natural tipo "Brasil 2 a 1 Marrocos").\n\n` +
      `_Vou substituir o palpite anterior pelo novo no bolão *${nomeBolao}*. Ou *cancelar*._`,
  });
}

async function handleEscolhendoBolaoEditarPalpite(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({
      to: msg.waId,
      text: `🤔 Não identifiquei. Manda o número:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
    });
    return;
  }
  const rodada = await prisma.rodada.findFirst({
    where: { bolaoId: escolhido.id, status: 'ABERTA' },
    orderBy: { numero: 'desc' },
  });
  if (!rodada) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Esse bolão não tem rodada aberta.' });
    return;
  }
  // v3.7.0: se o user já tinha mandado placar inline ("corrigir Brasil 3x1"),
  // aplicamos direto após ele escolher o bolão.
  const palpiteInline = session.ctx?.palpiteInline;
  if (palpiteInline) {
    await registrarEdicaoDireta(msg, usuarioId, escolhido.id, escolhido.nome, rodada.id, palpiteInline);
    return;
  }
  await iniciarEdicaoPalpite(msg, escolhido.id, escolhido.nome, rodada.id);
}

async function handleEditandoPalpiteNovoPlacar(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const rodadaId = session.ctx?.rodadaId;
  const nomeBolao = session.ctx?.nomeBolao ?? '';
  if (!rodadaId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }

  // v3.7.0: 3 níveis de extração — regex inline → multi-palpite regex → LLM.
  // O LLM é fallback final pra "muda meu palpite pra 3 a 1 pro Brasil",
  // "errei o brasil, queria 2x1", etc.
  let palpite: { timeCasa: string; timeVisitante: string; golsCasa: number; golsVisitante: number } | null = null;

  const parsed = parseIntencao(msg.text);
  if (parsed.intencao === Intencao.PALPITE_INLINE && parsed.palpite) {
    palpite = parsed.palpite;
  }

  if (!palpite) {
    const multi = parseMultiplePalpites(msg.text);
    if (multi.length > 0) palpite = multi[0];
  }

  if (!palpite) {
    // LLM fallback — passa lista de jogos da rodada como contexto pra ele
    // mapear nomes parciais ("Brasil" → o jogo do Brasil na rodada).
    const rodada = await prisma.rodada.findUnique({
      where: { id: rodadaId },
      include: { jogos: true },
    });
    if (rodada && rodada.jogos.length > 0) {
      const extraidos = await extrairPalpites(
        msg.text,
        rodada.jogos.map((j) => ({ timeCasa: j.timeCasa, timeVisitante: j.timeVisitante })),
      );
      if (extraidos.length > 0) palpite = extraidos[0];
    }
  }

  if (!palpite) {
    await sendText({
      to: msg.waId,
      text:
        '🤔 Não entendi o palpite. Formato: `Brasil 2x1 Marrocos` (ou em linguagem natural, tipo "Brasil 2 a 1 Marrocos"). Ou *cancelar*.',
    });
    return;
  }

  try {
    const r = await palpiteService.registrarPalpiteEmRodada({
      usuarioId,
      rodadaId,
      timeCasa: palpite.timeCasa,
      timeVisitante: palpite.timeVisitante,
      golsCasa: palpite.golsCasa,
      golsVisitante: palpite.golsVisitante,
    });
    await resetSession(msg.waId);
    const novoStr = `*${r.jogoTimeCasa} ${palpite.golsCasa} × ${palpite.golsVisitante} ${r.jogoTimeVisitante}*`;
    const texto = r.anterior
      ? `✅ Palpite atualizado no *${nomeBolao}*!\n` +
        `Era: *${r.jogoTimeCasa} ${r.anterior.golsCasa} × ${r.anterior.golsVisitante} ${r.jogoTimeVisitante}*\n` +
        `Agora: ${novoStr}`
      : `✅ Palpite registrado no *${nomeBolao}*: ${novoStr}\n_(você ainda não tinha palpite pra esse jogo)_`;
    await sendText({ to: msg.waId, text: texto });
  } catch (err) {
    const m = (err as Error).message;
    const amigavel = m.includes('ja comecou') || m.includes('ja iniciou')
      ? `❌ Esse jogo já começou — palpite trava no kickoff.\n\nTenta outro jogo ou *cancelar*.`
      : m.includes('jogo nao encontrado')
      ? `❌ Não achei esse jogo no bolão. Manda *próximos jogos* pra ver os times exatos. Ou *cancelar*.`
      : `❌ ${m}\n\nTenta outro palpite ou *cancelar*.`;
    await sendText({ to: msg.waId, text: amigavel });
  }
}

// ============================================================
// Sprint 2 — ISSUE-012: apagar palpite
// ============================================================
async function handleApagarPalpite(msg: IncomingMessage, usuarioId: string, raw: string) {
  void raw;
  const boloesAbertos = await listarBoloesComRodadaAberta(usuarioId);
  if (boloesAbertos.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Você não tem rodada aberta em nenhum bolão pra apagar palpite.',
    });
    return;
  }
  const padraoId = await bolaoService.getBolaoPadrao(usuarioId);
  const padraoMatch = boloesAbertos.find((b) => b.bolaoId === padraoId);
  if (padraoMatch) {
    await listarPalpitesPraApagar(msg, usuarioId, padraoMatch.bolaoId, padraoMatch.nome, padraoMatch.rodadaId);
    return;
  }
  if (boloesAbertos.length === 1) {
    const b = boloesAbertos[0];
    await listarPalpitesPraApagar(msg, usuarioId, b.bolaoId, b.nome, b.rodadaId);
    return;
  }
  await setSession(msg.waId, {
    state: 'APAGANDO_PALPITE_ESCOLHA_BOLAO',
    ctx: {
      boloesParaEscolher: boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome })),
    },
  });
  const lista = formatarBoloesNumerados(
    boloesAbertos.map((b) => ({ id: b.bolaoId, nome: b.nome, codigo: b.codigo })),
  );
  await sendText({
    to: msg.waId,
    text: `🗑️ De qual bolão é o palpite que você quer apagar?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleEscolhendoBolaoApagarPalpite(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = formatarBoloesNumerados(opcoes);
    await sendText({ to: msg.waId, text: `🤔 Manda o número:\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}` });
    return;
  }
  const rodada = await prisma.rodada.findFirst({
    where: { bolaoId: escolhido.id, status: 'ABERTA' },
    orderBy: { numero: 'desc' },
  });
  if (!rodada) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '❌ Esse bolão não tem rodada aberta.' });
    return;
  }
  await listarPalpitesPraApagar(msg, usuarioId, escolhido.id, escolhido.nome, rodada.id);
}

async function listarPalpitesPraApagar(
  msg: IncomingMessage,
  usuarioId: string,
  bolaoId: string,
  nomeBolao: string,
  rodadaId: string,
) {
  const palpite = await prisma.palpite.findUnique({
    where: { usuarioId_rodadaId: { usuarioId, rodadaId } },
    include: { jogos: { include: { jogo: true } } },
  });
  if (!palpite || palpite.jogos.length === 0) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `🤷 Você não tem palpite registrado no *${nomeBolao}* pra apagar.`,
    });
    return;
  }
  // Filtra só palpites de jogos ainda nao iniciados
  const editaveis = palpite.jogos.filter((pj) => pj.jogo.status === 'AGENDADO');
  if (editaveis.length === 0) {
    await resetSession(msg.waId);
    await sendText({
      to: msg.waId,
      text: `🔒 Os jogos que você palpitou no *${nomeBolao}* já começaram — não dá mais pra apagar.`,
    });
    return;
  }

  const opcoes = editaveis.map((pj) => ({
    id: pj.id,
    nome: `${pj.jogo.timeCasa} ${pj.golsCasa} × ${pj.golsVisitante} ${pj.jogo.timeVisitante}`,
  }));
  await setSession(msg.waId, {
    state: 'APAGANDO_PALPITE_ESCOLHA_JOGO',
    ctx: { boloesParaEscolher: opcoes, bolaoId, nomeBolao, rodadaId },
  });
  const lista = opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n');
  await sendText({
    to: msg.waId,
    text: `🗑️ Qual palpite você quer apagar no *${nomeBolao}*?\n\n${lista}\n\n${DICA_RESPOSTA_NUMERICA}`,
  });
}

async function handleApagandoPalpiteEscolhaJogo(
  msg: IncomingMessage,
  _usuarioId: string,
  session: Session,
) {
  const opcoes = session.ctx?.boloesParaEscolher ?? [];
  if (opcoes.length === 0) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }
  // Aqui as "opcoes" são palpites (id = palpiteJogoId, nome = label)
  // Reusa parseEscolha por índice numérico via escolherBolaoDaLista
  const escolhido = await escolherBolaoDaLista(msg.text, opcoes);
  if (!escolhido) {
    const lista = opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n');
    await sendText({ to: msg.waId, text: `🤔 Manda o número:\n\n${lista}` });
    return;
  }
  await updateSession(msg.waId, {
    state: 'CONFIRMANDO_APAGAR_PALPITE',
    ctxPatch: { palpiteJogoIdParaApagar: escolhido.id, palpiteJogoLabelParaApagar: escolhido.nome },
  });
  await sendText({
    to: msg.waId,
    text: `⚠️ Apagar palpite *${escolhido.nome}* mesmo?\n\n_*sim* / *não*._`,
  });
}

async function handleConfirmandoApagarPalpite(
  msg: IncomingMessage,
  usuarioId: string,
  session: Session,
) {
  const resp = await interpretarSimNao(msg.text);
  const palpiteJogoId = session.ctx?.palpiteJogoIdParaApagar;
  const label = session.ctx?.palpiteJogoLabelParaApagar ?? 'palpite';
  if (!palpiteJogoId) {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: 'Sessão expirou.' });
    return;
  }
  if (resp === 'NAO') {
    await resetSession(msg.waId);
    await sendText({ to: msg.waId, text: '👍 Beleza, mantive o palpite.' });
    return;
  }
  if (resp !== 'SIM') {
    await sendText({ to: msg.waId, text: '🤔 Manda *sim* ou *não*.' });
    return;
  }
  await resetSession(msg.waId);
  try {
    await palpiteService.apagarPalpiteJogo(palpiteJogoId, usuarioId);
    await sendText({ to: msg.waId, text: `🗑️ Palpite *${label}* apagado.` });
  } catch (err) {
    await sendText({ to: msg.waId, text: `❌ ${(err as Error).message}` });
  }
}

// ============================================================
// Sprint 2 — ISSUE-023: resumo de pontuacao em todos os boloes
// ============================================================
async function handleResumoBoloes(msg: IncomingMessage, usuarioId: string) {
  const boloes = await bolaoService.listarBoloesDoUsuario(usuarioId);
  if (boloes.length === 0) {
    await sendText({
      to: msg.waId,
      text: '🤷 Você não participa de nenhum bolão ainda.\n\nManda *entrar em bolão* pra começar.',
    });
    return;
  }

  const linhas: string[] = [];
  let liderancas = 0;
  for (const b of boloes) {
    const ranking = await rankingService.getRankingPorBolao(b.id);
    const minhaPart = ranking.ranking.find((r) => r.usuarioId === usuarioId);
    if (!minhaPart) {
      linhas.push(`• *${b.nome}* — sem pontos ainda`);
      continue;
    }
    const totalPart = ranking.ranking.length;
    const pos = minhaPart.posicao;
    const pts = minhaPart.pontuacaoTotal;
    const medalha = pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : `${pos}º`;
    if (pos === 1) liderancas++;
    linhas.push(`• *${b.nome}* — ${medalha} de ${totalPart} (${pts} pt${pts === 1 ? '' : 's'})`);
  }

  const cabec = liderancas > 0
    ? `🏆 Você está em *primeiro* em *${liderancas}* bolão(ões)!\n\n`
    : '📊 Seu desempenho em cada bolão:\n\n';
  await sendText({
    to: msg.waId,
    text: cabec + linhas.join('\n'),
  });
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
    '• *bolão padrão* — define qual usar por padrão\n' +
    '• *sair do bolão* — sair de algum bolão\n' +
    '• *ajuda* — ver todos os comandos\n\n' +
    '_Fala comigo no zap mesmo. Aceito palpite em qualquer formato: "Brasil 2x1 Marrocos", "Brasil 2 a 1 Marrocos", "2 a zero pra Brasil". E entendo perguntas tipo "quais meus palpites?", "tem jogo hoje?", "quem ta na frente?"._'
  );
}
