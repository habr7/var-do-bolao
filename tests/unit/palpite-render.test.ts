import { describe, it, expect } from 'vitest';
import { montarStatusResultado } from '../../src/whatsapp/palpite-render.js';

const agora = new Date('2026-06-12T03:00:00Z'); // 00:00 BRT

function jogo(status: string, gc: number | null, gv: number | null, minutosOffset = 60) {
  return {
    status,
    golsCasa: gc,
    golsVisitante: gv,
    dataHora: new Date(agora.getTime() + minutosOffset * 60_000),
  };
}

describe('montarStatusResultado (v3.33.0 — caso Humberto 12/06)', () => {
  it('FINALIZADO + calculado → oficial + emoji + pts', () => {
    const s = montarStatusResultado(jogo('FINALIZADO', 2, 0, -120), 7, true, agora);
    expect(s).toBe('oficial: *2x0* 🔥 (7 pts)');
  });

  it('FINALIZADO + ainda calculando → não mostra pts ainda', () => {
    const s = montarStatusResultado(jogo('FINALIZADO', 2, 0, -120), 0, false, agora);
    expect(s).toContain('oficial: *2x0*');
    expect(s).toContain('calculando');
    expect(s).not.toContain('pts)');
  });

  it('BUG CORRIGIDO: AO_VIVO com placar parcial NÃO vira "oficial 0 pts ❌"', () => {
    // Coreia 0x1 ao vivo, palpite do user ainda não pontuado (gate=0)
    const s = montarStatusResultado(jogo('AO_VIVO', 0, 1, -30), 0, true, agora);
    expect(s).toContain('ao vivo');
    expect(s).toContain('parcial 0x1');
    expect(s).toContain('apito final');
    // o que NÃO pode aparecer (a mentira antiga):
    expect(s).not.toContain('oficial');
    expect(s).not.toContain('0 pts');
    expect(s).not.toContain('❌');
  });

  it('AO_VIVO sem placar parcial → "ao vivo" sem placar', () => {
    const s = montarStatusResultado(jogo('AO_VIVO', null, null, -10), 0, true, agora);
    expect(s).toBe('🔴 _ao vivo — pontua no apito final_');
  });

  it('AGENDADO mas kickoff já passou (<2.5h) → tratado como ao vivo', () => {
    // status ainda AGENDADO (fallback openfootball não seta AO_VIVO)
    const s = montarStatusResultado(jogo('AGENDADO', 1, 0, -40), 0, true, agora);
    expect(s).toContain('ao vivo');
    expect(s).toContain('parcial 1x0');
    expect(s).not.toContain('oficial');
  });

  it('AGENDADO no futuro → "ainda não rolou (hora)"', () => {
    const s = montarStatusResultado(jogo('AGENDADO', null, null, 120), 0, false, agora);
    expect(s).toContain('ainda não rolou');
  });

  it('ADIADO / CANCELADO → rótulo próprio (não vira "oficial")', () => {
    expect(montarStatusResultado(jogo('ADIADO', null, null, 60), 0, false, agora)).toContain('adiado');
    expect(montarStatusResultado(jogo('CANCELADO', null, null, 60), 0, false, agora)).toContain('cancelado');
  });

  it('placar exato finalizado → 🎯 10 pts', () => {
    const s = montarStatusResultado(jogo('FINALIZADO', 2, 1, -120), 10, true, agora);
    expect(s).toBe('oficial: *2x1* 🎯 (10 pts)');
  });
});
