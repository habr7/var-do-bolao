import { redis } from '../config/redis.js';
import { handleIncomingMessage } from '../whatsapp/command.router.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { enderecoTelegram } from './channel-router.js';
import { tgSendTyping, type TelegramMessage, type TelegramUpdate } from './telegram.client.js';
import {
  buscarUsuarioPorNumero,
  buscarUsuarioPorTelegramId,
  clearOnboarding,
  criarUsuarioViaTelegram,
  getOnboarding,
  normalizarNumeroBR,
  setOnboarding,
  vincularTelegram,
} from './telegram.identity.js';

/**
 * Inbound do Telegram — equivalente ao webhook.handler do WhatsApp.
 * Usado pelos DOIS transportes (polling e webhook): ambos entregam
 * TelegramUpdate aqui e este módulo decide o que fazer:
 *
 *   1. Filtros: só chat privado, só gente (não bots), dedup por update_id.
 *   2. Mídia sem texto → resposta amigável (paridade com WhatsApp v3.15.0).
 *   3. Pessoa SEM vínculo → onboarding (pede o WhatsApp, liga o cadastro).
 *   4. Pessoa COM vínculo → handleIncomingMessage com waId = whatsappId
 *      do cadastro — o command.router processa como se fosse WhatsApp e a
 *      resposta volta pro Telegram via channel-router (canalPreferido).
 */

// ============================================================
// Dedup por update_id (webhook pode re-entregar; polling é idempotente)
// ============================================================
const DEDUP_PREFIX = 'tg_update:';
const DEDUP_TTL_SECONDS = 6 * 3600;

async function jaProcessado(updateId: number): Promise<boolean> {
  const claimed = await redis.set(`${DEDUP_PREFIX}${updateId}`, '1', 'EX', DEDUP_TTL_SECONDS, 'NX');
  return claimed !== 'OK';
}

// ============================================================
// Entrada única
// ============================================================
export async function processarUpdateTelegram(update: TelegramUpdate): Promise<void> {
  try {
    const msg = update.message;
    if (!msg) return; // edited_message etc — ignora
    if (msg.chat.type !== 'private') return; // DM-only (mesma regra do WhatsApp)
    if (msg.from?.is_bot) return;
    if (await jaProcessado(update.update_id)) return;

    const chatId = String(msg.chat.id);
    const enderecoTg = enderecoTelegram(chatId);
    const nome = nomeDoTelegram(msg);

    const texto = (msg.text ?? '').trim();
    if (!texto) {
      // Mídia (foto/áudio/sticker/vídeo/doc) → aviso amigável com rate-limit
      // 1x/h (paridade com o WhatsApp, v3.15.0). Outros eventos: silêncio.
      if (detectouMidiaTelegram(msg)) {
        await responderMidiaNaoSuportadaTg(chatId);
      }
      return;
    }

    // Quem é essa pessoa?
    const usuario = await buscarUsuarioPorTelegramId(chatId);

    if (!usuario) {
      // Sem vínculo → onboarding (pede número / confirma / cria novo)
      await conduzirOnboarding(chatId, enderecoTg, nome, msg, texto);
      return;
    }

    // Vinculado. /start de novo = re-boas-vindas (mapeia pra "oi").
    const textoNormalizado = texto === '/start' ? 'oi' : texto;

    // UX: indicador "digitando…" enquanto o router processa (best-effort)
    void tgSendTyping(chatId);

    await handleIncomingMessage({
      waId: usuario.whatsappId,
      messageId: String(msg.message_id),
      senderName: usuario.nome || nome,
      text: textoNormalizado,
    });
  } catch (error) {
    console.error('[telegram-inbound] erro processando update:', (error as Error).message);
  }
}

// ============================================================
// Onboarding — conversa de vínculo (FSM própria, ver telegram.identity)
// ============================================================
async function conduzirOnboarding(
  chatId: string,
  enderecoTg: string,
  nome: string,
  msg: TelegramMessage,
  texto: string,
): Promise<void> {
  const sessao = await getOnboarding(chatId);

  // 1º contato (ou sessão expirada) → boas-vindas + pede o número
  if (!sessao || texto === '/start') {
    await setOnboarding(chatId, { state: 'AGUARDANDO_NUMERO' });
    await sendText({
      to: enderecoTg,
      text:
        `⚽ *Fala, ${nome}!* Eu sou o *VAR do Bolão* — o árbitro digital do bolão da Copa 2026.\n\n` +
        `O bolão agora funciona aqui no Telegram. Pra eu *recuperar seus pontos e palpites*, ` +
        `me manda o *número de WhatsApp* que você usava com o bot.\n\n` +
        `Pode mandar como preferir, ex: \`11 91234-5678\``,
    });
    return;
  }

  switch (sessao.state) {
    case 'AGUARDANDO_NUMERO': {
      const numero = normalizarNumeroBR(texto);
      if (!numero) {
        const tentativas = (sessao.tentativas ?? 0) + 1;
        await setOnboarding(chatId, { ...sessao, tentativas });
        await sendText({
          to: enderecoTg,
          text:
            `🤔 Não consegui entender esse número. Me manda só o *DDD + número*, ex: \`11 91234-5678\`` +
            (tentativas >= 3 ? `\n\n_(se você nunca usou o bot no WhatsApp, manda o seu número mesmo assim — eu crio seu cadastro novo)_` : ''),
        });
        return;
      }

      const candidato = await buscarUsuarioPorNumero(numero);
      if (candidato) {
        if (candidato.telegramId && candidato.telegramId !== chatId) {
          // Número já vinculado a OUTRA conta de Telegram — não rouba o vínculo.
          await sendText({
            to: enderecoTg,
            text:
              `⚠️ Esse número já está vinculado a outra conta de Telegram.\n\n` +
              `Se foi você em outro aparelho, me chama por lá. Se acha que é um erro, fala com o organizador do bolão.`,
          });
          return;
        }
        await setOnboarding(chatId, {
          state: 'CONFIRMANDO_VINCULO',
          usuarioIdCandidato: candidato.id,
          nomeCandidato: candidato.nome,
          numeroCanonico: numero,
        });
        await sendText({
          to: enderecoTg,
          text: `🔎 Achei seu cadastro: *${candidato.nome}*.\n\nÉ você? (responde *sim* ou *não*)`,
        });
        return;
      }

      // Não achou — oferece começar do zero
      await setOnboarding(chatId, { state: 'CONFIRMANDO_CRIAR_NOVO', numeroCanonico: numero });
      await sendText({
        to: enderecoTg,
        text:
          `🤷 Não achei nenhum cadastro com esse número.\n\n` +
          `Quer *começar do zero* com um cadastro novo? (responde *sim* pra criar, ou manda outro número)`,
      });
      return;
    }

    case 'CONFIRMANDO_VINCULO': {
      if (ehSim(texto)) {
        const usuario = await vincularTelegram(
          sessao.usuarioIdCandidato as string,
          chatId,
          msg.from?.username,
        );
        await clearOnboarding(chatId);
        await sendText({
          to: enderecoTg,
          text:
            `✅ *Pronto, ${usuario.nome}!* Sua conta foi vinculada — seus bolões, palpites e pontos estão todos aqui.\n\n` +
            `Daqui pra frente é só falar comigo por aqui, igual era no WhatsApp. Alguns atalhos:\n` +
            `• *próximos jogos* — ver jogos e palpitar\n` +
            `• *ranking* — ver a classificação\n` +
            `• *meus palpites* — conferir o que você cravou\n` +
            `• *ajuda* — ver tudo que eu faço`,
        });
        return;
      }
      if (ehNao(texto)) {
        await setOnboarding(chatId, { state: 'AGUARDANDO_NUMERO' });
        await sendText({
          to: enderecoTg,
          text: `Sem problema! Me manda o número certo então (DDD + número).`,
        });
        return;
      }
      await sendText({
        to: enderecoTg,
        text: `Responde *sim* pra confirmar que *${sessao.nomeCandidato}* é você, ou *não* pra tentar outro número.`,
      });
      return;
    }

    case 'CONFIRMANDO_CRIAR_NOVO': {
      if (ehSim(texto)) {
        const usuario = await criarUsuarioViaTelegram(
          sessao.numeroCanonico as string,
          nome,
          chatId,
          msg.from?.username,
        );
        await clearOnboarding(chatId);
        await sendText({
          to: enderecoTg,
          text:
            `✅ *Cadastro criado, ${usuario.nome}!* Bem-vindo ao VAR do Bolão. 🎉\n\n` +
            `Pra entrar num bolão existente, manda *entrar em bolão*. Pra ver tudo que eu faço, manda *ajuda*.`,
        });
        return;
      }
      // Qualquer outra coisa: tenta interpretar como um novo número
      const numero = normalizarNumeroBR(texto);
      if (numero) {
        await setOnboarding(chatId, { state: 'AGUARDANDO_NUMERO' });
        await conduzirOnboarding(chatId, enderecoTg, nome, msg, texto);
        return;
      }
      await sendText({
        to: enderecoTg,
        text: `Responde *sim* pra criar um cadastro novo, ou me manda outro número de WhatsApp.`,
      });
      return;
    }
  }
}

// ============================================================
// Helpers
// ============================================================
function nomeDoTelegram(msg: TelegramMessage): string {
  const partes = [msg.from?.first_name, msg.from?.last_name].filter(Boolean);
  return partes.join(' ').trim() || msg.from?.username || 'Craque';
}

function ehSim(texto: string): boolean {
  return /^(sim|s|ss|isso|claro|confirmo|yes|é|eh|sou eu|souzim|👍)\b/i.test(texto.trim());
}

function ehNao(texto: string): boolean {
  return /^(n[ãa]o|n|nao é|não é|errado|negativo)\b/i.test(texto.trim());
}

function detectouMidiaTelegram(msg: TelegramMessage): boolean {
  return Boolean(msg.photo || msg.audio || msg.voice || msg.video || msg.sticker || msg.document);
}

/** Aviso de mídia não suportada com rate-limit 1x/h (paridade WhatsApp). */
async function responderMidiaNaoSuportadaTg(chatId: string): Promise<void> {
  try {
    const flag = `midia_aviso:tg:${chatId}`;
    if (await redis.get(flag)) return;
    await redis.set(flag, '1', 'EX', 3600);
    await sendText({
      to: enderecoTelegram(chatId),
      text:
        '😅 Áudio, foto e figurinha eu ainda não entendo — só *texto*.\n\n' +
        'Me manda digitando! Ex: `Brasil 2x1 Marrocos` ou *próximos jogos*.',
    });
  } catch (error) {
    console.error('[telegram-inbound] falha no aviso de mídia:', (error as Error).message);
  }
}
