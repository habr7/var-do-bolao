import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka env com DRY_RUN_META ligado
vi.mock('../../src/config/env.js', () => ({
  env: {
    DRY_RUN_META: true,
    WHATSAPP_API_VERSION: 'v18.0',
    WHATSAPP_ACCESS_TOKEN: 'dry-run-token',
    WHATSAPP_PHONE_NUMBER_ID: 'dry-run-phone',
  },
}));

import {
  sendText,
  sendImage,
  drainCapturedMessages,
  setCaptureListener,
  type CapturedMessage,
} from '../../src/whatsapp/meta.client.js';

describe('meta.client em DRY_RUN', () => {
  beforeEach(() => {
    drainCapturedMessages();
    setCaptureListener(null);
  });

  it('sendText nao faz HTTP e captura a mensagem', async () => {
    const res = await sendText({ to: '5511999999999', text: 'oi craque' });
    expect(res).toEqual({ dryRun: true });

    const captured = drainCapturedMessages();
    expect(captured).toHaveLength(1);
    expect(captured[0].to).toBe('5511999999999');
    expect(captured[0].text).toBe('oi craque');
  });

  it('sendImage captura url e caption', async () => {
    await sendImage({ to: '5511888888888', imageUrl: 'https://x.com/a.png', caption: 'ranking' });

    const captured = drainCapturedMessages();
    expect(captured).toHaveLength(1);
    expect(captured[0].imageUrl).toBe('https://x.com/a.png');
    expect(captured[0].caption).toBe('ranking');
  });

  it('drainCapturedMessages limpa a fila', async () => {
    await sendText({ to: '5511000000001', text: 'a' });
    await sendText({ to: '5511000000001', text: 'b' });

    expect(drainCapturedMessages()).toHaveLength(2);
    expect(drainCapturedMessages()).toHaveLength(0);
  });

  it('setCaptureListener recebe mensagens em tempo real', async () => {
    const received: CapturedMessage[] = [];
    setCaptureListener((m) => received.push(m));

    await sendText({ to: '5511999999999', text: 'tempo real' });

    expect(received).toHaveLength(1);
    expect(received[0].text).toBe('tempo real');
  });

  it('listener erro nao quebra o fluxo', async () => {
    setCaptureListener(() => {
      throw new Error('listener falhou');
    });

    // nao deve lancar
    await expect(sendText({ to: '5511999999999', text: 'ok' })).resolves.toBeDefined();
  });
});
