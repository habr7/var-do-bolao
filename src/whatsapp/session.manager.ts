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
  | 'CONFIRMANDO_VER_PALPITES';

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
