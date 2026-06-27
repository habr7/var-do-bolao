import { describe, it, expect, vi } from 'vitest';

// admin-classificado importa database/ranking/advance (→ env/redis). Mocka pra
// testar só as funções puras de parsing/resolução de lado.
vi.mock('../../src/config/database.js', () => ({ prisma: {} }));
vi.mock('../../src/config/env.js', () => ({ env: { OWNER_WHATSAPP_IDS: '' } }));
vi.mock('../../src/whatsapp/evolution.client.js', () => ({ sendText: vi.fn() }));
vi.mock('../../src/modules/ranking/ranking.service.js', () => ({
  calcularPontuacaoRodada: vi.fn(),
  recalcularRanking: vi.fn(),
}));
vi.mock('../../src/jobs/advance-bracket.job.js', () => ({ advanceBracketInterno: vi.fn() }));

const { parseClassificadoCmd, resolverLadoClassificado } = await import('../../src/whatsapp/admin-classificado.js');

describe('parseClassificadoCmd', () => {
  it('não é o comando → null', () => {
    expect(parseClassificadoCmd('oi tudo bem')).toBeNull();
    expect(parseClassificadoCmd('ranking')).toBeNull();
  });

  it('parseia apiJogoId + lado', () => {
    expect(parseClassificadoCmd('#CLASSIFICADO WC2026_R32_73 CASA')).toEqual({
      apiJogoId: 'WC2026_R32_73',
      ladoToken: 'CASA',
      penaltis: null,
    });
  });

  it('detecta o flag PENALTIS no fim', () => {
    expect(parseClassificadoCmd('#CLASSIFICADO WC2026_R32_73 Brasil PENALTIS')).toEqual({
      apiJogoId: 'WC2026_R32_73',
      ladoToken: 'Brasil',
      penaltis: true,
    });
  });

  it('nome com espaço vira o ladoToken inteiro', () => {
    expect(parseClassificadoCmd('#CLASSIFICADO WC2026_R32_73 Coreia do Sul')).toEqual({
      apiJogoId: 'WC2026_R32_73',
      ladoToken: 'Coreia do Sul',
      penaltis: null,
    });
  });

  it('faltando argumentos → sinaliza uso (apiJogoId/ladoToken vazios)', () => {
    expect(parseClassificadoCmd('#CLASSIFICADO')).toEqual({ apiJogoId: '', ladoToken: '', penaltis: null });
    expect(parseClassificadoCmd('#CLASSIFICADO WC2026_R32_73')).toEqual({ apiJogoId: '', ladoToken: '', penaltis: null });
  });
});

describe('resolverLadoClassificado', () => {
  const jogo = { timeCasa: 'Brasil', timeVisitante: 'Argentina' };
  it('aceita CASA/VISITANTE/1/2', () => {
    expect(resolverLadoClassificado('CASA', jogo)).toBe('CASA');
    expect(resolverLadoClassificado('visitante', jogo)).toBe('VISITANTE');
    expect(resolverLadoClassificado('1', jogo)).toBe('CASA');
    expect(resolverLadoClassificado('2', jogo)).toBe('VISITANTE');
  });
  it('aceita o nome do time', () => {
    expect(resolverLadoClassificado('Brasil', jogo)).toBe('CASA');
    expect(resolverLadoClassificado('Argentina', jogo)).toBe('VISITANTE');
  });
  it('ambíguo/desconhecido → null', () => {
    expect(resolverLadoClassificado('Chile', jogo)).toBeNull();
  });
});
