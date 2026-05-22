import { describe, it, expect } from 'vitest';
import {
  getComposicaoGrupo,
  getDataFinal,
  getDataInicio,
  getEstadio,
  getEstadios,
  getGrupoDoTime,
  getJogosDoGrupo,
  getJogosDoTime,
  getJogosNaData,
  getMataMata,
  getProximosJogosDoTime,
  getSedes,
  getTime,
  getTimes,
  metadata,
  normalizarNomeTime,
} from '../../src/modules/copa-2026/index.js';

describe('módulo copa-2026 — dados oficiais', () => {
  it('tem 48 seleções distribuídas em 12 grupos', () => {
    const times = getTimes();
    expect(times).toHaveLength(48);
    const grupos = new Set(times.map((t) => t.grupo));
    expect(grupos.size).toBe(12);
  });

  it('cada grupo tem exatamente 4 seleções', () => {
    for (const letra of 'ABCDEFGHIJKL'.split('')) {
      const g = getComposicaoGrupo(letra);
      expect(g.length, `Grupo ${letra}`).toBe(4);
    }
  });

  it('cada grupo tem 6 jogos na fase de grupos', () => {
    for (const letra of 'ABCDEFGHIJKL'.split('')) {
      const jogos = getJogosDoGrupo(letra);
      expect(jogos.length, `Grupo ${letra}`).toBe(6);
    }
  });

  it('Inglaterra está no Grupo L com Croácia, Gana e Panamá (sorteio 05/12/2025)', () => {
    expect(getGrupoDoTime('Inglaterra')).toBe('L');
    const adversarios = getComposicaoGrupo('L')
      .filter((t) => t.nome !== 'Inglaterra')
      .map((t) => t.nome)
      .sort();
    expect(adversarios).toEqual(['Croácia', 'Gana', 'Panamá']);
  });

  it('Brasil está no Grupo C com Marrocos, Haiti e Escócia', () => {
    expect(getGrupoDoTime('Brasil')).toBe('C');
    const adversarios = getComposicaoGrupo('C')
      .filter((t) => t.nome !== 'Brasil')
      .map((t) => t.nome)
      .sort();
    expect(adversarios).toEqual(['Escócia', 'Haiti', 'Marrocos']);
  });

  it('Estados Unidos está no Grupo D (NÃO Grupo C)', () => {
    expect(getGrupoDoTime('Estados Unidos')).toBe('D');
    expect(getGrupoDoTime('EUA')).toBe('D');
    expect(getGrupoDoTime('USA')).toBe('D');
  });

  it('Argentina no Grupo J, França no I, Espanha no H, Portugal no K', () => {
    expect(getGrupoDoTime('Argentina')).toBe('J');
    expect(getGrupoDoTime('França')).toBe('I');
    expect(getGrupoDoTime('Espanha')).toBe('H');
    expect(getGrupoDoTime('Portugal')).toBe('K');
  });

  it('a Copa abre em 11/06/2026 (México x África do Sul) e termina em 19/07/2026 (final)', () => {
    expect(getDataInicio().slice(0, 10)).toBe('2026-06-11');
    expect(getDataFinal().slice(0, 10)).toBe('2026-07-19');
  });

  it('total de 104 jogos: 72 fase de grupos + 32 mata-mata', () => {
    const grupos = 'ABCDEFGHIJKL'.split('').flatMap((l) => getJogosDoGrupo(l));
    expect(grupos.length).toBe(72);
    const mataMata = getMataMata();
    expect(mataMata.length).toBe(32);
  });

  it('possui 16 estádios em 3 países (Canadá, EUA, México)', () => {
    expect(getEstadios()).toHaveLength(16);
    const sedes = getSedes();
    expect(Object.keys(sedes).sort()).toEqual(['Canadá', 'Estados Unidos', 'México']);
  });

  it('metadados apontam pra fonte openfootball', () => {
    const m = metadata();
    expect(m.fonte).toContain('openfootball');
    expect(m.atualizadoEm).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});

describe('normalizarNomeTime', () => {
  it('aceita variações de caso/acento/idioma', () => {
    expect(normalizarNomeTime('Inglaterra')).toBe('Inglaterra');
    expect(normalizarNomeTime('inglaterra')).toBe('Inglaterra');
    expect(normalizarNomeTime('INGLATERRA')).toBe('Inglaterra');
    expect(normalizarNomeTime('England')).toBe('Inglaterra');
    expect(normalizarNomeTime('Brasil')).toBe('Brasil');
    expect(normalizarNomeTime('brasil')).toBe('Brasil');
    expect(normalizarNomeTime('Brazil')).toBe('Brasil');
    expect(normalizarNomeTime('México')).toBe('México');
    expect(normalizarNomeTime('mexico')).toBe('México');
  });

  it('resolve apelidos/sinônimos comuns em PT-BR', () => {
    expect(normalizarNomeTime('EUA')).toBe('Estados Unidos');
    expect(normalizarNomeTime('eua')).toBe('Estados Unidos');
    expect(normalizarNomeTime('USA')).toBe('Estados Unidos');
    expect(normalizarNomeTime('canarinha')).toBe('Brasil');
    expect(normalizarNomeTime('albiceleste')).toBe('Argentina');
    expect(normalizarNomeTime('seleção brasileira')).toBe('Brasil');
    expect(normalizarNomeTime('coreia do sul')).toBe('Coreia do Sul');
  });

  it('aceita código FIFA', () => {
    expect(normalizarNomeTime('BRA')).toBe('Brasil');
    expect(normalizarNomeTime('eng')).toBe('Inglaterra');
    expect(normalizarNomeTime('USA')).toBe('Estados Unidos');
  });

  it('retorna null para coisa não-time', () => {
    expect(normalizarNomeTime('xpto')).toBeNull();
    expect(normalizarNomeTime('')).toBeNull();
    expect(normalizarNomeTime('lalala')).toBeNull();
  });

  it('match por substring escolhe o nome mais longo', () => {
    // "coreia" sem "do sul" — mesmo assim resolve via alias
    expect(normalizarNomeTime('coreia')).toBe('Coreia do Sul');
  });
});

describe('getProximosJogosDoTime', () => {
  it('retorna os 3 jogos da fase de grupos da Inglaterra (referência: hoje)', () => {
    const jogos = getProximosJogosDoTime('Inglaterra', 3, new Date('2026-06-01T00:00:00-03:00'));
    expect(jogos.length).toBe(3);
    // Adversários da fase de grupos esperados
    const adversarios = jogos.map((j) =>
      j.timeCasa === 'Inglaterra' ? j.timeVisitante : j.timeCasa,
    );
    expect(adversarios.sort()).toEqual(['Croácia', 'Gana', 'Panamá']);
  });

  it('retorna [] após o fim da Copa', () => {
    const jogos = getProximosJogosDoTime('Inglaterra', 3, new Date('2026-08-01T00:00:00-03:00'));
    expect(jogos).toEqual([]);
  });

  it('usa o nome canônico mesmo quando consultado por alias', () => {
    const a = getProximosJogosDoTime('EUA', 3, new Date('2026-06-01T00:00:00-03:00'));
    const b = getProximosJogosDoTime('Estados Unidos', 3, new Date('2026-06-01T00:00:00-03:00'));
    expect(a).toEqual(b);
  });
});

describe('getTime / getEstadio / getJogosNaData', () => {
  it('getTime preenche bandeira, código FIFA e confederação', () => {
    const t = getTime('Brasil');
    expect(t).not.toBeNull();
    expect(t!.fifaCode).toBe('BRA');
    expect(t!.confederacao).toBe('CONMEBOL');
    expect(t!.bandeira).toBe('🇧🇷');
  });

  it('getEstadio acha por nome ou cidade', () => {
    const e1 = getEstadio('MetLife');
    expect(e1?.cidade).toContain('New York');
    const e2 = getEstadio('Mexico City');
    expect(e2).not.toBeNull();
  });

  it('getJogosNaData retorna os jogos do dia 11/06/2026 (abertura)', () => {
    const jogos = getJogosNaData('2026-06-11');
    expect(jogos.length).toBeGreaterThan(0);
    expect(jogos[0].grupo).toBe('A');
  });
});

describe('getJogosDoTime — inclui mata-mata quando time aparece com nome', () => {
  it('Inglaterra na fase de grupos tem 3 jogos (mata-mata ainda é placeholder)', () => {
    const jogos = getJogosDoTime('Inglaterra');
    // Após a fase de grupos, slots de mata-mata são "1L", "2L", etc — não
    // têm o nome literal "Inglaterra", então não aparecem aqui.
    expect(jogos.length).toBe(3);
    jogos.forEach((j) => expect(j.fase).toBe('FASE_GRUPOS'));
  });
});
