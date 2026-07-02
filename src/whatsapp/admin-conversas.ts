import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendText } from './evolution.client.js';
import { ehDono } from './broadcast.js';
import { formatarDataHoraCurtaBR } from '../utils/datetime.js';
import {
  buscarAuditoriaDoUsuario,
  buscarConversaDoUsuario,
  buscarConversaGlobal,
} from '../modules/conversa/conversa.service.js';
import { normalizarNumeroBR, variantesNumeroBR } from '../messaging/telegram.identity.js';

/**
 * v3.60.0 — Consultas de auditoria do dono (espelha o padrão do
 * broadcast/#CLASSIFICADO: interceptado no topo do pipeline, SÓ dono,
 * não-dono nem fica sabendo que o comando existe).
 *
 *   #CONVERSASGLOBAL [N]           → últimas N mensagens GERAIS (todos)
 *   #CONVERSAS <número|nome> [N]   → últimas N mensagens de UMA pessoa
 *   #AUDITORIA <número|nome> [N]   → trilha de palpites da pessoa
 *                                    (registrado/editado/apagado, com a
 *                                    mensagem original como prova)
 *
 * Defaults: N=20. Caps: 100 (conversas) / 50 (auditoria) — as respostas
 * longas são quebradas automaticamente pelo cliente Telegram.
 */

const DEFAULT_N = 20;
const CAP_CONVERSAS = 100;
const CAP_AUDITORIA = 50;
const PREVIEW_CHARS = 160; // trunca cada mensagem na listagem

// ============================================================
// Parse
// ============================================================
export interface ConsultaCmd {
  tipo: 'CONVERSAS_GLOBAL' | 'CONVERSAS_USUARIO' | 'AUDITORIA';
  alvo?: string; // número ou nome (CONVERSAS_USUARIO/AUDITORIA)
  limite: number;
}

/**
 * Detecta e parseia os comandos. Retorna null se a mensagem não começa com
 * um dos marcadores (não é consulta — segue fluxo normal).
 */
export function parseConsultaCmd(text: string): ConsultaCmd | null {
  const t = (text ?? '').trim();

  // #CONVERSASGLOBAL [N]  (checado ANTES de #CONVERSAS — é prefixo dele)
  let m = t.match(/^#conversasglobal(?:\s+(\d{1,3}))?$/i);
  if (m) {
    return {
      tipo: 'CONVERSAS_GLOBAL',
      limite: clampLimite(m[1], CAP_CONVERSAS),
    };
  }

  // #CONVERSAS <alvo…> [N]
  m = t.match(/^#conversas\s+(.+?)(?:\s+(\d{1,3}))?$/i);
  if (m) {
    return {
      tipo: 'CONVERSAS_USUARIO',
      alvo: m[1].trim(),
      limite: clampLimite(m[2], CAP_CONVERSAS),
    };
  }
  if (/^#conversas$/i.test(t)) {
    return { tipo: 'CONVERSAS_USUARIO', alvo: undefined, limite: DEFAULT_N };
  }

  // #AUDITORIA <alvo…> [N]
  m = t.match(/^#auditoria\s+(.+?)(?:\s+(\d{1,3}))?$/i);
  if (m) {
    return {
      tipo: 'AUDITORIA',
      alvo: m[1].trim(),
      limite: clampLimite(m[2], CAP_AUDITORIA),
    };
  }
  if (/^#auditoria$/i.test(t)) {
    return { tipo: 'AUDITORIA', alvo: undefined, limite: DEFAULT_N };
  }

  return null;
}

function clampLimite(raw: string | undefined, cap: number): number {
  const n = raw ? parseInt(raw, 10) : DEFAULT_N;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_N;
  return Math.min(n, cap);
}

// ============================================================
// Resolução do alvo (número OU nome)
// ============================================================
type AlvoResolvido =
  | { tipo: 'ok'; usuario: { id: string; nome: string; whatsappId: string } }
  | { tipo: 'varios'; nomes: string[] }
  | { tipo: 'nao_achado' };

export async function resolverAlvo(alvo: string): Promise<AlvoResolvido> {
  const digits = alvo.replace(/\D/g, '');

  // Parece número (≥8 dígitos) → casa por variantes (9º dígito, sufixo JID)
  if (digits.length >= 8) {
    const canonico = normalizarNumeroBR(alvo) ?? digits;
    const usuario = await prisma.usuario.findFirst({
      where: { whatsappId: { in: variantesNumeroBR(canonico) } },
      select: { id: true, nome: true, whatsappId: true },
    });
    return usuario ? { tipo: 'ok', usuario } : { tipo: 'nao_achado' };
  }

  // Nome (fuzzy: contains, case-insensitive)
  const usuarios = await prisma.usuario.findMany({
    where: { nome: { contains: alvo, mode: 'insensitive' } },
    select: { id: true, nome: true, whatsappId: true },
    take: 6,
  });
  if (usuarios.length === 0) return { tipo: 'nao_achado' };
  if (usuarios.length === 1) return { tipo: 'ok', usuario: usuarios[0] };

  // Match exato desempata ("Rafa" acha "Rafa" mesmo existindo "Rafael")
  const exato = usuarios.find((u) => u.nome.toLowerCase() === alvo.toLowerCase());
  if (exato) return { tipo: 'ok', usuario: exato };

  return { tipo: 'varios', nomes: usuarios.map((u) => u.nome) };
}

// ============================================================
// Formatação
// ============================================================
function preview(texto: string): string {
  const t = texto.replace(/\s+/g, ' ').trim();
  return t.length > PREVIEW_CHARS ? `${t.slice(0, PREVIEW_CHARS)}…` : t;
}

function mascararNumero(whatsappId: string): string {
  const d = whatsappId.replace(/\D/g, '');
  return d.length >= 8 ? `+${d.slice(0, 4)}…${d.slice(-4)}` : whatsappId;
}

interface LinhaConversa {
  criadoEm: Date;
  direcao: string;
  canal: string;
  texto: string;
}

function formatarLinha(m: LinhaConversa, prefixoNome?: string): string {
  const quem = m.direcao === 'ENTRADA' ? '👤' : '🤖';
  const nome = prefixoNome && m.direcao === 'ENTRADA' ? ` ${prefixoNome}` : '';
  return `[${formatarDataHoraCurtaBR(m.criadoEm)}] ${quem}${nome} ${preview(m.texto)}`;
}

// ============================================================
// Interceptador
// ============================================================
export async function tentarConsultaAdmin(msg: {
  waId: string;
  text: string;
}): Promise<boolean> {
  if (!ehDono(msg.waId, env.OWNER_WHATSAPP_IDS)) return false;
  const cmd = parseConsultaCmd(msg.text);
  if (!cmd) return false;

  try {
    await executarConsulta(msg.waId, cmd);
  } catch (error) {
    console.error('[admin-conversas] erro:', (error as Error).message);
    await sendText({ to: msg.waId, text: `❌ Consulta falhou: ${(error as Error).message}` });
  }
  return true;
}

async function executarConsulta(donoWaId: string, cmd: ConsultaCmd): Promise<void> {
  // ---- #CONVERSASGLOBAL ----
  if (cmd.tipo === 'CONVERSAS_GLOBAL') {
    const rows = await buscarConversaGlobal(cmd.limite);
    if (rows.length === 0) {
      await sendText({ to: donoWaId, text: '💬 Sem mensagens no histórico ainda.' });
      return;
    }
    const linhas = rows.map((m) =>
      formatarLinha(m, m.usuario?.nome ?? mascararNumero(m.waId)),
    );
    await sendText({
      to: donoWaId,
      text: `💬 *Últimas ${rows.length} mensagens (geral):*\n\n${linhas.join('\n')}`,
    });
    return;
  }

  // ---- comandos com alvo ----
  if (!cmd.alvo) {
    await sendText({
      to: donoWaId,
      text:
        `⚠️ Faltou dizer de quem. Uso:\n` +
        `\`#CONVERSAS <número|nome> [qtd]\`\n` +
        `\`#AUDITORIA <número|nome> [qtd]\`\n` +
        `\`#CONVERSASGLOBAL [qtd]\``,
    });
    return;
  }

  const resolvido = await resolverAlvo(cmd.alvo);
  if (resolvido.tipo === 'nao_achado') {
    await sendText({
      to: donoWaId,
      text: `🤷 Não achei ninguém com "${cmd.alvo}". Tenta o número (+55…) ou outro pedaço do nome.`,
    });
    return;
  }
  if (resolvido.tipo === 'varios') {
    await sendText({
      to: donoWaId,
      text:
        `🔎 Achei mais de um: ${resolvido.nomes.join(', ')}.\n` +
        `Refina o nome ou usa o número (+55…).`,
    });
    return;
  }

  const u = resolvido.usuario;

  if (cmd.tipo === 'CONVERSAS_USUARIO') {
    const rows = await buscarConversaDoUsuario(u.id, u.whatsappId, cmd.limite);
    if (rows.length === 0) {
      await sendText({ to: donoWaId, text: `💬 Sem mensagens de *${u.nome}* no histórico.` });
      return;
    }
    const linhas = rows.map((m) => formatarLinha(m));
    await sendText({
      to: donoWaId,
      text:
        `💬 *${u.nome}* (${mascararNumero(u.whatsappId)}) — últimas ${rows.length}:\n\n` +
        `${linhas.join('\n')}`,
    });
    return;
  }

  // ---- #AUDITORIA ----
  const eventos = await buscarAuditoriaDoUsuario(u.id, cmd.limite);
  if (eventos.length === 0) {
    await sendText({
      to: donoWaId,
      text: `📋 Sem eventos de palpite de *${u.nome}* na auditoria (trilha começou na v3.60.0).`,
    });
    return;
  }
  const linhas = eventos.map((e) => {
    const jogo = `${e.jogo.timeCasa} x ${e.jogo.timeVisitante}`;
    let acao: string;
    switch (e.acao) {
      case 'REGISTRADO':
        acao = `REGISTROU ${e.placarDepois}`;
        break;
      case 'EDITADO':
        acao = `EDITOU ${e.placarAntes} → ${e.placarDepois}`;
        break;
      case 'APAGADO':
        acao = `APAGOU (era ${e.placarAntes})`;
        break;
      case 'CLASSIFICADO':
        acao = `CRAVOU "${e.classificado}" passando`;
        break;
      default:
        acao = e.acao;
    }
    const via = e.canal ? ` _via ${e.canal}_` : '';
    const prova = e.textoOriginal ? `\n   ↳ msg: "${preview(e.textoOriginal)}"` : '';
    return `[${formatarDataHoraCurtaBR(e.criadoEm)}] *${jogo}*: ${acao}${via}${prova}`;
  });
  await sendText({
    to: donoWaId,
    text: `📋 *Auditoria de palpites — ${u.nome}* (últimos ${eventos.length}):\n\n${linhas.join('\n\n')}`,
  });
}
