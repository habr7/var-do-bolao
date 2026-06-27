import { describe, it, expect } from 'vitest';
import {
  JOGOS_MATA_MATA,
  BRACKET_2026,
  FASES_MATA_MATA,
  apiIdMataMata,
  ianaDaSede,
  type LadoJogo,
} from '../../src/data/bracket-2026.js';

/**
 * Trava a integridade da chave determinística (bracket-2026.ts): a numeração
 * FIFA, as ligações de avanço e o mapa Sede→IANA. Erro aqui = vencedor cai no
 * jogo/lado errado, ou o seed grava fuso errado.
 */
describe('bracket-2026 — descritores dos jogos', () => {
  it('tem exatamente os 32 jogos do mata-mata (73–104)', () => {
    expect(JOGOS_MATA_MATA).toHaveLength(32);
    expect(JOGOS_MATA_MATA[0].numero).toBe(73);
    expect(JOGOS_MATA_MATA.at(-1)!.numero).toBe(104);
  });

  it('monta o apiJogoId canônico por fase', () => {
    expect(apiIdMataMata(73)).toBe('WC2026_R32_73');
    expect(apiIdMataMata(88)).toBe('WC2026_R32_88');
    expect(apiIdMataMata(89)).toBe('WC2026_OIT_89');
    expect(apiIdMataMata(97)).toBe('WC2026_QUA_97');
    expect(apiIdMataMata(101)).toBe('WC2026_SEMI_101');
    expect(apiIdMataMata(103)).toBe('WC2026_TER_103');
    expect(apiIdMataMata(104)).toBe('WC2026_FIN_104');
  });

  it('classifica cada número na fase certa', () => {
    const fase = (n: number) => JOGOS_MATA_MATA.find((j) => j.numero === n)!.fase;
    expect(fase(73)).toBe('R32');
    expect(fase(89)).toBe('OITAVAS');
    expect(fase(97)).toBe('QUARTAS');
    expect(fase(101)).toBe('SEMI');
    expect(fase(103)).toBe('TERCEIRO');
    expect(fase(104)).toBe('FINAL');
  });

  it('FASES_MATA_MATA está na ordem do torneio', () => {
    expect(FASES_MATA_MATA).toEqual(['R32', 'OITAVAS', 'QUARTAS', 'SEMI', 'TERCEIRO', 'FINAL']);
  });
});

describe('bracket-2026 — ligações de avanço', () => {
  // Conta quantos vencedores caem em cada (jogoDestino, slot) — cada slot de
  // um jogo seguinte tem que ser alimentado por EXATAMENTE um jogo.
  function slotsPreenchidos() {
    const contagem = new Map<string, number>();
    for (const avanco of Object.values(BRACKET_2026)) {
      for (const lig of [avanco.vencedor, avanco.perdedor]) {
        if (!lig) continue;
        const chave = `${lig.proximoJogoApiId}:${lig.proximoSlot}`;
        contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
      }
    }
    return contagem;
  }

  it('todo jogo (menos 103 e 104) tem destino de vencedor; 103/104 são terminais', () => {
    for (const { numero, apiJogoId } of JOGOS_MATA_MATA) {
      const avanco = BRACKET_2026[apiJogoId];
      expect(avanco).toBeDefined();
      if (numero === 103 || numero === 104) {
        expect(avanco.vencedor).toBeUndefined();
      } else {
        expect(avanco.vencedor).toBeDefined();
      }
    }
  });

  it('cada slot de oitavas a final é alimentado por exatamente 1 jogo', () => {
    const contagem = slotsPreenchidos();
    // 8 oitavas (89–96) + 4 quartas (97–100) + 2 semis (101–102) + final (104) = 15 jogos
    // → 30 slots de vencedor + 2 slots do 3º lugar (perdedores das semis) = 32 slots
    expect([...contagem.values()].every((n) => n === 1)).toBe(true);
    expect(contagem.size).toBe(32);
  });

  it('R32→oitavas confirmados (amostra: 73→90:CASA, 74→89:CASA, 88→95:VIS)', () => {
    expect(BRACKET_2026['WC2026_R32_73'].vencedor).toEqual({
      proximoJogoApiId: 'WC2026_OIT_90',
      proximoSlot: 'CASA' as LadoJogo,
    });
    expect(BRACKET_2026['WC2026_R32_74'].vencedor).toEqual({
      proximoJogoApiId: 'WC2026_OIT_89',
      proximoSlot: 'CASA' as LadoJogo,
    });
    expect(BRACKET_2026['WC2026_R32_88'].vencedor).toEqual({
      proximoJogoApiId: 'WC2026_OIT_95',
      proximoSlot: 'VISITANTE' as LadoJogo,
    });
  });

  it('semis alimentam final (vencedor) E 3º lugar (perdedor)', () => {
    expect(BRACKET_2026['WC2026_SEMI_101'].vencedor).toEqual({
      proximoJogoApiId: 'WC2026_FIN_104',
      proximoSlot: 'CASA' as LadoJogo,
    });
    expect(BRACKET_2026['WC2026_SEMI_101'].perdedor).toEqual({
      proximoJogoApiId: 'WC2026_TER_103',
      proximoSlot: 'CASA' as LadoJogo,
    });
    expect(BRACKET_2026['WC2026_SEMI_102'].vencedor).toEqual({
      proximoJogoApiId: 'WC2026_FIN_104',
      proximoSlot: 'VISITANTE' as LadoJogo,
    });
    expect(BRACKET_2026['WC2026_SEMI_102'].perdedor).toEqual({
      proximoJogoApiId: 'WC2026_TER_103',
      proximoSlot: 'VISITANTE' as LadoJogo,
    });
  });
});

describe('bracket-2026 — Sede → IANA', () => {
  it('resolve sedes diretas (com acento/caixa variável)', () => {
    expect(ianaDaSede('Atlanta')).toBe('America/New_York');
    expect(ianaDaSede('Toronto')).toBe('America/New_York');
    expect(ianaDaSede('houston')).toBe('America/Chicago');
    expect(ianaDaSede('Seattle')).toBe('America/Los_Angeles');
    expect(ianaDaSede('Vancouver')).toBe('America/Los_Angeles');
    expect(ianaDaSede('Mexico City')).toBe('America/Mexico_City');
    expect(ianaDaSede('Monterrey')).toBe('America/Monterrey');
  });

  it('resolve sedes com sufixo entre parênteses', () => {
    expect(ianaDaSede('Los Angeles (Inglewood)')).toBe('America/Los_Angeles');
    expect(ianaDaSede('San Francisco (Santa Clara)')).toBe('America/Los_Angeles');
    expect(ianaDaSede('Dallas (Arlington)')).toBe('America/Chicago');
    expect(ianaDaSede('New York/New Jersey (East Rutherford)')).toBe('America/New_York');
  });

  it('retorna null para sede desconhecida', () => {
    expect(ianaDaSede('Curitiba')).toBeNull();
  });
});
