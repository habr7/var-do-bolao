import { describe, it, expect, vi } from 'vitest';

// advance-bracket.job importa database/lock (→ env/redis). Mocka pra o teste de
// lógica pura não depender de ambiente — advanceBracketComClient recebe o client.
vi.mock('../../src/config/database.js', () => ({ prisma: {} }));
vi.mock('../../src/utils/lock.js', () => ({ comLockJob: vi.fn() }));

const { advanceBracketComClient } = await import('../../src/jobs/advance-bracket.job.js');

/**
 * Trava o advance-bracket: vencedor → próximo jogo (slot certo), perdedor das
 * semis → 3º lugar, abertura da rodada quando os dois lados ficam reais, e
 * idempotência (não sobrescreve time real). Usa um client prisma em memória.
 */

interface JogoFix {
  id: string;
  apiJogoId: string;
  bolaoId: string;
  rodadaId: string;
  fase: string;
  status: string;
  classificadoLado: 'CASA' | 'VISITANTE' | null;
  timeCasa: string;
  timeVisitante: string;
  proximoJogoApiId: string | null;
  proximoSlot: 'CASA' | 'VISITANTE' | null;
}
interface RodadaFix {
  id: string;
  bolaoId: string;
  status: string;
}

function fakeDb(jogos: JogoFix[], rodadas: RodadaFix[]) {
  function matchWhere(j: JogoFix, where: any): boolean {
    if (!where) return true;
    if (where.fase?.not && j.fase === where.fase.not) return false;
    if (where.status && j.status !== where.status) return false;
    if (where.classificadoLado?.not === null && j.classificadoLado === null) return false;
    if (where.apiJogoId && j.apiJogoId !== where.apiJogoId) return false;
    if (where.rodada?.bolaoId && j.bolaoId !== where.rodada.bolaoId) return false;
    return true;
  }
  const db = {
    jogo: {
      findMany: async ({ where }: any) =>
        jogos.filter((j) => matchWhere(j, where)).map((j) => ({ ...j, rodada: { bolaoId: j.bolaoId } })),
      findFirst: async ({ where }: any) => {
        const j = jogos.find((x) => matchWhere(x, where));
        if (!j) return null;
        const rodada = rodadas.find((r) => r.id === j.rodadaId)!;
        return { ...j, rodada: { id: rodada.id, status: rodada.status } };
      },
      update: async ({ where, data }: any) => {
        const j = jogos.find((x) => x.id === where.id)!;
        Object.assign(j, data);
        return j;
      },
      // escreverSlot usa updateMany com guarda no WHERE (slot ainda placeholder).
      updateMany: async ({ where, data }: any) => {
        const j = jogos.find(
          (x) =>
            x.id === where.id &&
            (where.timeCasa === undefined || x.timeCasa === where.timeCasa) &&
            (where.timeVisitante === undefined || x.timeVisitante === where.timeVisitante),
        );
        if (!j) return { count: 0 };
        Object.assign(j, data);
        return { count: 1 };
      },
    },
    rodada: {
      update: async ({ where, data }: any) => {
        const r = rodadas.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  };
  return db as any;
}

describe('advanceBracketComClient', () => {
  it('finalizar 73 e 75 preenche os dois lados da oitava 90 e abre a rodada', async () => {
    // 73 → OIT90:CASA, 75 → OIT90:VIS (do bracket real).
    const jogos: JogoFix[] = [
      {
        id: 'j73', apiJogoId: 'WC2026_R32_73', bolaoId: 'b1', rodadaId: 'rR32', fase: 'R32',
        status: 'FINALIZADO', classificadoLado: 'CASA', timeCasa: 'Brasil', timeVisitante: 'Chile',
        proximoJogoApiId: 'WC2026_OIT_90', proximoSlot: 'CASA',
      },
      {
        id: 'j75', apiJogoId: 'WC2026_R32_75', bolaoId: 'b1', rodadaId: 'rR32', fase: 'R32',
        status: 'FINALIZADO', classificadoLado: 'VISITANTE', timeCasa: 'Japão', timeVisitante: 'Gana',
        proximoJogoApiId: 'WC2026_OIT_90', proximoSlot: 'VISITANTE',
      },
      {
        id: 'j90', apiJogoId: 'WC2026_OIT_90', bolaoId: 'b1', rodadaId: 'rOIT', fase: 'OITAVAS',
        status: 'AGENDADO', classificadoLado: null, timeCasa: 'Vencedor 73', timeVisitante: 'Vencedor 75',
        proximoJogoApiId: 'WC2026_QUA_97', proximoSlot: 'VISITANTE',
      },
    ];
    const rodadas: RodadaFix[] = [
      { id: 'rR32', bolaoId: 'b1', status: 'ABERTA' },
      { id: 'rOIT', bolaoId: 'b1', status: 'FECHADA' },
    ];

    const res = await advanceBracketComClient(fakeDb(jogos, rodadas));

    expect(res.slotsPreenchidos).toBe(2);
    expect(res.rodadasAbertas).toBe(1);
    const j90 = jogos.find((j) => j.id === 'j90')!;
    expect(j90.timeCasa).toBe('Brasil'); // vencedor de 73 (CASA)
    expect(j90.timeVisitante).toBe('Gana'); // vencedor de 75 (VISITANTE)
    expect(rodadas.find((r) => r.id === 'rOIT')!.status).toBe('ABERTA');
  });

  it('é idempotente — não sobrescreve time já real e não reabre rodada', async () => {
    const jogos: JogoFix[] = [
      {
        id: 'j73', apiJogoId: 'WC2026_R32_73', bolaoId: 'b1', rodadaId: 'rR32', fase: 'R32',
        status: 'FINALIZADO', classificadoLado: 'CASA', timeCasa: 'Brasil', timeVisitante: 'Chile',
        proximoJogoApiId: 'WC2026_OIT_90', proximoSlot: 'CASA',
      },
      {
        id: 'j90', apiJogoId: 'WC2026_OIT_90', bolaoId: 'b1', rodadaId: 'rOIT', fase: 'OITAVAS',
        status: 'AGENDADO', classificadoLado: null, timeCasa: 'Brasil', timeVisitante: 'Gana',
        proximoJogoApiId: 'WC2026_QUA_97', proximoSlot: 'VISITANTE',
      },
    ];
    const rodadas: RodadaFix[] = [
      { id: 'rR32', bolaoId: 'b1', status: 'ABERTA' },
      { id: 'rOIT', bolaoId: 'b1', status: 'ABERTA' },
    ];

    const res = await advanceBracketComClient(fakeDb(jogos, rodadas));
    expect(res.slotsPreenchidos).toBe(0); // slot CASA já era "Brasil" (real)
    expect(res.rodadasAbertas).toBe(0);
  });

  it('perdedor das semis vai pra disputa de 3º lugar', async () => {
    // Semi 101 → vencedor FIN104:CASA, perdedor TER103:CASA.
    const jogos: JogoFix[] = [
      {
        id: 'j101', apiJogoId: 'WC2026_SEMI_101', bolaoId: 'b1', rodadaId: 'rSEMI', fase: 'SEMI',
        status: 'FINALIZADO', classificadoLado: 'CASA', timeCasa: 'Brasil', timeVisitante: 'Argentina',
        proximoJogoApiId: 'WC2026_FIN_104', proximoSlot: 'CASA',
      },
      {
        id: 'j103', apiJogoId: 'WC2026_TER_103', bolaoId: 'b1', rodadaId: 'rTER', fase: 'TERCEIRO',
        status: 'AGENDADO', classificadoLado: null, timeCasa: 'Perdedor 101', timeVisitante: 'Perdedor 102',
        proximoJogoApiId: null, proximoSlot: null,
      },
      {
        id: 'j104', apiJogoId: 'WC2026_FIN_104', bolaoId: 'b1', rodadaId: 'rFIN', fase: 'FINAL',
        status: 'AGENDADO', classificadoLado: null, timeCasa: 'Vencedor 101', timeVisitante: 'Vencedor 102',
        proximoJogoApiId: null, proximoSlot: null,
      },
    ];
    const rodadas: RodadaFix[] = [
      { id: 'rSEMI', bolaoId: 'b1', status: 'ABERTA' },
      { id: 'rTER', bolaoId: 'b1', status: 'FECHADA' },
      { id: 'rFIN', bolaoId: 'b1', status: 'FECHADA' },
    ];

    await advanceBracketComClient(fakeDb(jogos, rodadas));
    expect(jogos.find((j) => j.id === 'j104')!.timeCasa).toBe('Brasil'); // vencedor → final
    expect(jogos.find((j) => j.id === 'j103')!.timeCasa).toBe('Argentina'); // perdedor → 3º lugar
  });
});
