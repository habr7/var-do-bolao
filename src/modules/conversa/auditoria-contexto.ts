/**
 * Contexto de auditoria por usuário (v3.60.0) — ponte em memória entre o
 * router (que conhece a mensagem CRUA e o canal) e o palpite.service (que
 * grava a auditoria mas só conhece usuarioId).
 *
 * O router seta o contexto no início de cada mensagem (logo após resolver
 * o usuário); qualquer registro/edição/apagamento de palpite disparado por
 * aquela mensagem lê daqui o texto original + canal.
 *
 * Por que em memória e não na sessão Redis: o dado só precisa viver
 * DENTRO do processamento da própria mensagem (handleIncomingMessage é
 * await do início ao fim), então um Map local basta — zero I/O extra.
 * Entradas expiram em 10min (prune no set) por segurança.
 */

interface ContextoMensagem {
  texto: string;
  canal: 'whatsapp' | 'telegram';
  em: number;
}

const TTL_MS = 10 * 60 * 1000;
const contextos = new Map<string, ContextoMensagem>();

export function setContextoAuditoria(
  usuarioId: string,
  texto: string,
  canal: 'whatsapp' | 'telegram',
): void {
  // prune ocasional: remove entradas velhas pra não crescer sem limite
  if (contextos.size > 500) {
    const agora = Date.now();
    for (const [k, v] of contextos) {
      if (agora - v.em > TTL_MS) contextos.delete(k);
    }
  }
  contextos.set(usuarioId, { texto, canal, em: Date.now() });
}

export function getContextoAuditoria(
  usuarioId: string,
): { texto: string; canal: 'whatsapp' | 'telegram' } | null {
  const ctx = contextos.get(usuarioId);
  if (!ctx) return null;
  if (Date.now() - ctx.em > TTL_MS) {
    contextos.delete(usuarioId);
    return null;
  }
  return { texto: ctx.texto, canal: ctx.canal };
}

/** Só pra testes. */
export function limparContextosAuditoria(): void {
  contextos.clear();
}
