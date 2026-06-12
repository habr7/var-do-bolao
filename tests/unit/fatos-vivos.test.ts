import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.32.0 — construirFatosVivos: bloco [DADOS AO VIVO] pro smart-fallback.
 */

const findMany = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: { jogo: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { construirFatosVivos } from '../../src/llm/fatos-vivos.js';

function jogo(opts: {
  timeCasa: string;
  timeVisitante: string;
  status: string;
  minutosOffset: number; // negativo = começou no passado
  golsCasa?: number | null;
  golsVisitante?: number | null;
}) {
  return {
    timeCasa: opts.timeCasa,
    timeVisitante: opts.timeVisitante,
    status: opts.status,
    dataHora: new Date(Date.now() + opts.minutosOffset * 60_000),
    golsCasa: opts.golsCasa ?? null,
    golsVisitante: opts.golsVisitante ?? null,
  };
}

beforeEach(() => findMany.mockReset());

describe('construirFatosVivos', () => {
  it('jogo AO_VIVO com placar parcial → seção "Rolando agora" (caso Humberto 11/06)', async () => {
    findMany.mockResolvedValue([
      jogo({ timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca', status: 'AO_VIVO', minutosOffset: -30, golsCasa: 0, golsVisitante: 0 }),
    ]);
    const bloco = await construirFatosVivos('u1');
    expect(bloco).toContain('[DADOS AO VIVO');
    expect(bloco).toContain('Rolando agora');
    expect(bloco).toContain('Coreia do Sul x República Tcheca — ROLANDO AGORA (0 x 0');
  });

  it('jogo AGENDADO com kickoff passado (<2.5h) também conta como rolando', async () => {
    findMany.mockResolvedValue([
      jogo({ timeCasa: 'Brasil', timeVisitante: 'Marrocos', status: 'AGENDADO', minutosOffset: -40 }),
    ]);
    const bloco = await construirFatosVivos('u1');
    expect(bloco).toContain('ROLANDO AGORA');
    expect(bloco).toContain('placar parcial indisponível');
  });

  it('finalizado com placar + próximo com horário', async () => {
    findMany.mockResolvedValue([
      jogo({ timeCasa: 'México', timeVisitante: 'África do Sul', status: 'FINALIZADO', minutosOffset: -600, golsCasa: 2, golsVisitante: 0 }),
      jogo({ timeCasa: 'Catar', timeVisitante: 'Suíça', status: 'AGENDADO', minutosOffset: 300 }),
    ]);
    const bloco = await construirFatosVivos('u1');
    expect(bloco).toContain('México 2 x 0 África do Sul (encerrado)');
    expect(bloco).toContain('Próximos jogos');
    expect(bloco).toContain('Catar x Suíça');
  });

  it('sem jogos → null (não infla o prompt)', async () => {
    findMany.mockResolvedValue([]);
    expect(await construirFatosVivos('u1')).toBeNull();
  });

  it('query falhou → null (não derruba o fallback)', async () => {
    findMany.mockImplementationOnce(async () => {
      throw new Error('db down');
    });
    expect(await construirFatosVivos('u1')).toBeNull();
  });

  it('dedup: mesmo jogo em 2 bolões aparece 1x', async () => {
    const j = jogo({ timeCasa: 'Brasil', timeVisitante: 'Marrocos', status: 'AO_VIVO', minutosOffset: -10, golsCasa: 1, golsVisitante: 0 });
    findMany.mockResolvedValue([j, { ...j }]);
    const bloco = await construirFatosVivos('u1');
    const ocorrencias = (bloco!.match(/Brasil x Marrocos/g) ?? []).length;
    expect(ocorrencias).toBe(1);
  });

  it('respeita o teto de tamanho (~900 chars)', async () => {
    findMany.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) =>
        jogo({ timeCasa: `Time Com Nome Comprido ${i}`, timeVisitante: `Outro Time Comprido ${i}`, status: 'FINALIZADO', minutosOffset: -100 - i, golsCasa: 1, golsVisitante: 1 }),
      ),
    );
    const bloco = await construirFatosVivos('u1');
    expect(bloco!.length).toBeLessThanOrEqual(950);
  });
});
