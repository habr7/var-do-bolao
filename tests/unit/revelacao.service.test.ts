import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * v3.24.0 — revelacoesParaUsuario (sob demanda). Garante o escopo e os
 * skips: filtro por time, bolão solo (<2) ignorado, jogo sem palpite
 * ignorado.
 */

const findMany = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: { jogo: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import { revelacoesParaUsuario } from '../../src/modules/palpite/revelacao.service.js';

function jogo(opts: {
  apiJogoId?: string;
  timeCasa: string;
  timeVisitante: string;
  nomeBolao?: string;
  participantes: Array<{ id: string; nome: string }>;
  palpites: Array<{ usuarioId: string; golsCasa: number | null; golsVisitante: number | null }>;
}) {
  return {
    apiJogoId: opts.apiJogoId ?? 'WC2026_A_1',
    timeCasa: opts.timeCasa,
    timeVisitante: opts.timeVisitante,
    rodada: {
      bolao: {
        nome: opts.nomeBolao ?? 'Firma',
        participacoes: opts.participantes.map((p) => ({
          usuario: { id: p.id, nome: p.nome, whatsappId: `wa-${p.id}` },
        })),
      },
    },
    palpitesJogo: opts.palpites.map((p) => ({
      golsCasa: p.golsCasa,
      golsVisitante: p.golsVisitante,
      palpite: { usuarioId: p.usuarioId },
    })),
  };
}

beforeEach(() => findMany.mockReset());

describe('revelacoesParaUsuario', () => {
  it('revela jogo iniciado com >=2 participantes e palpite', async () => {
    findMany.mockResolvedValue([
      jogo({
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }],
        palpites: [{ usuarioId: 'u1', golsCasa: 2, golsVisitante: 1 }],
      }),
    ]);
    const blocos = await revelacoesParaUsuario('u1');
    expect(blocos).toHaveLength(1);
    expect(blocos[0].nomeBolao).toBe('Firma');
    expect(blocos[0].linhas.find((l) => l.nome === 'Ana')!.ehVoce).toBe(true);
  });

  it('ignora bolão solo (<2 participantes)', async () => {
    findMany.mockResolvedValue([
      jogo({
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [{ id: 'u1', nome: 'Ana' }],
        palpites: [{ usuarioId: 'u1', golsCasa: 1, golsVisitante: 0 }],
      }),
    ]);
    expect(await revelacoesParaUsuario('u1')).toEqual([]);
  });

  it('ignora jogo sem nenhum palpite', async () => {
    findMany.mockResolvedValue([
      jogo({
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }],
        palpites: [],
      }),
    ]);
    expect(await revelacoesParaUsuario('u1')).toEqual([]);
  });

  it('filtra por time mencionado', async () => {
    findMany.mockResolvedValue([
      jogo({
        apiJogoId: 'J1',
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }],
        palpites: [{ usuarioId: 'u1', golsCasa: 2, golsVisitante: 1 }],
      }),
      jogo({
        apiJogoId: 'J2',
        timeCasa: 'Argentina',
        timeVisitante: 'Coreia do Sul',
        participantes: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }],
        palpites: [{ usuarioId: 'u1', golsCasa: 0, golsVisitante: 0 }],
      }),
    ]);
    const blocos = await revelacoesParaUsuario('u1', ['Argentina']);
    expect(blocos).toHaveLength(1);
    expect(blocos[0].timeCasa).toBe('Argentina');
  });

  describe('v3.27.0 — janela de busca (caso real 11/06: jogo finalizado e a regra de privacidade)', () => {
    it('SEM filtro de time: busca limitada às últimas 24h (gte presente)', async () => {
      findMany.mockResolvedValue([]);
      await revelacoesParaUsuario('u1');
      const where = (findMany.mock.calls[0][0] as { where: { dataHora: { lte?: Date; gte?: Date } } }).where;
      expect(where.dataHora.lte).toBeInstanceOf(Date);
      expect(where.dataHora.gte).toBeInstanceOf(Date);
    });

    it('COM filtro de time: busca QUALQUER jogo já iniciado (sem gte) — jogo finalizado é público pra sempre', async () => {
      findMany.mockResolvedValue([]);
      await revelacoesParaUsuario('u1', ['México']);
      const where = (findMany.mock.calls[0][0] as { where: { dataHora: { lte?: Date; gte?: Date } } }).where;
      expect(where.dataHora.lte).toBeInstanceOf(Date);
      expect(where.dataHora.gte).toBeUndefined();
    });
  });
});
