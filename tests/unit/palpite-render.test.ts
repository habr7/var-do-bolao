import { describe, it, expect } from 'vitest';
import {
  montarStatusResultado,
  ladoClassificadoImplicito,
  linhaClassificadoMeusPalpites,
} from '../../src/whatsapp/palpite-render.js';

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

describe('classificado no "meus palpites" (mata-mata)', () => {
  const J = (over: Partial<{ fase: string; timeCasa: string; timeVisitante: string; status: string; classificadoLado: 'CASA' | 'VISITANTE' | null }> = {}) => ({
    fase: 'R32', timeCasa: 'Brasil', timeVisitante: 'Japão', status: 'AGENDADO', classificadoLado: null, ...over,
  });

  it('lado implícito: empate usa a crava; decisivo usa o vencedor pelo placar', () => {
    expect(ladoClassificadoImplicito({ golsCasa: 1, golsVisitante: 1, classificadoPalpite: 'VISITANTE' })).toBe('VISITANTE');
    expect(ladoClassificadoImplicito({ golsCasa: 1, golsVisitante: 1, classificadoPalpite: null })).toBe(null);
    expect(ladoClassificadoImplicito({ golsCasa: 2, golsVisitante: 1 })).toBe('CASA');
    // dado órfão: decisivo IGNORA classificadoPalpite antigo
    expect(ladoClassificadoImplicito({ golsCasa: 1, golsVisitante: 2, classificadoPalpite: 'CASA' })).toBe('VISITANTE');
  });

  it('grupos não mostra nada', () => {
    expect(linhaClassificadoMeusPalpites(J({ fase: 'GRUPOS' }), { golsCasa: 1, golsVisitante: 1 })).toBe('');
  });

  it('empate sem crava → avisa que falta escolher', () => {
    expect(linhaClassificadoMeusPalpites(J(), { golsCasa: 1, golsVisitante: 1, classificadoPalpite: null }))
      .toContain('falta dizer quem passa');
  });

  it('empate com crava (não encerrado) → mostra a escolha', () => {
    expect(linhaClassificadoMeusPalpites(J(), { golsCasa: 1, golsVisitante: 1, classificadoPalpite: 'CASA' }))
      .toContain('você acha que Brasil passa');
  });

  it('decisivo não encerrado → não polui (placar já diz)', () => {
    expect(linhaClassificadoMeusPalpites(J(), { golsCasa: 2, golsVisitante: 1 })).toBe('');
  });

  it('encerrado: ACERTOU quem passa (decisivo)', () => {
    const s = linhaClassificadoMeusPalpites(J({ status: 'FINALIZADO', classificadoLado: 'CASA' }), { golsCasa: 2, golsVisitante: 1 });
    expect(s).toContain('Brasil');
    expect(s).toContain('✅');
  });

  it('encerrado: ERROU quem passa (órfão não engana) — achou Brasil, passou Japão', () => {
    // palpite decisivo 1x2 (Japão vence) mas dado órfão classificadoPalpite=CASA;
    // real: Brasil passou (nos pênaltis). Deve dizer "achou Japão, passou Brasil ❌".
    const s = linhaClassificadoMeusPalpites(
      J({ status: 'FINALIZADO', classificadoLado: 'CASA' }),
      { golsCasa: 1, golsVisitante: 2, classificadoPalpite: 'CASA' },
    );
    expect(s).toContain('você achou Japão');
    expect(s).toContain('passou Brasil');
    expect(s).toContain('❌');
  });

  it('encerrado: empate cravado ACERTOU', () => {
    const s = linhaClassificadoMeusPalpites(
      J({ status: 'FINALIZADO', classificadoLado: 'VISITANTE' }),
      { golsCasa: 1, golsVisitante: 1, classificadoPalpite: 'VISITANTE' },
    );
    expect(s).toContain('Japão');
    expect(s).toContain('✅');
  });
});
