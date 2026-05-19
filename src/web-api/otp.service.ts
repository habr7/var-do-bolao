/**
 * Servico OTP — gera codigo de 6 digitos, persiste em OtpToken e
 * dispara via Evolution. Validacao incrementa tentativas; >= MAX
 * invalida o token sem expor "errei" (anti enumeration).
 *
 * Rate limit eh feito antes (rate-limit middleware), nao aqui.
 */
import { randomInt } from 'node:crypto';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { sendText } from '../whatsapp/evolution.client.js';

const OTP_LENGTH = 6;

function gerarCodigo(): string {
  // 6 digitos, sem leading zero perdido: 000000..999999
  const n = randomInt(0, 1_000_000);
  return String(n).padStart(OTP_LENGTH, '0');
}

/**
 * Cria OTP, invalida tokens anteriores ainda ativos do mesmo whatsappId
 * (so 1 codigo "vivo" por vez) e manda via WhatsApp.
 *
 * Retorna { whatsappId, expiraEm } pra UI mostrar "expira em N min".
 * Nao retorna o codigo — so o usuario que recebe sabe.
 */
export async function gerarEEnviarOtp(whatsappId: string): Promise<{
  whatsappId: string;
  expiraEm: Date;
}> {
  // Invalida tokens anteriores ainda nao usados nem expirados.
  // Mantemos historico (auditoria) marcando como "usado" agora.
  await prisma.otpToken.updateMany({
    where: {
      whatsappId,
      usadoEm: null,
      expiraEm: { gt: new Date() },
    },
    data: { usadoEm: new Date() },
  });

  const codigo = gerarCodigo();
  const expiraEm = new Date(Date.now() + env.OTP_VALIDITY_MINUTES * 60_000);

  await prisma.otpToken.create({
    data: { whatsappId, codigo, expiraEm },
  });

  const minutos = env.OTP_VALIDITY_MINUTES;
  const texto = [
    `🔐 *VAR do Bolão* — código de acesso`,
    ``,
    `Seu código: *${codigo}*`,
    ``,
    `Vale por ${minutos} minutos. Não compartilha com ninguém — nem com a gente.`,
  ].join('\n');

  // Importante: se o sendText falhar (Evolution offline), o token ja
  // foi criado. Em prod, vale alertar via log + tentar limpar. Por
  // ora deixamos pra o usuario clicar "reenviar".
  await sendText({ to: whatsappId, text: texto }).catch((err) => {
    console.error('[web-api] Falha ao enviar OTP:', err);
    // Nao re-lanca — devolve 200 fake mesmo (anti enumeration)
  });

  return { whatsappId, expiraEm };
}

export type VerifyResult =
  | { ok: true; whatsappId: string }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'MAX_ATTEMPTS' | 'NOT_FOUND' };

/**
 * Verifica o codigo. Em caso de invalido, conta tentativa.
 *
 * Importante: nao revela se o numero existe (anti enumeration).
 * UI sempre mostra mensagem generica "codigo invalido".
 */
export async function verificarOtp(
  whatsappId: string,
  codigo: string,
): Promise<VerifyResult> {
  const codigoLimpo = codigo.replace(/\D/g, '').slice(0, OTP_LENGTH);
  if (codigoLimpo.length !== OTP_LENGTH) {
    return { ok: false, reason: 'INVALID' };
  }

  // Token mais recente ainda nao usado pra este waId
  const token = await prisma.otpToken.findFirst({
    where: { whatsappId, usadoEm: null },
    orderBy: { criadoEm: 'desc' },
  });

  if (!token) return { ok: false, reason: 'NOT_FOUND' };

  if (token.tentativas >= env.OTP_MAX_ATTEMPTS) {
    // Invalida explicitamente
    await prisma.otpToken.update({
      where: { id: token.id },
      data: { usadoEm: new Date() },
    });
    return { ok: false, reason: 'MAX_ATTEMPTS' };
  }

  if (token.expiraEm < new Date()) {
    return { ok: false, reason: 'EXPIRED' };
  }

  if (token.codigo !== codigoLimpo) {
    await prisma.otpToken.update({
      where: { id: token.id },
      data: { tentativas: { increment: 1 } },
    });
    return { ok: false, reason: 'INVALID' };
  }

  // Sucesso — marca como usado
  await prisma.otpToken.update({
    where: { id: token.id },
    data: { usadoEm: new Date() },
  });

  return { ok: true, whatsappId };
}

/**
 * Normaliza qualquer formato de telefone BR pra 12-13 digitos
 * (com codigo do pais 55). Aceita: "+55 11 99999-9999", "11 99999 9999",
 * "5511999999999", etc.
 *
 * Retorna null se nao parecer um celular BR valido.
 */
export function normalizarTelefoneBR(input: string): string | null {
  const so = input.replace(/\D/g, '');
  // 11 digitos: DDD + 9 + 8 digitos (celular sem pais)
  if (so.length === 11) return `55${so}`;
  // 13 digitos: 55 + DDD + 9 + 8 digitos (com pais)
  if (so.length === 13 && so.startsWith('55')) return so;
  // 10 digitos: telefone fixo? aceitamos com 55 na frente, mas o bot vai
  // falhar em mandar — deixamos a rejeicao pro endpoint /otp/request.
  if (so.length === 10) return `55${so}`;
  if (so.length === 12 && so.startsWith('55')) return so;
  return null;
}
