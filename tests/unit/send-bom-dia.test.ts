import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.36.0 — send-bom-dia: horário fixo (HORARIO_BOM_DIA) + flag diária
 * própria + conteúdo adaptativo (falta palpitar vs já palpitou).
 */

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  sendText: vi.fn(async () => ({})),
  reservar: vi.fn(async () => true),
  devolver: vi.fn(async () => {}),
  store: new Map<string, string>(),
  env: { ENABLE_BOM_DIA: true, HORARIO_BOM_DIA: '09:00' },
}));

vi.mock('../../src/config/env.js', () => ({ env: h.env }));
vi.mock('../../src/config/database.js', () => ({
  prisma: { bolao: { findMany: (...a: unknown[]) => h.findMany(...a) } },
}));
vi.mock('../../src/config/redis.js', () => ({
  redis: {
    get: async (k: string) => h.store.get(k) ?? null,
    set: async (k: string, v: string, _ex?: string, _ttl?: number, nx?: string) => {
      if (nx === 'NX' && h.store.has(k)) return null;
      h.store.set(k, String(v));
      return 'OK';
    },
    del: async (k: string) => {
      h.store.delete(k);
      return 1;
    },
  },
}));
vi.mock('../../src/whatsapp/evolution.client.js', () => ({ sendText: (...a: unknown[]) => h.sendText(...a) }));
vi.mock('../../src/utils/aviso-cap.js', () => ({
  reservarCotaAviso: (...a: unknown[]) => h.reservar(...a),
  devolverCotaAviso: (...a: unknown[]) => h.devolver(...a),
}));

const { sendBomDiaJob } = await import('../../src/jobs/send-bom-dia.job.js');

// monta 1 bolão com 1 jogo daqui a algumas horas + participantes c/ ou s/ palpite
function bolaoComJogo(participantes: Array<{ id: string; wa: string; palpitou: boolean }>) {
  const jogoId = 'j1';
  return [
    {
      nome: 'Firma',
      participacoes: participantes.map((p) => ({ usuarioId: p.id, usuario: { whatsappId: p.wa, nome: p.id } })),
      rodadas: [
        {
          jogos: [
            { id: jogoId, timeCasa: 'Brasil', timeVisitante: 'Marrocos', dataHora: new Date(Date.now() + 5 * 3600_000) },
          ],
          palpites: participantes
            .filter((p) => p.palpitou)
            .map((p) => ({ usuarioId: p.id, jogos: [{ jogoId }] })),
        },
      ],
    },
  ];
}

// v3.49.0 — usuário no MESMO confronto em N bolões (rodada própria por bolão).
// `apiJogoId` é o mesmo em todos; `idDoBolao` deixa o `Jogo.id`/palpite únicos
// por bolão. `palpitouEm` = lista dos bolões (índice) onde a pessoa já palpitou.
function doisBoloesMesmoJogo(opts: {
  wa: string;
  uid: string;
  apiJogoId: string;
  palpitouEm: number[]; // índices dos bolões (0,1) onde palpitou
  nBoloes?: number;
}) {
  const n = opts.nBoloes ?? 2;
  return Array.from({ length: n }, (_, b) => {
    const jogoId = `j-${b}`; // Jogo.id distinto por bolão
    const palpitou = opts.palpitouEm.includes(b);
    return {
      nome: `Bolao ${b}`,
      participacoes: [{ usuarioId: opts.uid, usuario: { whatsappId: opts.wa, nome: opts.uid } }],
      rodadas: [
        {
          jogos: [
            {
              id: jogoId,
              apiJogoId: opts.apiJogoId,
              timeCasa: 'Brasil',
              timeVisitante: 'Japão',
              dataHora: new Date(Date.now() + 5 * 3600_000),
            },
          ],
          palpites: palpitou ? [{ usuarioId: opts.uid, jogos: [{ jogoId }] }] : [],
        },
      ],
    };
  });
}

// força a "hora BRT" pro teste — controla via mock de Date? Simplest: setamos
// HORARIO_BOM_DIA pra a hora atual em BRT, e pra o teste "fora de hora",
// setamos pra uma hora impossível de bater.
function horaBRTAgora(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }), 10);
}

beforeEach(() => {
  h.store.clear();
  h.findMany.mockReset();
  h.sendText.mockClear();
  h.reservar.mockReset();
  h.reservar.mockResolvedValue(true);
  h.devolver.mockReset();
  h.env.ENABLE_BOM_DIA = true;
  h.env.HORARIO_BOM_DIA = `${String(horaBRTAgora()).padStart(2, '0')}:00`; // bate a hora atual
});

describe('sendBomDiaJob (v3.36.0 — hora fixa)', () => {
  it('FORA da hora de HORARIO_BOM_DIA → não consulta nem envia', async () => {
    h.env.HORARIO_BOM_DIA = `${String((horaBRTAgora() + 3) % 24).padStart(2, '0')}:00`;
    await sendBomDiaJob();
    expect(h.findMany).not.toHaveBeenCalled();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('NA hora: envia pra TODOS (palpitou e não-palpitou), com conteúdo adaptativo', async () => {
    h.findMany.mockResolvedValue(
      bolaoComJogo([
        { id: 'u1', wa: 'wa-1', palpitou: false },
        { id: 'u2', wa: 'wa-2', palpitou: true },
      ]),
    );
    await sendBomDiaJob();
    expect(h.sendText).toHaveBeenCalledTimes(2);
    const porWa = Object.fromEntries(h.sendText.mock.calls.map((c) => [c[0].to, c[0].text]));
    expect(porWa['wa-1']).toContain('falta palpitar'); // não palpitou → lembra
    expect(porWa['wa-2']).toContain('Boa sorte'); // palpitou tudo → boa sorte
  });

  it('idempotência diária: 2ª execução no mesmo dia não reenvia', async () => {
    h.findMany.mockResolvedValue(bolaoComJogo([{ id: 'u1', wa: 'wa-1', palpitou: false }]));
    await sendBomDiaJob();
    expect(h.sendText).toHaveBeenCalledTimes(1);
    await sendBomDiaJob(); // flag bomdia:wa-1:{dia} já existe
    expect(h.sendText).toHaveBeenCalledTimes(1);
  });

  it('respeita o cap diário (reserva falhou → não envia e libera a flag)', async () => {
    h.reservar.mockResolvedValue(false);
    h.findMany.mockResolvedValue(bolaoComJogo([{ id: 'u1', wa: 'wa-1', palpitou: false }]));
    await sendBomDiaJob();
    expect(h.sendText).not.toHaveBeenCalled();
  });

  it('desligado por env → não faz nada', async () => {
    h.env.ENABLE_BOM_DIA = false;
    await sendBomDiaJob();
    expect(h.findMany).not.toHaveBeenCalled();
  });
});

describe('sendBomDiaJob — dedup cross-bolão (v3.49.0, caso "bom dia duplicado")', () => {
  it('usuário em 2 bolões com o MESMO jogo → lista o confronto 1x só', async () => {
    h.findMany.mockResolvedValue(
      doisBoloesMesmoJogo({ wa: 'wa-1', uid: 'u1', apiJogoId: 'WC_R32_73', palpitouEm: [0, 1] }),
    );
    await sendBomDiaJob();
    expect(h.sendText).toHaveBeenCalledTimes(1);
    const texto: string = h.sendText.mock.calls[0][0].text;
    // o confronto aparece UMA vez (antes do fix vinha 2x)
    const ocorrencias = texto.split('Brasil x Japão').length - 1;
    expect(ocorrencias).toBe(1);
  });

  it('palpitou em TODOS os bolões → ✅ e "Boa sorte"', async () => {
    h.findMany.mockResolvedValue(
      doisBoloesMesmoJogo({ wa: 'wa-1', uid: 'u1', apiJogoId: 'WC_R32_73', palpitouEm: [0, 1] }),
    );
    await sendBomDiaJob();
    const texto: string = h.sendText.mock.calls[0][0].text;
    expect(texto).toContain('✅');
    expect(texto).toContain('Boa sorte');
    expect(texto).not.toContain('falta palpitar');
  });

  it('palpitou em SÓ UM bolão → ⚪ pendente (não esconde a falta no outro)', async () => {
    h.findMany.mockResolvedValue(
      doisBoloesMesmoJogo({ wa: 'wa-1', uid: 'u1', apiJogoId: 'WC_R32_73', palpitouEm: [0] }),
    );
    await sendBomDiaJob();
    const texto: string = h.sendText.mock.calls[0][0].text;
    expect(texto).toContain('⚪');
    expect(texto).toContain('falta palpitar (1)');
  });
});
