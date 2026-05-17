import { redis } from '../config/redis.js';

/**
 * Estados possiveis da FSM de conversa, por usuario.
 *
 * Transicoes principais:
 *   IDLE → CRIANDO_BOLAO_NOME → CRIANDO_BOLAO_SENHA → IDLE
 *   IDLE → ENTRANDO_NOME → ENTRANDO_SENHA → IDLE
 *   IDLE → PALPITANDO → IDLE  (setado pelo job send-palpite-call)
 *   IDLE → ESCOLHENDO_BOLAO_RANKING → IDLE
 *   IDLE → ESCOLHENDO_BOLAO_PALPITES → CONFIRMANDO_VER_PALPITES → IDLE
 *
 * O estado CRIANDO_BOLAO_AGUARDANDO_PIX permanece declarado mas inerte
 * (PIX desativado). Reativar quando voltar a cobrar pagamento.
 */
export type ConversaState =
  | 'IDLE'
  | 'CRIANDO_BOLAO_NOME'
  | 'CRIANDO_BOLAO_SENHA'
  | 'CRIANDO_BOLAO_AGUARDANDO_PIX'
  | 'ENTRANDO_NOME'
  | 'ENTRANDO_SENHA'
  | 'PALPITANDO'
  | 'ESCOLHENDO_BOLAO_RANKING'
  | 'ESCOLHENDO_BOLAO_PALPITES'
  | 'CONFIRMANDO_VER_PALPITES'
  // Estados do fluxo admin (aprovacao em DM natural)
  | 'CONFIRMANDO_APROVAR_TODOS'
  | 'CONFIRMANDO_RECUSAR_TODOS'
  | 'CONFIRMANDO_RECUSAR_NOMEADO'
  // (estado antigo ESCOLHENDO_BOLAO_PALPITE_INLINE removido — substituido
  // pelo fluxo novo ESCOLHENDO_BOLAO_PARA_PALPITAR + CONFIRMANDO_PALPITES_INLINE)
  // Como convidar — usuario tem varios bolaes admin, escolhe qual
  | 'ESCOLHENDO_BOLAO_CONVITE'
  // Sair do bolao — pede confirmacao
  | 'CONFIRMANDO_SAIR_BOLAO'
  // Escolher bolao quando ha varios pro fluxo "sair"
  | 'ESCOLHENDO_BOLAO_SAIR'
  // Escolher bolao quando ha varios pro fluxo "quem participa"
  | 'ESCOLHENDO_BOLAO_PARTICIPANTES'
  // Novo fluxo de palpite em IDLE (substitui PALPITE_INLINE direto):
  //   IDLE -> ESCOLHENDO_BOLAO_PARA_PALPITAR -> CONFIRMANDO_PALPITES_INLINE -> IDLE
  // O texto cru do palpite eh guardado em ctx.palpiteTextoCru.
  | 'ESCOLHENDO_BOLAO_PARA_PALPITAR'
  | 'CONFIRMANDO_PALPITES_INLINE'
  // Usuario digitou so "palpites" — bot pergunta entre opcoes numeradas
  | 'ESCOLHENDO_INTENCAO_PALPITES'
  // Busca por nome retornou multiplos boloes — usuario escolhe qual
  | 'ESCOLHENDO_BOLAO_PARA_ENTRAR'
  // Admin querendo excluir bolao: escolhe qual (>1) e confirma
  | 'ESCOLHENDO_BOLAO_EXCLUIR'
  | 'CONFIRMANDO_EXCLUSAO_BOLAO'
  // Sprint 2 — bolao padrao (ISSUE-016): usuario escolhe qual setar como padrao
  | 'ESCOLHENDO_BOLAO_PADRAO'
  // Sprint 2 — renomear bolao (ISSUE-020)
  | 'RENOMEANDO_BOLAO_ESCOLHA'         // admin tem >1 bolao, escolhe qual renomear
  | 'RENOMEANDO_BOLAO_NOME'            // admin manda o nome novo
  | 'CONFIRMANDO_RENOMEACAO_BOLAO'     // confirma com sim/nao
  // Sprint 2 — remover participante (ISSUE-021)
  | 'REMOVENDO_PARTICIPANTE_ESCOLHA_BOLAO'    // admin tem >1 bolao
  | 'REMOVENDO_PARTICIPANTE_ESCOLHA_NOME'     // pede o nome do participante
  | 'CONFIRMANDO_REMOCAO_PARTICIPANTE'        // confirma com sim/nao
  // Sprint 2 — palpite com placar absurdo (ISSUE-013) precisa confirmacao
  | 'CONFIRMANDO_PALPITE_PLACAR_ABSURDO'
  // Sprint 2 — editar palpite (ISSUE-011)
  | 'EDITANDO_PALPITE_ESCOLHA_BOLAO'   // user em >1 bolao, escolhe qual
  | 'EDITANDO_PALPITE_NOVO_PLACAR'     // pede placar novo
  // Sprint 2 — apagar palpite (ISSUE-012)
  | 'APAGANDO_PALPITE_ESCOLHA_BOLAO'   // user em >1 bolao, escolhe qual
  | 'APAGANDO_PALPITE_ESCOLHA_JOGO'    // mostra palpites e pede qual apagar
  | 'CONFIRMANDO_APAGAR_PALPITE';

export interface BolaoParaEscolher {
  id: string;
  nome: string;
}

export interface ConversaContext {
  nomeBolao?: string;
  senhaBolaoHash?: string;
  pagamentoId?: string;
  bolaoId?: string;
  rodadaId?: string;
  jogosPendentes?: string[]; // jogoIds
  // Lista de bolaoes possiveis quando o usuario precisa escolher
  // (estados ESCOLHENDO_BOLAO_*).
  boloesParaEscolher?: BolaoParaEscolher[];
  // Fluxo admin de aprovacao em DM natural
  solicitacaoIdParaConfirmar?: string;
  nomeSolicitanteParaConfirmar?: string;
  nomeBolaoSolicitacao?: string;
  // Palpite inline ambiguo: usuario mandou palpite, jogo existe em
  // multiplos bolaes — bot pergunta qual bolao registrar
  palpiteInlinePendente?: {
    timeCasa: string;
    timeVisitante: string;
    golsCasa: number;
    golsVisitante: number;
  };
  // Novo fluxo de palpite em IDLE (>1 bolao com rodada aberta):
  //   1. Bot guarda o texto cru do palpite
  //   2. Pergunta qual bolao (numerado)
  //   3. Extrai palpites (regex + LLM) com base na rodada do bolao escolhido
  //   4. Mostra preview pra confirmacao
  palpiteTextoCru?: string;
  palpiteRodadaIdEscolhida?: string;
  palpiteBolaoNomeEscolhido?: string;
  // Lista de palpites prontos pra registrar (apos extracao + LLM)
  palpitesParaConfirmar?: Array<{
    timeCasa: string;
    timeVisitante: string;
    golsCasa: number;
    golsVisitante: number;
    jogoId: string;
  }>;
  palpitesNaoEntendidos?: string[];
  // Contador de tentativas (usado em ENTRANDO_NOME pra dar 3 chances
  // antes de resetar e voltar ao menu). ISSUE-002.
  tentativas?: number;
  // Sprint 2 — renomear bolao (ISSUE-020)
  nomeNovoBolao?: string;
  // Sprint 2 — remover participante (ISSUE-021)
  participacaoIdParaRemover?: string;
  participanteNomeParaRemover?: string;
  // Sprint 2 — apagar palpite (ISSUE-012)
  palpiteJogoIdParaApagar?: string;
  palpiteJogoLabelParaApagar?: string;
  // Sprint 2 — placar absurdo (ISSUE-013) — guarda contexto pra retomar fluxo
  palpiteAbsurdoContexto?: {
    timeCasa: string;
    timeVisitante: string;
    golsCasa: number;
    golsVisitante: number;
  };
}

export interface Session {
  state: ConversaState;
  ctx?: ConversaContext;
}

const SESSION_PREFIX = 'session:';
const SESSION_TTL_SECONDS = 60 * 30; // 30 min

function key(waId: string): string {
  return `${SESSION_PREFIX}${waId}`;
}

export async function getSession(waId: string): Promise<Session> {
  const data = await redis.get(key(waId));
  if (!data) return { state: 'IDLE' };
  try {
    return JSON.parse(data) as Session;
  } catch {
    return { state: 'IDLE' };
  }
}

export async function setSession(waId: string, session: Session, ttlSeconds = SESSION_TTL_SECONDS): Promise<void> {
  await redis.setex(key(waId), ttlSeconds, JSON.stringify(session));
}

export async function updateSession(
  waId: string,
  patch: Partial<Session> & { ctxPatch?: Partial<ConversaContext> },
): Promise<Session> {
  const current = await getSession(waId);
  const next: Session = {
    state: patch.state ?? current.state,
    ctx: {
      ...(current.ctx ?? {}),
      ...(patch.ctx ?? {}),
      ...(patch.ctxPatch ?? {}),
    },
  };
  await setSession(waId, next);
  return next;
}

export async function resetSession(waId: string): Promise<void> {
  await redis.del(key(waId));
}

/**
 * "Janela de palpite livre" — quando o bot mostra a lista de jogos
 * (handler PROXIMOS_JOGOS), marca em Redis com TTL curto que esse
 * usuario provavelmente vai mandar palpites nos proximos minutos.
 *
 * No proximo turno em IDLE, o router checa essa flag pra rodar o LLM
 * extrator de palpite (`extrairPalpites`) mesmo que o regex nao tenha
 * casado — cobre coisas como "2 a zero pra Africa" ou "1 a 1 Coreia".
 *
 * TTL curto (5min) pra nao confundir mensagens que cheguem horas depois.
 */
const PALPITE_WINDOW_PREFIX = 'palpite_window:';
const PALPITE_WINDOW_TTL_SECONDS = 5 * 60;

export async function abrirJanelaPalpiteLivre(waId: string): Promise<void> {
  await redis.setex(`${PALPITE_WINDOW_PREFIX}${waId}`, PALPITE_WINDOW_TTL_SECONDS, '1');
}

export async function janelaPalpiteLivreAtiva(waId: string): Promise<boolean> {
  const v = await redis.get(`${PALPITE_WINDOW_PREFIX}${waId}`);
  return v === '1';
}

export async function fecharJanelaPalpiteLivre(waId: string): Promise<void> {
  await redis.del(`${PALPITE_WINDOW_PREFIX}${waId}`);
}
