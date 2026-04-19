import crypto from 'node:crypto';
import { env } from '../../config/env.js';
import type { PixAdapter, PixStatus } from './pagamento.types.js';

/**
 * Mock PIX adapter — auto-aprova cobrancas apos ~45s (simula pagamento)
 * para dar tempo do fluxo demonstrar "aguardando pagamento" em dev/teste.
 *
 * Estado em memoria (reseta se processo reiniciar — ok pra dev).
 */
export class MockPixAdapter implements PixAdapter {
  private cobrancas = new Map<string, { criadoEm: Date; expiraEm: Date; pago: boolean }>();
  private autoPayDelayMs: number;

  constructor(autoPayDelayMs = 45_000) {
    this.autoPayDelayMs = autoPayDelayMs;
  }

  async criarCobranca(input: { valorCentavos: number; descricao: string; expiraEmMinutos: number }) {
    const externalId = `pix_mock_${crypto.randomUUID()}`;
    const agora = new Date();
    const expiraEm = new Date(agora.getTime() + input.expiraEmMinutos * 60_000);

    this.cobrancas.set(externalId, { criadoEm: agora, expiraEm, pago: false });

    const pixCopiaCola = `00020126${externalId.length.toString().padStart(4, '0')}${externalId}52040000530398654${(input.valorCentavos / 100).toFixed(2)}5802BR5913VARBolaoMock6009Sao Paulo62070503***6304ABCD`;
    const pixQrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(pixCopiaCola)}`;

    return { externalId, pixCopiaCola, pixQrCodeUrl, expiraEm };
  }

  async consultarStatus(externalId: string): Promise<PixStatus> {
    const cobranca = this.cobrancas.get(externalId);
    if (!cobranca) return 'CANCELADO';
    if (cobranca.pago) return 'PAGO';

    const agora = new Date();
    if (agora > cobranca.expiraEm) return 'EXPIRADO';

    // auto-aprova apos o delay configurado
    if (agora.getTime() - cobranca.criadoEm.getTime() > this.autoPayDelayMs) {
      cobranca.pago = true;
      return 'PAGO';
    }

    return 'PENDENTE';
  }

  /**
   * Forca qualquer cobranca pendente do adapter a ficar como PAGA no proximo
   * consultarStatus. Usado pelo REPL de simulacao para nao ter que esperar
   * o auto-pay de 45s.
   */
  forcarTodasPagas(): number {
    let count = 0;
    for (const c of this.cobrancas.values()) {
      if (!c.pago) {
        c.pago = true;
        count++;
      }
    }
    return count;
  }

  forcarPagaPorExternalId(externalId: string): boolean {
    const c = this.cobrancas.get(externalId);
    if (!c) return false;
    c.pago = true;
    return true;
  }
}

/**
 * Stub para provider real (Mercado Pago / Gerencianet).
 * Por enquanto so lanca — implementar quando tiver credenciais.
 */
export class RealPixAdapter implements PixAdapter {
  async criarCobranca(): Promise<never> {
    throw new Error(`Adapter real (${env.PIX_PROVIDER}) ainda nao implementado`);
  }
  async consultarStatus(): Promise<never> {
    throw new Error(`Adapter real (${env.PIX_PROVIDER}) ainda nao implementado`);
  }
}

let instance: PixAdapter | null = null;

export function getPixAdapter(): PixAdapter {
  if (instance) return instance;

  if (env.PIX_PROVIDER === 'mock') {
    instance = new MockPixAdapter();
  } else {
    instance = new RealPixAdapter();
  }
  return instance;
}
