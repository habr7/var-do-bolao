import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Fluxo de onboarding + roteamento inbound do Telegram, ponta a ponta:
 *   /start → pede número → acha cadastro → confirma → vincula
 *   número desconhecido → oferece criar novo
 *   usuário já vinculado → mensagem vai pro command.router (waId certo)
 *   mídia → aviso amigável | dedup por update_id
 *
 * Bordas mockadas: env (DRY_RUN captura os envios), redis (in-memory),
 * prisma (vi.fn) e command.router (vi.fn). O evolution.client é REAL —
 * as respostas do onboarding são capturadas pelo dry-run capture.
 */

vi.mock('../../src/config/env.js', () => ({
  env: {
    DRY_RUN_WHATSAPP: true,
    ENABLE_WHATSAPP: true,
    ENABLE_TELEGRAM: true,
    TELEGRAM_BOT_TOKEN: 'test-token',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'dry-run-key',
    EVOLUTION_INSTANCE: 'varbolao',
  },
}));

// ---- Redis fake in-memory (get/set/setex/del com suporte a NX) ----
const store = new Map<string, string>();
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    },
    setex: async (k: string, _ttl: number, v: string) => {
      store.set(k, v);
      return 'OK';
    },
    del: async (k: string) => {
      store.delete(k);
      return 1;
    },
  },
}));

// ---- Prisma fake ----
const usuarioFindUnique = vi.fn();
const usuarioFindFirst = vi.fn();
const usuarioUpdate = vi.fn();
const usuarioCreate = vi.fn();
vi.mock('../../src/config/database.js', () => ({
  prisma: {
    usuario: {
      findUnique: (...a: unknown[]) => usuarioFindUnique(...a),
      findFirst: (...a: unknown[]) => usuarioFindFirst(...a),
      update: (...a: unknown[]) => usuarioUpdate(...a),
      create: (...a: unknown[]) => usuarioCreate(...a),
    },
  },
}));

// ---- command.router fake ----
const handleIncomingMessage = vi.fn();
vi.mock('../../src/whatsapp/command.router.js', () => ({
  handleIncomingMessage: (...a: unknown[]) => handleIncomingMessage(...a),
}));

import { processarUpdateTelegram } from '../../src/messaging/telegram.inbound.js';
import { drainCapturedMessages } from '../../src/whatsapp/evolution.client.js';
import type { TelegramUpdate } from '../../src/messaging/telegram.client.js';

let updateSeq = 1000;
function updateDe(texto: string | undefined, extras: Record<string, unknown> = {}): TelegramUpdate {
  return {
    update_id: updateSeq++,
    message: {
      message_id: updateSeq,
      from: { id: 777, first_name: 'Rafa', username: 'rafinha' },
      chat: { id: 777, type: 'private' },
      date: 1750000000,
      ...(texto !== undefined ? { text: texto } : {}),
      ...extras,
    },
  } as TelegramUpdate;
}

beforeEach(() => {
  store.clear();
  drainCapturedMessages();
  usuarioFindUnique.mockReset().mockResolvedValue(null);
  usuarioFindFirst.mockReset().mockResolvedValue(null);
  usuarioUpdate.mockReset();
  usuarioCreate.mockReset();
  handleIncomingMessage.mockReset();
});

describe('onboarding — vínculo por número', () => {
  it('/start pede o número de WhatsApp', async () => {
    await processarUpdateTelegram(updateDe('/start'));
    const sent = drainCapturedMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('tg:777');
    expect(sent[0].text).toContain('número de WhatsApp');
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('número conhecido → confirma nome → sim → vincula e recupera', async () => {
    await processarUpdateTelegram(updateDe('/start'));
    drainCapturedMessages();

    usuarioFindFirst.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      whatsappId: '5511976135412@s.whatsapp.net',
      telegramId: null,
    });
    await processarUpdateTelegram(updateDe('11 97613-5412'));
    let sent = drainCapturedMessages();
    expect(sent[0].text).toContain('Achei seu cadastro');
    expect(sent[0].text).toContain('Rafael');

    usuarioUpdate.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      whatsappId: '5511976135412@s.whatsapp.net',
      telegramId: '777',
    });
    await processarUpdateTelegram(updateDe('sim'));
    sent = drainCapturedMessages();
    expect(sent[0].text).toContain('vinculada');
    expect(usuarioUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ telegramId: '777', canalPreferido: 'telegram' }),
      }),
    );
  });

  it('número desconhecido → oferece criar do zero → sim → cria', async () => {
    await processarUpdateTelegram(updateDe('/start'));
    drainCapturedMessages();

    await processarUpdateTelegram(updateDe('11 91234-5678'));
    let sent = drainCapturedMessages();
    expect(sent[0].text).toContain('Não achei');

    usuarioCreate.mockResolvedValue({ id: 'u2', nome: 'Rafa', whatsappId: '5511912345678' });
    await processarUpdateTelegram(updateDe('sim'));
    sent = drainCapturedMessages();
    expect(sent[0].text).toContain('Cadastro criado');
    expect(usuarioCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          whatsappId: '5511912345678',
          telegramId: '777',
          canalPreferido: 'telegram',
        }),
      }),
    );
  });

  it('número já vinculado a OUTRO Telegram → recusa (não rouba vínculo)', async () => {
    await processarUpdateTelegram(updateDe('/start'));
    drainCapturedMessages();

    usuarioFindFirst.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      telegramId: '999', // outro chat
    });
    await processarUpdateTelegram(updateDe('11 97613-5412'));
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('já está vinculado');
    expect(usuarioUpdate).not.toHaveBeenCalled();
  });

  it('texto que não é número → re-pede com exemplo', async () => {
    await processarUpdateTelegram(updateDe('/start'));
    drainCapturedMessages();
    await processarUpdateTelegram(updateDe('oi tudo bem?'));
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('DDD + número');
  });
});

describe('usuário vinculado — roteamento pro command.router', () => {
  it('mensagem vira handleIncomingMessage com waId do cadastro', async () => {
    usuarioFindUnique.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      whatsappId: '5511976135412@s.whatsapp.net',
      telegramId: '777',
    });
    await processarUpdateTelegram(updateDe('ranking'));
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        waId: '5511976135412@s.whatsapp.net',
        text: 'ranking',
        senderName: 'Rafael',
      }),
    );
  });

  it('/start de usuário vinculado vira "oi" (re-boas-vindas)', async () => {
    usuarioFindUnique.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      whatsappId: '5511976135412@s.whatsapp.net',
      telegramId: '777',
    });
    await processarUpdateTelegram(updateDe('/start'));
    expect(handleIncomingMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'oi' }),
    );
  });
});

describe('guards', () => {
  it('dedup: mesmo update_id processado 1x só', async () => {
    const u = updateDe('/start');
    await processarUpdateTelegram(u);
    await processarUpdateTelegram(u);
    expect(drainCapturedMessages()).toHaveLength(1);
  });

  it('grupo é ignorado (DM-only)', async () => {
    const u = updateDe('oi');
    (u.message as { chat: { type: string } }).chat.type = 'group';
    await processarUpdateTelegram(u);
    expect(drainCapturedMessages()).toHaveLength(0);
    expect(handleIncomingMessage).not.toHaveBeenCalled();
  });

  it('mídia sem texto → aviso amigável com rate-limit 1x', async () => {
    usuarioFindUnique.mockResolvedValue({ id: 'u1', nome: 'R', whatsappId: 'x', telegramId: '777' });
    await processarUpdateTelegram(updateDe(undefined, { photo: [{}] }));
    await processarUpdateTelegram(updateDe(undefined, { sticker: {} }));
    const sent = drainCapturedMessages();
    expect(sent).toHaveLength(1); // rate-limit segurou o 2º
    expect(sent[0].text).toContain('só *texto*');
  });
});
