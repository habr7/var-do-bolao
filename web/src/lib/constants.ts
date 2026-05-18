/**
 * Constantes globais do site.
 * Numero do bot vem de NEXT_PUBLIC_BOT_WHATSAPP_NUMBER pra trocar sem build novo
 * em ambientes diferentes (dev / staging / prod).
 */

export const SITE_NAME = "VAR do Bolão";
export const SITE_TAGLINE = "A resenha do grupo com a precisão dos dados.";
export const SITE_DESCRIPTION =
  "Bolão de Copa do Mundo 100% no WhatsApp. Sem app, sem planilha. Crie um bolão grátis em segundos e palpite por chat.";
export const SITE_URL = "https://www.vardobolao.com.br";
export const CONTACT_EMAIL = "contato@vardobolao.com.br";

const RAW_BOT_NUMBER =
  process.env.NEXT_PUBLIC_BOT_WHATSAPP_NUMBER ?? "5511978277516";
export const BOT_WHATSAPP_NUMBER = RAW_BOT_NUMBER.replace(/\D/g, "");

/**
 * Monta link wa.me com mensagem pre-preenchida.
 * encodeURIComponent garante que acentos/quebras de linha sobrevivam.
 */
export function waLink(message: string): string {
  return `https://wa.me/${BOT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

export const CTA_CRIAR_BOLAO = waLink("Olá! Quero criar um bolão.");
export const CTA_ENTRAR_BOLAO = waLink("Olá! Quero entrar em um bolão.");
export const CTA_PALPITAR = waLink("Quero palpitar.");
export const CTA_FALAR_BOT = waLink("Oi!");

/**
 * Data de abertura da Copa do Mundo FIFA 2026.
 * Jogo de abertura: 11/06/2026 (Estadio Azteca, Mexico).
 */
export const COPA_2026_START = new Date("2026-06-11T20:00:00-03:00");
