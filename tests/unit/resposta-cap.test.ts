import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * v3.18.0 — Anti-loop reativo (rate-limit por waId + repetição).
 *
 * Reproduz o cenário Lucas 11/06 com mocks do Redis.
 */

const store = new Map<string, { value: string; expireAt?: number }>();

vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: vi.fn(async (key: string) => {
      const e = store.get(key);
      if (!e) return null;
      if (e.expireAt && Date.now() > e.expireAt) {
        store.delete(key);
        return null;
      }
      return e.value;
    }),
    set: vi.fn(async (key: string, value: string, _mode?: string, _ex?: string, seconds?: number) => {
      const expireAt = seconds ? Date.now() + seconds * 1000 : undefined;
      store.set(key, { value, expireAt });
      return 'OK';
    }),
    incr: vi.fn(async (key: string) => {
      const cur = parseInt(store.get(key)?.value ?? '0', 10);
      const next = cur + 1;
      const expireAt = store.get(key)?.expireAt;
      store.set(key, { value: String(next), expireAt });
      return next;
    }),
    expire: vi.fn(async (key: string, seconds: number) => {
      const e = store.get(key);
      if (!e) return 0;
      store.set(key, { value: e.value, expireAt: Date.now() + seconds * 1000 });
      return 1;
    }),
  },
}));

const { verificarAntiLoop, registrarResposta } = await import(
  '../../src/utils/resposta-cap.js'
);

describe('verificarAntiLoop — caso Lucas 11/06', () => {
  beforeEach(() => {
    store.clear();
  });

  it('permite a 1ª mensagem', async () => {
    const r = await verificarAntiLoop('5511999999999', 'oi');
    expect(r.permitir).toBe(true);
  });

  it('permite até 8 mensagens diferentes em 60s; bloqueia a 9ª', async () => {
    const wa = '5511111111111';
    for (let i = 0; i < 8; i++) {
      const r = await verificarAntiLoop(wa, `mensagem ${i}`);
      expect(r.permitir).toBe(true);
      await registrarResposta(wa, `mensagem ${i}`);
    }
    const r9 = await verificarAntiLoop(wa, 'mensagem 9');
    expect(r9.permitir).toBe(false);
    expect(r9.motivo).toBe('cap_60s');
  });

  it('depois de bloquear, mantém silenciado por 5min mesmo com texto novo', async () => {
    const wa = '5511222222222';
    for (let i = 0; i < 8; i++) {
      await registrarResposta(wa, `m${i}`);
    }
    const bloqueada = await verificarAntiLoop(wa, 'm9');
    expect(bloqueada.motivo).toBe('cap_60s');
    // Próxima chamada ainda dentro do TTL de silenciado
    const novaTentativa = await verificarAntiLoop(wa, 'totalmente diferente');
    expect(novaTentativa.permitir).toBe(false);
    expect(novaTentativa.motivo).toBe('silenciado');
  });

  it('detecta mensagem REPETIDA idêntica em <60s (camada 4)', async () => {
    const wa = '5511333333333';
    const texto = 'Agradeço seu contato, respondo em breve';
    const r1 = await verificarAntiLoop(wa, texto);
    expect(r1.permitir).toBe(true);
    await registrarResposta(wa, texto);
    const r2 = await verificarAntiLoop(wa, texto);
    expect(r2.permitir).toBe(false);
    expect(r2.motivo).toBe('repetida');
  });

  it('NÃO silencia resposta repetida quando o user está em FLUXO interativo (caso Andre 28/06)', async () => {
    const wa = '5511ANDRE';
    // Responde "2" pro 1º empate da fila → processa
    expect((await verificarAntiLoop(wa, '2', { emFluxoInterativo: true })).permitir).toBe(true);
    await registrarResposta(wa, '2');
    // Responde "2" de novo pro 2º empate → ANTES era silenciado (repetida);
    // agora passa porque está num fluxo (CONFIRMANDO_CLASSIFICADO_MATAMATA).
    expect((await verificarAntiLoop(wa, '2', { emFluxoInterativo: true })).permitir).toBe(true);
  });

  it('em IDLE (sem fluxo) a camada 4 segue ativa contra auto-reply', async () => {
    const wa = '5511IDLE';
    const texto = 'Agradeço seu contato, respondo em breve';
    expect((await verificarAntiLoop(wa, texto, { emFluxoInterativo: false })).permitir).toBe(true);
    await registrarResposta(wa, texto);
    const r2 = await verificarAntiLoop(wa, texto, { emFluxoInterativo: false });
    expect(r2.permitir).toBe(false);
    expect(r2.motivo).toBe('repetida');
  });

  it('o cap_60s continua valendo MESMO em fluxo interativo (loop real é barrado)', async () => {
    const wa = '5511CAP';
    for (let i = 0; i < 8; i++) await registrarResposta(wa, '2');
    const nona = await verificarAntiLoop(wa, '2', { emFluxoInterativo: true });
    expect(nona.permitir).toBe(false);
    expect(nona.motivo).toBe('cap_60s');
  });

  it('isolamento entre users', async () => {
    for (let i = 0; i < 8; i++) {
      await registrarResposta('5511aaaaaaaaa', `m${i}`);
    }
    expect((await verificarAntiLoop('5511aaaaaaaaa', 'm9')).permitir).toBe(false);
    expect((await verificarAntiLoop('5511bbbbbbbbb', 'oi')).permitir).toBe(true);
  });

  it('cenário EXATO Lucas: 8 respostas seguidas em 60s → 9ª bloqueada', async () => {
    const wa = '5511LUCAS';
    // 1: bom-dia → Lucas responde "Agradeço seu contato"
    // 2: bot manda "Imagina! Tamo junto"
    // 3-8: auto-reply ↔ bot loop
    const respostasBot = [
      'Imagina! Tamo junto na missão da Copa.',
      'Disponha! Quando precisar é só mandar bala.',
      'Magina, Lucas! Tamo junto.',
      'Imagina! Tamo junto na missão da Copa.',
      'Disponha! Quando precisar é só mandar bala.',
      'Imagina! Tamo junto na missão da Copa.',
      'Disponha! Quando precisar é só mandar bala.',
      'Imagina! Tamo junto na missão da Copa.',
    ];
    for (const r of respostasBot) {
      const v = await verificarAntiLoop(wa, r);
      expect(v.permitir).toBe(true);
      await registrarResposta(wa, r);
    }
    // 9ª — sai do cap
    const nona = await verificarAntiLoop(wa, 'Disponha!');
    expect(nona.permitir).toBe(false);
    expect(nona.motivo).toBe('cap_60s');
  });
});
