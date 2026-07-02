import { prisma } from '../../config/database.js';

/**
 * Histórico de conversas (v3.60.0) — grava toda mensagem trocada entre
 * usuários e bot, nos dois canais, pra auditoria e debug.
 *
 * REGRA DE OURO: logging NUNCA pode atrapalhar conversa. Todas as
 * escritas são fire-and-forget (`void registrar…()`) e engolem erro com
 * console.warn — banco fora do ar não derruba resposta do bot.
 */

const TEXTO_MAX_CHARS = 2000;

export interface RegistrarMensagemInput {
  waId: string; // endereço cru (JID / dígitos / "tg:<chatId>")
  canal: 'whatsapp' | 'telegram';
  direcao: 'ENTRADA' | 'SAIDA';
  texto: string;
  messageId?: string | null;
}

function soDigitosDe(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Resolve o usuarioId pelo waId (variantes JID/dígitos). Roda FORA do
 * caminho crítico (dentro do fire-and-forget), então o SELECT extra não
 * adiciona latência à resposta do bot. Endereços "tg:" (onboarding,
 * pré-vínculo) não têm usuário — ficam com usuarioId null.
 */
async function resolverUsuarioId(waId: string): Promise<string | null> {
  if (waId.startsWith('tg:')) return null;
  const digits = soDigitosDe(waId);
  const candidatos = [waId, digits, `${digits}@s.whatsapp.net`].filter(
    (v, i, arr) => v.length > 0 && arr.indexOf(v) === i,
  );
  const usuario = await prisma.usuario.findFirst({
    where: { whatsappId: { in: candidatos } },
    select: { id: true },
  });
  return usuario?.id ?? null;
}

/**
 * Grava uma mensagem no histórico. Chamar SEMPRE com `void` (fire-and-
 * forget) — a função nunca lança.
 */
export async function registrarMensagemConversa(input: RegistrarMensagemInput): Promise<void> {
  try {
    const usuarioId = await resolverUsuarioId(input.waId);
    await prisma.mensagemConversa.create({
      data: {
        usuarioId,
        waId: input.waId,
        canal: input.canal,
        direcao: input.direcao,
        texto: input.texto.slice(0, TEXTO_MAX_CHARS),
        messageId: input.messageId || null,
      },
    });
  } catch (error) {
    console.warn('[conversa] falha ao registrar mensagem:', (error as Error).message);
  }
}

// ============================================================
// Consultas (comandos de dono)
// ============================================================

/**
 * Últimas `limite` mensagens de UM usuário (por usuarioId + variantes do
 * waId, cobrindo linhas antigas sem FK). Devolve em ordem CRONOLÓGICA
 * (asc) pra leitura natural.
 */
export async function buscarConversaDoUsuario(
  usuarioId: string,
  whatsappId: string,
  limite: number,
) {
  const digits = soDigitosDe(whatsappId);
  const variantes = [whatsappId, digits, `${digits}@s.whatsapp.net`].filter(
    (v, i, arr) => v.length > 0 && arr.indexOf(v) === i,
  );
  const rows = await prisma.mensagemConversa.findMany({
    where: { OR: [{ usuarioId }, { waId: { in: variantes } }] },
    orderBy: { criadoEm: 'desc' },
    take: limite,
  });
  return rows.reverse();
}

/**
 * Últimas `limite` mensagens GERAIS (todos os usuários), com o nome de
 * quem enviou/recebeu (join no Usuario). Ordem cronológica (asc).
 */
export async function buscarConversaGlobal(limite: number) {
  const rows = await prisma.mensagemConversa.findMany({
    orderBy: { criadoEm: 'desc' },
    take: limite,
    include: { usuario: { select: { nome: true } } },
  });
  return rows.reverse();
}

/** Auditoria de palpites de um usuário (mais recentes primeiro). */
export async function buscarAuditoriaDoUsuario(usuarioId: string, limite: number) {
  return prisma.palpiteAuditoria.findMany({
    where: { usuarioId },
    orderBy: { criadoEm: 'desc' },
    take: limite,
    include: { jogo: { select: { timeCasa: true, timeVisitante: true, dataHora: true } } },
  });
}

// ============================================================
// Trilha de auditoria de palpite
// ============================================================

export interface GravarAuditoriaInput {
  usuarioId: string;
  jogoId: string;
  bolaoId: string;
  acao: 'REGISTRADO' | 'EDITADO' | 'APAGADO' | 'CLASSIFICADO';
  placarAntes?: string | null;
  placarDepois?: string | null;
  classificado?: string | null;
  textoOriginal?: string | null;
  canal?: string | null;
}

/** Grava um evento de auditoria. Chamar com `void` — nunca lança. */
export async function gravarAuditoriaPalpite(input: GravarAuditoriaInput): Promise<void> {
  try {
    await prisma.palpiteAuditoria.create({
      data: {
        usuarioId: input.usuarioId,
        jogoId: input.jogoId,
        bolaoId: input.bolaoId,
        acao: input.acao,
        placarAntes: input.placarAntes ?? null,
        placarDepois: input.placarDepois ?? null,
        classificado: input.classificado ?? null,
        textoOriginal: input.textoOriginal?.slice(0, TEXTO_MAX_CHARS) ?? null,
        canal: input.canal ?? null,
      },
    });
  } catch (error) {
    console.warn('[conversa] falha ao gravar auditoria de palpite:', (error as Error).message);
  }
}
