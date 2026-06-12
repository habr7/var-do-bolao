import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.31.0 — Lembrete de 30 min por jogo. Mocka prisma/redis/sendText/lock/
 * cap pra validar a lógica e o anti-spam (idempotência por jogo, cooldown,
 * coalescência, cap, skip de quem já palpitou).
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendText: vi.fn(async () => ({})),
  reservar: vi.fn(async () => true),
  devolver: vi.fn(async () => {}),
  redisStore: new Map<string, string>(),
  env: {
    ENABLE_LEMBRETE_30MIN: true,
    LEMBRETE_30MIN_ANTECEDENCIA_MIN: 30,
    LEMBRETE_30MIN_COOLDOWN_MIN: 90,
  },
}));

vi.mock('../../src/config/env.js', () => ({ env: h.env }));
vi.mock('../../src/config/database.js', () => ({
  prisma: { jogo: { findMany: (...a: unknown[]) => h.findMany(...a) } },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: async (k: string) => h.redisStore.get(k) ?? null,
    set: async (k: string, v: string) => {
      h.redisStore.set(k, String(v));
      return 'OK';
    },
  },
}));
vi.mock('../../src/whatsapp/evolution.client.js', () => ({
  sendText: (...a: unknown[]) => h.sendText(...a),
}));
vi.mock('../../src/utils/lock.js', () => ({
  comLockJob: async (_n: string, fn: () => Promise<void>) => {
    await fn();
    return true;
  },
}));
vi.mock('../../src/utils/aviso-cap.js', () => ({
  reservarCotaAviso: (...a: unknown[]) => h.reservar(...a),
  devolverCotaAviso: (...a: unknown[]) => h.devolver(...a),
}));

const { sendLembrete30minJob } = await import('../../src/jobs/send-lembrete-30min.job.js');

interface P {
  id: string;
  wa?: string;
}
function jogo(opts: {
  id: string;
  timeCasa?: string;
  timeVisitante?: string;
  nomeBolao?: string;
  participantes: P[];
  palpitaram?: string[];
  dataHora?: Date;
}) {
  return {
    id: opts.id,
    timeCasa: opts.timeCasa ?? 'Brasil',
    timeVisitante: opts.timeVisitante ?? 'Marrocos',
    dataHora: opts.dataHora ?? new Date(Date.now() + 20 * 60_000),
    rodada: {
      bolao: {
        nome: opts.nomeBolao ?? 'Firma',
        participacoes: opts.participantes.map((p) => ({
          usuarioId: p.id,
          usuario: { whatsappId: p.wa ?? `wa-${p.id}` },
        })),
      },
    },
    palpitesJogo: (opts.palpitaram ?? []).map((uid) => ({ palpite: { usuarioId: uid } })),
  };
}

beforeEach(() => {
  h.redisStore.clear();
  h.findMany.mockReset();
  h.sendText.mockClear();
  h.reservar.mockReset();
  h.reservar.mockResolvedValue(true);
  h.devolver.mockReset();
  h.env.ENABLE_LEMBRETE_30MIN = true;
  h.env.LEMBRETE_30MIN_ANTECEDENCIA_MIN = 30;
  h.env.LEMBRETE_30MIN_COOLDOWN_MIN = 90;
});

describe('sendLembrete30minJob', () => {
  it('cutuca quem NÃO palpitou o jogo, ignora quem palpitou', async () => {
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', participantes: [{ id: 'u1' }, { id: 'u2' }], palpitaram: ['u1'] }),
    ]);
    await sendLembrete30minJob();
    expect(h.sendText).toHaveBeenCalledOnce();
    expect(h.sendText.mock.calls[0][0].to).toBe('wa-u2');
    // marca idempotência por jogo + cooldown
    expect(h.redisStore.get('lembrete30:wa-u2:j1')).toBe('1');
    expect(h.redisStore.get('lembrete30_cd:wa-u2')).toBe('1');
  });

  it('idempotência: jogo já cutucado → não reenvia', async () => {
    h.redisStore.set('lembrete30:wa-u2:j1', '1');
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', participantes: [{ id: 'u1' }, { id: 'u2' }], palpitaram: ['u1'] }),
    ]);
    await sendLembrete30minJob();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('cooldown ativo → pula o usuário (anti-spam)', async () => {
    h.redisStore.set('lembrete30_cd:wa-u2', '1');
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', participantes: [{ id: 'u2' }], palpitaram: [] }),
    ]);
    await sendLembrete30minJob();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('coalesce: 2 jogos faltando pro mesmo user → 1 mensagem só', async () => {
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', timeCasa: 'Brasil', timeVisitante: 'Marrocos', participantes: [{ id: 'u2' }] }),
      jogo({ id: 'j2', timeCasa: 'México', timeVisitante: 'Coreia do Sul', participantes: [{ id: 'u2' }] }),
    ]);
    await sendLembrete30minJob();
    expect(h.sendText).toHaveBeenCalledOnce();
    const txt = h.sendText.mock.calls[0][0].text as string;
    expect(txt).toContain('Brasil');
    expect(txt).toContain('México');
    // ambos jogos marcados
    expect(h.redisStore.get('lembrete30:wa-u2:j1')).toBe('1');
    expect(h.redisStore.get('lembrete30:wa-u2:j2')).toBe('1');
  });

  it('respeita o cap diário (reserva falhou → não envia)', async () => {
    h.reservar.mockResolvedValue(false);
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', participantes: [{ id: 'u2' }], palpitaram: [] }),
    ]);
    await sendLembrete30minJob();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('desligado por env → nem consulta o banco', async () => {
    h.env.ENABLE_LEMBRETE_30MIN = false;
    await sendLembrete30minJob();
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('falha de envio devolve a cota (não consome)', async () => {
    h.sendText.mockRejectedValueOnce(new Error('boom'));
    h.findMany.mockResolvedValue([
      jogo({ id: 'j1', participantes: [{ id: 'u2' }], palpitaram: [] }),
    ]);
    await sendLembrete30minJob();
    expect(h.devolver).toHaveBeenCalledWith('wa-u2');
    // não marcou idempotência nem cooldown (envio falhou)
    expect(h.redisStore.get('lembrete30:wa-u2:j1')).toBeUndefined();
  });
});
