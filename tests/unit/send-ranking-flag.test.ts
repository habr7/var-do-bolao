import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.53.0 — send-ranking é disparo em massa (1 msg por participante por
 * rodada). Ganhou a flag ENABLE_RANKING (OFF por padrão). Aqui garantimos
 * que, desligado, o job NÃO consulta o banco nem envia nada.
 */
const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendText: vi.fn(async () => ({})),
  env: { ENABLE_RANKING: false },
}));

vi.mock('../../src/config/env.js', () => ({ env: h.env }));
vi.mock('../../src/config/database.js', () => ({
  prisma: { rodada: { findMany: (...a: unknown[]) => h.findMany(...a) } },
}));
vi.mock('../../src/config/redis.js', () => ({ redis: { set: vi.fn(), get: vi.fn() } }));
vi.mock('../../src/whatsapp/evolution.client.js', () => ({ sendText: (...a: unknown[]) => h.sendText(...a) }));
vi.mock('../../src/modules/ranking/ranking.service.js', () => ({ recalcularRanking: vi.fn() }));

const { sendRankingJob } = await import('../../src/jobs/send-ranking.job.js');

beforeEach(() => {
  h.findMany.mockReset();
  h.sendText.mockClear();
});

describe('sendRankingJob — flag ENABLE_RANKING', () => {
  it('OFF → não consulta banco nem envia', async () => {
    h.env.ENABLE_RANKING = false;
    await sendRankingJob();
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('ON → ao menos tenta consultar rodadas (não retorna cedo)', async () => {
    h.env.ENABLE_RANKING = true;
    h.findMany.mockResolvedValue([]); // sem rodadas finalizadas → nada a enviar
    await sendRankingJob();
    expect(h.findMany).toHaveBeenCalled();
  });
});
