import { describe, it, expect } from 'vitest';
import { ehTimeReal, parsearR32 } from '../../scripts/seed-mata-mata.js';

/**
 * Trava o parse/validação do bloco de dados do seed do R32 (transcrição que o
 * dono preenche à noite). O seed em si grava no banco — aqui só as funções
 * puras (sem DB): detecção de time real, portão e conversão de fuso.
 */
describe('ehTimeReal', () => {
  it('placeholders não são reais', () => {
    expect(ehTimeReal('?')).toBe(false);
    expect(ehTimeReal('')).toBe(false);
    expect(ehTimeReal('A definir')).toBe(false);
    expect(ehTimeReal('Vencedor 73')).toBe(false);
    expect(ehTimeReal('Perdedor 101')).toBe(false);
  });
  it('seleções reais são reais', () => {
    expect(ehTimeReal('Brasil')).toBe(true);
    expect(ehTimeReal('África do Sul')).toBe(true);
    expect(ehTimeReal('Coreia do Sul')).toBe(true);
  });
});

function linhasValidas(): string[] {
  // 16 confrontos reais (73–88) com sede + data/hora local válidos.
  const sedes = [
    'Los Angeles', 'Houston', 'Boston', 'Mexico City', 'Dallas', 'Atlanta',
    'Los Angeles', 'Vancouver', 'Seattle', 'Monterrey', 'Toronto', 'Philadelphia',
    'Kansas City', 'Miami', 'San Francisco (Santa Clara)', 'Toronto',
  ];
  return Array.from({ length: 16 }, (_, i) => {
    const n = 73 + i;
    return `${n} | Time${n}A x Time${n}B | 2026-06-28 | 16:00 | ${sedes[i]}`;
  });
}

describe('parsearR32', () => {
  it('parseia 16 confrontos reais e marca todos timesReais', () => {
    const r = parsearR32(linhasValidas());
    expect(r).toHaveLength(16);
    expect(r.every((c) => c.timesReais)).toBe(true);
    expect(r[0].apiJogoId).toBe('WC2026_R32_73');
    expect(r.at(-1)!.apiJogoId).toBe('WC2026_R32_88');
  });

  it('converte horário local da sede pra UTC (LA 16:00 PDT → 23:00 UTC)', () => {
    const r = parsearR32(linhasValidas());
    const j73 = r.find((c) => c.numero === 73)!;
    expect(j73.iana).toBe('America/Los_Angeles');
    expect(j73.dataHoraUtc.toISOString()).toBe('2026-06-28T23:00:00.000Z');
  });

  it('linhas com "?" viram placeholder (não-reais → portão fecharia)', () => {
    const linhas = linhasValidas();
    linhas[0] = '73 | ? x ? | 2026-06-28 | 16:00 | Los Angeles';
    const r = parsearR32(linhas);
    const j73 = r.find((c) => c.numero === 73)!;
    expect(j73.timesReais).toBe(false);
    expect(j73.timeCasa).toBe('A definir');
    expect(r.every((c) => c.timesReais)).toBe(false); // portão fechado
  });

  it('ignora linhas em branco e comentários', () => {
    const linhas = ['# cabeçalho', '', ...linhasValidas()];
    expect(parsearR32(linhas)).toHaveLength(16);
  });

  it('erro se faltar jogo', () => {
    const linhas = linhasValidas().slice(0, 15);
    expect(() => parsearR32(linhas)).toThrow(/Faltam os jogos: 88/);
  });

  it('erro se sede não reconhecida', () => {
    const linhas = linhasValidas();
    linhas[0] = '73 | Brasil x Chile | 2026-06-28 | 16:00 | Curitiba';
    expect(() => parsearR32(linhas)).toThrow(/sede "Curitiba" não reconhecida/);
  });

  it('erro se número fora de 73–88', () => {
    const linhas = linhasValidas();
    linhas[0] = '99 | Brasil x Chile | 2026-06-28 | 16:00 | Miami';
    expect(() => parsearR32(linhas)).toThrow(/fora de 73–88/);
  });

  it('erro se a data/hora estiver malformada', () => {
    const linhas = linhasValidas();
    linhas[0] = '73 | Brasil x Chile | 28-06-2026 | 16:00 | Miami';
    expect(() => parsearR32(linhas)).toThrow();
  });
});
