import * as pagamentoRepo from './pagamento.repository.js';
import { getPixAdapter } from './pix.adapter.js';
import type { CobrancaGerada, GerarCobrancaInput } from './pagamento.types.js';

export async function gerarCobranca(input: GerarCobrancaInput): Promise<CobrancaGerada> {
  const adapter = getPixAdapter();
  const expiraEmMinutos = input.expiraEmMinutos ?? 30;

  const cobranca = await adapter.criarCobranca({
    valorCentavos: input.valorCentavos,
    descricao: `VAR do Bolao - ${input.nomeBolaoPretendido}`,
    expiraEmMinutos,
  });

  const pagamento = await pagamentoRepo.criarPagamento({
    usuarioId: input.usuarioId,
    valorCentavos: input.valorCentavos,
    pixExternalId: cobranca.externalId,
    pixCopiaCola: cobranca.pixCopiaCola,
    pixQrCodeUrl: cobranca.pixQrCodeUrl,
    nomeBolaoPretendido: input.nomeBolaoPretendido,
    senhaBolaoHashPretendido: input.senhaBolaoHashPretendido,
    expiraEm: cobranca.expiraEm,
  });

  return {
    pagamentoId: pagamento.id,
    pixExternalId: cobranca.externalId,
    pixCopiaCola: cobranca.pixCopiaCola,
    pixQrCodeUrl: cobranca.pixQrCodeUrl,
    expiraEm: cobranca.expiraEm,
  };
}

/**
 * Consulta o provider para todos os pagamentos pendentes. Retorna os IDs
 * que foram marcados como pagos nesta execucao — permite ao job criar os
 * boloes correspondentes e notificar usuarios.
 */
export async function sincronizarStatusPendentes(): Promise<string[]> {
  const adapter = getPixAdapter();
  const pendentes = await pagamentoRepo.buscarPendentesNaoExpirados();
  const pagosAgora: string[] = [];

  for (const p of pendentes) {
    if (!p.pixExternalId) continue;
    try {
      const status = await adapter.consultarStatus(p.pixExternalId);
      if (status === 'PAGO') {
        await pagamentoRepo.marcarComoPago(p.id);
        pagosAgora.push(p.id);
      } else if (status === 'EXPIRADO') {
        await pagamentoRepo.marcarComoExpirado(p.id);
      }
    } catch (error) {
      console.error(`[pagamento] erro consultando ${p.pixExternalId}:`, (error as Error).message);
    }
  }

  return pagosAgora;
}

export async function buscarPagamento(id: string) {
  return pagamentoRepo.buscarPagamentoPorId(id);
}
