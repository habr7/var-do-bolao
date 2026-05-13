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
  // Estados de palpite inline (quando usuario manda palpite em IDLE e
  // o jogo existe em multiplos bolaes — bot pergunta qual)
  | 'ESCOLHENDO_BOLAO_PALPITE_INLINE'
  // Como convidar — usuario tem varios bolaes admin, escolhe qual
  | 'ESCOLHENDO_BOLAO_CONVITE'
  // Sair do bolao — pede confirmacao
  | 'CONFIRMANDO_SAIR_BOLAO'
  // Escolher bolao quando ha varios pro fluxo "sair"
  | 'ESCOLHENDO_BOLAO_SAIR'
  // Escolher bolao quando ha varios pro fluxo "quem participa"
  | 'ESCOLHENDO_BOLAO_PARTICIPANTES';

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
