import { describe, it, expect } from 'vitest';
import { timeCorresponde } from '../../src/utils/validators.js';
import { montarStatusResultado } from '../../src/whatsapp/palpite-render.js';
import { montarBloco, montarMensagemRevelacao } from '../../src/utils/palpite-reveal.js';

/**
 * Guards do hardening do mata-mata (funções puras): matching rejeita placeholder,
 * status mostra pênaltis + bônus, revelação mostra o classificado cravado.
 */
describe('timeCorresponde — rejeita placeholder', () => {
  it('não casa nome real com "Vencedor 73"', () => {
    expect(timeCorresponde('Brasil', 'Vencedor 73')).toBe(false);
    expect(timeCorresponde('Vencedor 73', 'Vencedor 73')).toBe(false);
    expect(timeCorresponde('Perdedor 101', 'Perdedor 101')).toBe(false);
  });
  it('continua casando times reais', () => {
    expect(timeCorresponde('Brasil', 'Brasil')).toBe(true);
    expect(timeCorresponde('Coreia', 'Coreia do Sul')).toBe(true);
  });
});

describe('montarStatusResultado — pênaltis + bônus', () => {
  const base = { status: 'FINALIZADO', golsCasa: 1, golsVisitante: 1, dataHora: new Date('2026-06-28T20:00:00Z') };

  it('mostra "(nos pênaltis)" quando decididoNosPenaltis', () => {
    const out = montarStatusResultado({ ...base, decididoNosPenaltis: true }, 10, true);
    expect(out).toContain('nos pênaltis');
  });

  it('mostra placar + bônus quando bonusObtido > 0', () => {
    const out = montarStatusResultado({ ...base, decididoNosPenaltis: true }, 10, true, new Date(), 3);
    expect(out).toContain('10+3 bônus = 13');
  });

  it('grupos (sem pênaltis, sem bônus) mantém o formato antigo', () => {
    const out = montarStatusResultado(base, 7, true);
    expect(out).toContain('(7 pts)');
    expect(out).not.toContain('pênaltis');
    expect(out).not.toContain('bônus');
  });
});

describe('revelação — classificado cravado no empate', () => {
  it('mostra "acha que X passa" só no empate com classificado', () => {
    const bloco = montarBloco({
      nomeBolao: 'Bolão',
      timeCasa: 'Brasil',
      timeVisitante: 'Argentina',
      participantes: [
        { id: 'u1', nome: 'Ana' },
        { id: 'u2', nome: 'Bia' },
      ],
      palpites: [
        { usuarioId: 'u1', golsCasa: 1, golsVisitante: 1, classificadoPalpite: 'CASA' },
        { usuarioId: 'u2', golsCasa: 2, golsVisitante: 1, classificadoPalpite: null },
      ],
      usuarioIdVoce: 'u1',
    });
    const msg = montarMensagemRevelacao([bloco]);
    expect(msg).toContain('acha que Brasil passa'); // u1: empate 1x1 + CASA
    // u2 não é empate (2x1) → não mostra classificado mesmo se tivesse
    expect(msg).not.toContain('acha que Argentina passa');
  });
});
