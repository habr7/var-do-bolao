import { sincronizarStatusPendentes, buscarPagamento } from '../modules/pagamento/pagamento.service.js';
import { criarBolao } from '../modules/bolao/bolao.service.js';
import { env } from '../config/env.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { resetSession } from '../whatsapp/session.manager.js';

/**
 * Job PIX: a cada 30s verifica pagamentos pendentes. Ao detectar pago,
 * cria o Bolao correspondente, avisa o admin e limpa sessao.
 */
export async function validatePixJob() {
  const pagosAgora = await sincronizarStatusPendentes();
  if (pagosAgora.length === 0) return;

  for (const pagamentoId of pagosAgora) {
    try {
      const pagamento = await buscarPagamento(pagamentoId);
      if (!pagamento) continue;

      // Cria o bolao
      const bolao = await criarBolao({
        nome: pagamento.nomeBolaoPretendido,
        senhaHash: pagamento.senhaBolaoHashPretendido,
        adminId: pagamento.usuarioId,
        pagamentoId: pagamento.id,
        campeonatoId: env.DEFAULT_CAMPEONATO,
        campeonatoNome: 'Brasileirão Série A 2026',
      });

      await resetSession(pagamento.usuario.whatsappId);

      await sendText({
        to: pagamento.usuario.whatsappId,
        text:
          `✅ Pagamento confirmado!\n\n` +
          `🏆 Bolão *${bolao.nome}* criado com sucesso!\n` +
          `👑 Você é o admin.\n\n` +
          `Compartilhe o *nome* e a *senha* do bolão com quem você quer convidar.\n` +
          `Eles adicionam meu número, mandam "entrar em bolão" e informam nome + senha.\n` +
          `Os pedidos chegam aqui para você aprovar.\n\n` +
          `Boa sorte, craque! ⚽`,
      });
    } catch (error) {
      console.error(`[validate-pix] erro criando bolao para pagamento ${pagamentoId}:`, error);
    }
  }
}
