import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.26.0 — Broadcast administrativo. Mocka env/prisma/redis/sendText pra
 * isolar a lógica. Cobre os pontos críticos do review:
 *   - ehDono normaliza dígitos (JID vs dígitos puros)
 *   - parseBroadcast (marcador no início, corpo, vazio, mid-text, case)
 *   - destinatários TEST (só dono) vs PROD (todos, dedup)
 *   - idempotência (SET NX falhou → não reenvia)
 */

const h = vi.hoisted(() => ({
  usuarioFindMany: vi.fn(),
  sendText: vi.fn(),
  notificarEmMassaThrottled: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  envObj: {
    OWNER_WHATSAPP_IDS: '5511976135412',
    BROADCAST_MARKER: '#ENVIOPARAVARDOBOLAO#',
    BROADCAST_TEST_MODE: true,
    BROADCAST_THROTTLE_MS: 0,
    DRY_RUN_WHATSAPP: true,
  },
}));

const { usuarioFindMany, sendText, notificarEmMassaThrottled, redisSet, envObj } = h;

vi.mock('../../src/config/env.js', () => ({ env: h.envObj }));
vi.mock('../../src/config/database.js', () => ({
  prisma: { usuario: { findMany: (...a: unknown[]) => h.usuarioFindMany(...a) } },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: { set: (...a: unknown[]) => h.redisSet(...a), del: (...a: unknown[]) => h.redisDel(...a) },
}));
vi.mock('../../src/whatsapp/evolution.client.js', () => ({
  sendText: (...a: unknown[]) => h.sendText(...a),
}));
vi.mock('../../src/modules/notificacao/notificacao.service.js', () => ({
  notificarEmMassaThrottled: (...a: unknown[]) => h.notificarEmMassaThrottled(...a),
}));

import {
  ehDono,
  parseBroadcast,
  soDigitos,
  listaDonos,
  tentarBroadcastAdmin,
} from '../../src/whatsapp/broadcast.js';

beforeEach(() => {
  vi.clearAllMocks();
  envObj.OWNER_WHATSAPP_IDS = '5511976135412';
  envObj.BROADCAST_TEST_MODE = true;
  redisSet.mockResolvedValue('OK');
  notificarEmMassaThrottled.mockResolvedValue({ enviados: 1, falhas: 0 });
});

describe('soDigitos / listaDonos / ehDono', () => {
  it('ehDono casa JID e dígitos puros pro mesmo número', () => {
    expect(ehDono('5511976135412@s.whatsapp.net', '5511976135412')).toBe(true);
    expect(ehDono('5511976135412', '5511976135412')).toBe(true);
  });
  it('ehDono rejeita número diferente e vazio', () => {
    expect(ehDono('5599999999999@s.whatsapp.net', '5511976135412')).toBe(false);
    expect(ehDono('', '5511976135412')).toBe(false);
  });
  it('lista por vírgula, ignora lixo/curto', () => {
    expect(listaDonos('5511976135412, 5511888888888 , x')).toEqual(['5511976135412', '5511888888888']);
    expect(soDigitos('+55 11 97613-5412')).toBe('5511976135412');
  });
  it('OWNER vazio não casa waId vazio', () => {
    expect(ehDono('', '')).toBe(false);
  });
});

describe('parseBroadcast', () => {
  const M = '#ENVIOPARAVARDOBOLAO#';
  it('marcador + corpo → extrai corpo preservando case', () => {
    expect(parseBroadcast(`${M}\nManutenção às 22h`, M)).toEqual({ corpo: 'Manutenção às 22h' });
  });
  it('sem marcador → null', () => {
    expect(parseBroadcast('oi tudo bem', M)).toBeNull();
    expect(parseBroadcast('texto #ENVIOPARAVARDOBOLAO# no meio', M)).toBeNull();
  });
  it('marcador sem corpo → corpo vazio', () => {
    expect(parseBroadcast(`${M}   `, M)).toEqual({ corpo: '' });
  });
  it('marcador case-insensitive', () => {
    expect(parseBroadcast('#enviaparavardobolao#x', '#enviaparavardobolao#')).toEqual({ corpo: 'x' });
  });
});

describe('tentarBroadcastAdmin', () => {
  const base = { waId: '5511976135412@s.whatsapp.net', messageId: 'MID1' };

  it('não-dono → não intercepta (false), nada enviado', async () => {
    const r = await tentarBroadcastAdmin({ waId: '5599999999999', messageId: 'x', text: '#ENVIOPARAVARDOBOLAO# oi' });
    expect(r).toBe(false);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('dono SEM marcador → não intercepta (segue fluxo normal)', async () => {
    const r = await tentarBroadcastAdmin({ ...base, text: 'próximos jogos' });
    expect(r).toBe(false);
    expect(notificarEmMassaThrottled).not.toHaveBeenCalled();
  });

  it('TEST MODE: envia só pro dono', async () => {
    const r = await tentarBroadcastAdmin({ ...base, text: '#ENVIOPARAVARDOBOLAO#\nAviso teste' });
    expect(r).toBe(true);
    expect(notificarEmMassaThrottled).toHaveBeenCalledWith(['5511976135412@s.whatsapp.net'], 'Aviso teste', 0);
    expect(usuarioFindMany).not.toHaveBeenCalled();
  });

  it('PROD MODE: envia pra todos os usuários (dedup)', async () => {
    envObj.BROADCAST_TEST_MODE = false;
    usuarioFindMany.mockResolvedValue([
      { whatsappId: 'a@s.whatsapp.net' },
      { whatsappId: 'b@s.whatsapp.net' },
      { whatsappId: 'a@s.whatsapp.net' }, // duplicado
    ]);
    const r = await tentarBroadcastAdmin({ ...base, text: '#ENVIOPARAVARDOBOLAO#\nManutenção' });
    expect(r).toBe(true);
    const [waIds, texto] = notificarEmMassaThrottled.mock.calls[0];
    expect(waIds).toEqual(['a@s.whatsapp.net', 'b@s.whatsapp.net']);
    expect(texto).toBe('Manutenção');
  });

  it('corpo vazio → avisa o dono, não dispara envio', async () => {
    const r = await tentarBroadcastAdmin({ ...base, text: '#ENVIOPARAVARDOBOLAO#   ' });
    expect(r).toBe(true);
    expect(notificarEmMassaThrottled).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1); // só o aviso de vazio
  });

  it('idempotência: SET NX falhou (redelivery) → não reenvia', async () => {
    redisSet.mockResolvedValueOnce(null); // claim do done falhou
    const r = await tentarBroadcastAdmin({ ...base, text: '#ENVIOPARAVARDOBOLAO#\noi' });
    expect(r).toBe(true);
    expect(notificarEmMassaThrottled).not.toHaveBeenCalled();
  });
});
