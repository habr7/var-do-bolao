import { describe, it, expect, beforeEach } from 'vitest';
import { MockPixAdapter } from '../../src/modules/pagamento/pix.adapter.js';

describe('MockPixAdapter', () => {
  let adapter: MockPixAdapter;

  beforeEach(() => {
    // auto-pay delay curto pra teste ficar rapido
    adapter = new MockPixAdapter(50);
  });

  it('cria cobranca com campos esperados', async () => {
    const cobranca = await adapter.criarCobranca({
      valorCentavos: 9990,
      descricao: 'teste',
      expiraEmMinutos: 30,
    });

    expect(cobranca.externalId).toMatch(/^pix_mock_/);
    expect(cobranca.pixCopiaCola).toContain(cobranca.externalId);
    expect(cobranca.pixQrCodeUrl).toContain('qrserver');
    expect(cobranca.expiraEm.getTime()).toBeGreaterThan(Date.now());
  });

  it('cobranca recem-criada esta PENDENTE', async () => {
    const c = await adapter.criarCobranca({ valorCentavos: 1000, descricao: 'x', expiraEmMinutos: 30 });
    const status = await adapter.consultarStatus(c.externalId);
    expect(status).toBe('PENDENTE');
  });

  it('auto-aprova apos o delay', async () => {
    const c = await adapter.criarCobranca({ valorCentavos: 1000, descricao: 'x', expiraEmMinutos: 30 });
    await new Promise((r) => setTimeout(r, 100));
    const status = await adapter.consultarStatus(c.externalId);
    expect(status).toBe('PAGO');
  });

  it('retorna CANCELADO para externalId desconhecido', async () => {
    const status = await adapter.consultarStatus('pix_mock_inexistente');
    expect(status).toBe('CANCELADO');
  });

  it('forcarTodasPagas marca todas pendentes como PAGO', async () => {
    const c1 = await adapter.criarCobranca({ valorCentavos: 1000, descricao: 'a', expiraEmMinutos: 30 });
    const c2 = await adapter.criarCobranca({ valorCentavos: 2000, descricao: 'b', expiraEmMinutos: 30 });

    const n = adapter.forcarTodasPagas();
    expect(n).toBe(2);

    expect(await adapter.consultarStatus(c1.externalId)).toBe('PAGO');
    expect(await adapter.consultarStatus(c2.externalId)).toBe('PAGO');
  });

  it('forcarPagaPorExternalId marca apenas a cobranca alvo', async () => {
    const c1 = await adapter.criarCobranca({ valorCentavos: 1000, descricao: 'a', expiraEmMinutos: 30 });
    const c2 = await adapter.criarCobranca({ valorCentavos: 2000, descricao: 'b', expiraEmMinutos: 30 });

    const ok = adapter.forcarPagaPorExternalId(c1.externalId);
    expect(ok).toBe(true);

    expect(await adapter.consultarStatus(c1.externalId)).toBe('PAGO');
    expect(await adapter.consultarStatus(c2.externalId)).toBe('PENDENTE');
  });

  it('forcarPagaPorExternalId retorna false se id desconhecido', () => {
    expect(adapter.forcarPagaPorExternalId('inexistente')).toBe(false);
  });
});
