import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.23.0 — janela de polling do `fetch-results`. A API só deve ser
 * consultada por jogo realmente "em andamento" (AO_VIVO, ou AGENDADO com
 * kickoff já passado). Jogo FUTURO e jogo FINALIZADO (com placar) NÃO
 * disparam fetch — o banco é a fonte de verdade pra finalizados.
 *
 * + rede de segurança: FINALIZADO sem placar volta a ser buscado.
 */

const findMany = vi.fn();

// Mock do prisma (evita config/database.js → env.ts → DATABASE_URL).
vi.mock('../../src/config/database.js', () => ({
  prisma: { rodada: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { buscarRodadasComJogosEmAndamento } from '../../src/modules/rodada/rodada.repository.js';

beforeEach(() => findMany.mockReset());

describe('buscarRodadasComJogosEmAndamento — janela de polling', () => {
  it('filtra por AO_VIVO, AGENDADO-kickoff-passado e FINALIZADO-sem-placar', async () => {
    findMany.mockResolvedValue([]);
    const antes = Date.now();
    await buscarRodadasComJogosEmAndamento();
    const depois = Date.now();

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0][0] as {
      where: { status: unknown; jogos: { some: { OR: Array<Record<string, unknown>> } } };
    };

    // rodada ABERTA ou FECHADA
    expect(arg.where.status).toEqual({ in: ['ABERTA', 'FECHADA'] });

    const OR = arg.where.jogos.some.OR;
    // AO_VIVO sempre
    expect(OR).toContainEqual({ status: 'AO_VIVO' });
    // FINALIZADO sem placar (rede de segurança)
    expect(OR).toContainEqual({ status: 'FINALIZADO', golsCasa: null });

    // AGENDADO com kickoff <= agora
    const agendado = OR.find((o) => o.status === 'AGENDADO') as
      | { status: string; dataHora: { lte: Date } }
      | undefined;
    expect(agendado).toBeDefined();
    expect(agendado!.dataHora.lte).toBeInstanceOf(Date);
    const lte = agendado!.dataHora.lte.getTime();
    // o `agora` usado no filtro é capturado no momento da chamada
    expect(lte).toBeGreaterThanOrEqual(antes);
    expect(lte).toBeLessThanOrEqual(depois);
  });

  it('NÃO inclui cláusula pra jogo futuro nem FINALIZADO-com-placar', async () => {
    findMany.mockResolvedValue([]);
    await buscarRodadasComJogosEmAndamento();
    const arg = findMany.mock.calls[0][0] as {
      where: { jogos: { some: { OR: Array<Record<string, unknown>> } } };
    };
    const OR = arg.where.jogos.some.OR;
    // Nenhuma cláusula busca AGENDADO sem restrição de data (jogo futuro
    // entraria), nem FINALIZADO sem o filtro golsCasa:null.
    const agendadoSemData = OR.find((o) => o.status === 'AGENDADO' && !('dataHora' in o));
    expect(agendadoSemData).toBeUndefined();
    const finalizadoSemFiltro = OR.find(
      (o) => o.status === 'FINALIZADO' && !('golsCasa' in o),
    );
    expect(finalizadoSemFiltro).toBeUndefined();
  });
});
