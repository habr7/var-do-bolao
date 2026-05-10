import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mocka env com DRY_RUN_WHATSAPP ligado
vi.mock('../../src/config/env.js', () => ({
  env: {
    DRY_RUN_WHATSAPP: true,
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'dry-run-key',
    EVOLUTION_INSTANCE: 'varbolao',
  },
}));

import {
  sendText,
  sendImage,
  drainCapturedMessages,
  setCaptureListener,
  type CapturedMessage,
} from '../../src/whatsapp/evolution.client.js';

describe('evolution.client em DRY_RUN', () => {
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

  it('listener com erro nao quebra o fluxo', async () => {
    setCaptureListener(() => {
      throw new Error('listener falhou');
    });

    await expect(sendText({ to: '5511999999999', text: 'ok' })).resolves.toBeDefined();
  });
});
