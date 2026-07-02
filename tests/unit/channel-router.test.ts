import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Testa a decisão de rota do channel-router em todos os cenários de flag:
 *  - default (só WhatsApp): tudo pro WhatsApp, SEM tocar no banco
 *  - migração (só Telegram): linkado → Telegram; sem vínculo → drop
 *  - ambos ligados: canalPreferido decide
 *  - endereço tg:<id> força Telegram
 */

const { envMock, findFirst } = vi.hoisted(() => ({
  envMock: {
    ENABLE_WHATSAPP: true,
    ENABLE_TELEGRAM: false,
  },
  findFirst: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({ env: envMock }));

vi.mock('../../src/config/database.js', () => ({
  prisma: { usuario: { findFirst: (...args: unknown[]) => findFirst(...args) } },
}));

import { resolverRotaEnvio, invalidarCacheCanal, enderecoTelegram } from '../../src/messaging/channel-router.js';

beforeEach(() => {
  findFirst.mockReset();
  invalidarCacheCanal();
  envMock.ENABLE_WHATSAPP = true;
  envMock.ENABLE_TELEGRAM = false;
});

describe('resolverRotaEnvio — flags default (só WhatsApp)', () => {
  it('vai pro WhatsApp sem consultar o banco (caminho quente atual)', async () => {
    const rota = await resolverRotaEnvio('5511999999999@s.whatsapp.net');
    expect(rota).toEqual({ canal: 'whatsapp', to: '5511999999999@s.whatsapp.net' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('endereco tg: com Telegram desligado → drop', async () => {
    const rota = await resolverRotaEnvio('tg:12345');
    expect(rota.canal).toBe('drop');
  });
});

describe('resolverRotaEnvio — migração (ENABLE_WHATSAPP=false, ENABLE_TELEGRAM=true)', () => {
  beforeEach(() => {
    envMock.ENABLE_WHATSAPP = false;
    envMock.ENABLE_TELEGRAM = true;
  });

  it('usuário linkado → Telegram', async () => {
    findFirst.mockResolvedValue({ telegramId: '777', canalPreferido: 'telegram' });
    const rota = await resolverRotaEnvio('5511999999999@s.whatsapp.net');
    expect(rota).toEqual({ canal: 'telegram', chatId: '777' });
  });

  it('usuário linkado mesmo sem canalPreferido → Telegram (WhatsApp off)', async () => {
    findFirst.mockResolvedValue({ telegramId: '777', canalPreferido: null });
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'telegram', chatId: '777' });
  });

  it('usuário SEM vínculo → drop (loga e não envia)', async () => {
    findFirst.mockResolvedValue(null);
    const rota = await resolverRotaEnvio('5511888888888');
    expect(rota.canal).toBe('drop');
  });

  it('endereco tg:<id> vai direto (onboarding, sem vínculo ainda)', async () => {
    const rota = await resolverRotaEnvio(enderecoTelegram(999));
    expect(rota).toEqual({ canal: 'telegram', chatId: '999' });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe('resolverRotaEnvio — ambos ligados', () => {
  beforeEach(() => {
    envMock.ENABLE_WHATSAPP = true;
    envMock.ENABLE_TELEGRAM = true;
  });

  it('canalPreferido=telegram → Telegram', async () => {
    findFirst.mockResolvedValue({ telegramId: '42', canalPreferido: 'telegram' });
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'telegram', chatId: '42' });
  });

  it('linkado mas canalPreferido=whatsapp → WhatsApp', async () => {
    findFirst.mockResolvedValue({ telegramId: '42', canalPreferido: 'whatsapp' });
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'whatsapp', to: '5511999999999' });
  });

  it('sem vínculo → WhatsApp (comportamento atual)', async () => {
    findFirst.mockResolvedValue(null);
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'whatsapp', to: '5511999999999' });
  });

  it('cache: 2ª chamada pro mesmo waId não consulta o banco de novo', async () => {
    findFirst.mockResolvedValue({ telegramId: '42', canalPreferido: 'telegram' });
    await resolverRotaEnvio('5511999999999');
    await resolverRotaEnvio('5511999999999');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('invalidarCacheCanal força re-consulta (pós-vínculo)', async () => {
    findFirst.mockResolvedValue(null);
    await resolverRotaEnvio('5511999999999');
    invalidarCacheCanal('5511999999999');
    findFirst.mockResolvedValue({ telegramId: '42', canalPreferido: 'telegram' });
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'telegram', chatId: '42' });
  });

  it('busca cobre variantes do waId (JID e dígitos)', async () => {
    findFirst.mockResolvedValue(null);
    await resolverRotaEnvio('5511999999999@s.whatsapp.net');
    const arg = findFirst.mock.calls[0][0] as {
      where: { whatsappId: { in: string[] } };
    };
    expect(arg.where.whatsappId.in).toContain('5511999999999@s.whatsapp.net');
    expect(arg.where.whatsappId.in).toContain('5511999999999');
  });

  it('banco fora do ar → não derruba envio, cai pro WhatsApp', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    const rota = await resolverRotaEnvio('5511999999999');
    expect(rota).toEqual({ canal: 'whatsapp', to: '5511999999999' });
  });
});
