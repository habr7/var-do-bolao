import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.21.0 — testes do `registrarPalpiteEmRodada` cobrindo o bug R.
 * 11/06 16:25: trava por `rodada.dataFechamento` (setado como kickoff
 * do PRIMEIRO jogo) bloqueava palpites de TODOS os jogos futuros
 * após o 1º jogo da rodada começar. Pra Copa 2026 (1 rodada com 72
 * jogos em 15 dias), depois das 16:00 do dia 1, NENHUM palpite entrava
 * — nem os 71 jogos restantes.
 *
 * Mocka Prisma + repository pra testar só a lógica de validação.
 */

const prismaMock = {
  rodada: {
    findUnique: vi.fn(),
  },
  participacao: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../src/config/database.js', () => ({
  prisma: prismaMock,
}));

vi.mock('../../src/modules/palpite/palpite.repository.js', () => ({
  getOrCreatePalpite: vi.fn().mockResolvedValue({ id: 'palpite-id' }),
  registrarPalpiteJogo: vi.fn().mockResolvedValue(undefined),
  buscarPalpitesUsuarioRodada: vi.fn().mockResolvedValue(null),
}));

const { registrarPalpiteEmRodada } = await import('../../src/modules/palpite/palpite.service.js');

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.participacao.findUnique.mockResolvedValue({ id: 'part-id' });
});

// Helpers
const AGORA = new Date('2026-06-11T19:25:00.000Z'); // 16:25 BRT (cenário R.)
const KICKOFF_MEXICO = new Date('2026-06-11T19:00:00.000Z'); // 16:00 BRT — já começou
const KICKOFF_COREIA = new Date('2026-06-12T02:00:00.000Z'); // 23:00 BRT — ainda não
const KICKOFF_BRASIL = new Date('2026-06-13T22:00:00.000Z'); // 19:00 BRT, dia 13 — futuro

function rodadaComJogos(status: string, dataFechamento: Date, jogos: Array<{ timeCasa: string; timeVisitante: string; dataHora: Date; status?: string }>) {
  return {
    id: 'rod-1',
    bolaoId: 'bol-1',
    status,
    dataFechamento,
    bolao: { id: 'bol-1', nome: 'Bolão das Girls' },
    jogos: jogos.map((j, i) => ({
      id: `jogo-${i}`,
      ...j,
      status: j.status ?? 'AGENDADO',
    })),
  };
}

describe('registrarPalpiteEmRodada — v3.21.0 (bug R. 11/06 16:25)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AGORA);
  });

  it('CENÁRIO EXATO R.: rodada ABERTA + dataFechamento=16:00 (passado) + jogo das 23h → REGISTRA OK', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('ABERTA', KICKOFF_MEXICO, [
        { timeCasa: 'México', timeVisitante: 'África do Sul', dataHora: KICKOFF_MEXICO },
        { timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca', dataHora: KICKOFF_COREIA },
      ]),
    );
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'Coreia do Sul',
        timeVisitante: 'República Tcheca',
        golsCasa: 1,
        golsVisitante: 0,
      }),
    ).resolves.toBeDefined();
  });

  it('palpite pro México x África (já começou) → rejeita "ja comecou"', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('ABERTA', KICKOFF_MEXICO, [
        { timeCasa: 'México', timeVisitante: 'África do Sul', dataHora: KICKOFF_MEXICO },
      ]),
    );
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'México',
        timeVisitante: 'África do Sul',
        golsCasa: 2,
        golsVisitante: 0,
      }),
    ).rejects.toThrow(/ja comecou/);
  });

  it('rodada FINALIZADA → rejeita "rodada finalizada"', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('FINALIZADA', KICKOFF_MEXICO, [
        { timeCasa: 'Brasil', timeVisitante: 'Marrocos', dataHora: KICKOFF_BRASIL },
      ]),
    );
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        golsCasa: 2,
        golsVisitante: 1,
      }),
    ).rejects.toThrow(/rodada finalizada/);
  });

  it('rodada FECHADA (manual admin) + jogo futuro → REGISTRA OK (não bloqueia)', async () => {
    // FECHADA não bloqueia mais — só FINALIZADA bloqueia. Mantém
    // compatibilidade pra bolões antigos onde admin fechava manualmente
    // mas usuário pode ter feito palpite atrasado.
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('FECHADA', KICKOFF_MEXICO, [
        { timeCasa: 'Brasil', timeVisitante: 'Marrocos', dataHora: KICKOFF_BRASIL },
      ]),
    );
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        golsCasa: 2,
        golsVisitante: 1,
      }),
    ).resolves.toBeDefined();
  });

  it('rodada não existe → "Rodada nao encontrada"', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(null);
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-x',
        timeCasa: 'X',
        timeVisitante: 'Y',
        golsCasa: 1,
        golsVisitante: 0,
      }),
    ).rejects.toThrow(/Rodada nao encontrada/);
  });

  it('user não participa do bolão → "nao participa"', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('ABERTA', KICKOFF_BRASIL, [
        { timeCasa: 'Brasil', timeVisitante: 'Marrocos', dataHora: KICKOFF_BRASIL },
      ]),
    );
    prismaMock.participacao.findUnique.mockResolvedValue(null);
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        golsCasa: 2,
        golsVisitante: 1,
      }),
    ).rejects.toThrow(/nao participa/);
  });

  it('jogo não encontrado pelo nome → "jogo nao encontrado"', async () => {
    prismaMock.rodada.findUnique.mockResolvedValue(
      rodadaComJogos('ABERTA', KICKOFF_BRASIL, [
        { timeCasa: 'Brasil', timeVisitante: 'Marrocos', dataHora: KICKOFF_BRASIL },
      ]),
    );
    await expect(
      registrarPalpiteEmRodada({
        usuarioId: 'u1',
        rodadaId: 'rod-1',
        timeCasa: 'Time Inventado',
        timeVisitante: 'Outro Time',
        golsCasa: 1,
        golsVisitante: 0,
      }),
    ).rejects.toThrow(/jogo nao encontrado/);
  });
});
