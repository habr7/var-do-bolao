import { describe, it, expect } from 'vitest';
import { sincronizarMataMata } from '../../src/modules/resultado/mata-mata.sync.service.js';
import type { FixtureMataMata } from '../../src/modules/resultado/fifa.fetcher.js';

/**
 * Sync dos jogos de mata-mata a partir dos fixtures da FIFA, com um prisma em
 * memória. Cobre: criação das rodadas/jogos, preenchimento de times reais +
 * placeholder, abertura da rodada, trava após abrir, e reset de cálculo quando
 * o resultado muda.
 */
function fakeDb() {
  const boloes = [{ id: 'b1', status: 'ATIVO' }];
  const rodadas: any[] = [];
  const jogos: any[] = [];
  let seqR = 0;
  let seqJ = 0;
  const palpiteUpdateMany: any[] = [];

  const db: any = {
    bolao: { findMany: async ({ where }: any) => boloes.filter((b) => !where?.status || b.status === where.status) },
    rodada: {
      findMany: async ({ where }: any) => rodadas.filter((r) => r.bolaoId === where.bolaoId),
      create: async ({ data }: any) => {
        const r = { id: `r${++seqR}`, ...data };
        rodadas.push(r);
        return r;
      },
      update: async ({ where, data }: any) => {
        const r = rodadas.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
    jogo: {
      findUnique: async ({ where }: any) => {
        const { rodadaId, apiJogoId } = where.rodadaId_apiJogoId;
        return jogos.find((j) => j.rodadaId === rodadaId && j.apiJogoId === apiJogoId) ?? null;
      },
      findMany: async ({ where }: any) => jogos.filter((j) => j.rodadaId === where.rodadaId),
      create: async ({ data }: any) => {
        const j = { id: `j${++seqJ}`, ...data };
        jogos.push(j);
        return j;
      },
      update: async ({ where, data }: any) => {
        const j = jogos.find((x) => x.id === where.id)!;
        Object.assign(j, data);
        return j;
      },
    },
    palpite: {
      updateMany: async (arg: any) => {
        palpiteUpdateMany.push(arg);
        return { count: 1 };
      },
    },
  };
  return { db, rodadas, jogos, palpiteUpdateMany };
}

const mk = (over: Partial<FixtureMataMata>): FixtureMataMata => ({
  numero: 73,
  apiJogoId: 'WC2026_R32_73',
  fase: 'R32',
  dataHoraUtc: new Date('2026-06-28T19:00:00Z'),
  timeCasa: 'Brasil',
  timeVisitante: 'Japão',
  status: 'AGENDADO',
  golsCasa: null,
  golsVisitante: null,
  classificadoLado: null,
  decididoNosPenaltis: null,
  ...over,
});

describe('sincronizarMataMata', () => {
  it('cria as 6 rodadas + jogos; R32 com times reais abre, oitava placeholder fica fechada', async () => {
    const { db, rodadas, jogos } = fakeDb();
    const fixtures = [
      mk({}), // R32 73 Brasil x Japão (real)
      mk({ numero: 90, apiJogoId: 'WC2026_OIT_90', fase: 'OITAVAS', timeCasa: null, timeVisitante: null }),
    ];
    const r = await sincronizarMataMata(db, fixtures);

    expect(rodadas).toHaveLength(6); // R32..FINAL
    const r32 = rodadas.find((x) => x.fase === 'R32')!;
    const oit = rodadas.find((x) => x.fase === 'OITAVAS')!;
    expect(r32.status).toBe('ABERTA'); // tem jogo real
    expect(oit.status).toBe('FECHADA'); // placeholder
    const j73 = jogos.find((j) => j.apiJogoId === 'WC2026_R32_73')!;
    expect(j73).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Japão', fase: 'R32' });
    const j90 = jogos.find((j) => j.apiJogoId === 'WC2026_OIT_90')!;
    expect(j90.timeCasa).toBe('Vencedor 73'); // placeholder do alimentador
    expect(j90.proximoJogoApiId).toBe('WC2026_QUA_97');
    expect(r.rodadasAbertas).toBe(1);
  });

  it('resultado FINALIZADO muda placar/classificado → reseta cálculo e marca o bolão', async () => {
    const { db, palpiteUpdateMany } = fakeDb();
    await sincronizarMataMata(db, [mk({})]); // cria
    const r = await sincronizarMataMata(db, [
      mk({ status: 'FINALIZADO', golsCasa: 2, golsVisitante: 0, classificadoLado: 'CASA' }),
    ]);
    expect(r.bolaoIds).toEqual(['b1']);
    expect(palpiteUpdateMany.length).toBeGreaterThan(0); // reset calculado
  });

  it('trava: depois da rodada ABERTA, não sobrescreve um time real que mudou na API', async () => {
    const { db, jogos } = fakeDb();
    await sincronizarMataMata(db, [mk({})]); // R32 abre com Brasil x Japão
    // API "corrige" pra outro time — mas a rodada já abriu → mantém o original
    await sincronizarMataMata(db, [mk({ timeCasa: 'Argentina' })]);
    const j73 = jogos.find((j) => j.apiJogoId === 'WC2026_R32_73')!;
    expect(j73.timeCasa).toBe('Brasil'); // travado
  });

  it('corrige o time enquanto a rodada está FECHADA (oitava placeholder → real)', async () => {
    const { db, jogos, rodadas } = fakeDb();
    // oitava sem R32 real → fica FECHADA com placeholder
    await sincronizarMataMata(db, [
      mk({ numero: 90, apiJogoId: 'WC2026_OIT_90', fase: 'OITAVAS', timeCasa: null, timeVisitante: null }),
    ]);
    expect(rodadas.find((r) => r.fase === 'OITAVAS')!.status).toBe('FECHADA');
    // depois a FIFA define os times da oitava → preenche (ainda fechada)
    await sincronizarMataMata(db, [
      mk({ numero: 90, apiJogoId: 'WC2026_OIT_90', fase: 'OITAVAS', timeCasa: 'Brasil', timeVisitante: 'França' }),
    ]);
    const j90 = jogos.find((j) => j.apiJogoId === 'WC2026_OIT_90')!;
    expect(j90).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'França' });
    expect(rodadas.find((r) => r.fase === 'OITAVAS')!.status).toBe('ABERTA'); // agora abre
  });
});
