import { describe, it, expect } from 'vitest';
import { montarBloco, montarMensagemRevelacao } from '../../src/utils/palpite-reveal.js';

/**
 * v3.24.0 — builder puro da revelação de palpites no kickoff.
 */

describe('montarBloco', () => {
  const participantes = [
    { id: 'u1', nome: 'Ana' },
    { id: 'u2', nome: 'Bruno' },
    { id: 'u3', nome: 'Carla' },
  ];

  it('palpiteiros primeiro, "Você" no topo, depois quem não palpitou (alfabético)', () => {
    const bloco = montarBloco({
      nomeBolao: 'Firma',
      timeCasa: 'Brasil',
      timeVisitante: 'Marrocos',
      participantes,
      palpites: [
        { usuarioId: 'u2', golsCasa: 1, golsVisitante: 0 },
        { usuarioId: 'u3', golsCasa: 2, golsVisitante: 2 },
      ],
      usuarioIdVoce: 'u3', // Carla é "Você"
    });
    // ordem: Você(Carla) → Bruno (palpiteiros), depois Ana (não palpitou)
    expect(bloco.linhas.map((l) => l.nome)).toEqual(['Carla', 'Bruno', 'Ana']);
    expect(bloco.linhas[0].ehVoce).toBe(true);
    expect(bloco.linhas[2].palpitou).toBe(false);
  });

  it('marca não palpitou quando não há PalpiteJogo', () => {
    const bloco = montarBloco({
      nomeBolao: 'X',
      timeCasa: 'A',
      timeVisitante: 'B',
      participantes,
      palpites: [{ usuarioId: 'u1', golsCasa: 0, golsVisitante: 0 }],
      usuarioIdVoce: 'u1',
    });
    const ana = bloco.linhas.find((l) => l.nome === 'Ana')!;
    const bruno = bloco.linhas.find((l) => l.nome === 'Bruno')!;
    expect(ana.palpitou).toBe(true); // 0×0 é palpite válido
    expect(bruno.palpitou).toBe(false);
  });

  it('placar parcial null (golsCasa null) conta como não palpitou', () => {
    const bloco = montarBloco({
      nomeBolao: 'X',
      timeCasa: 'A',
      timeVisitante: 'B',
      participantes: [{ id: 'u1', nome: 'Ana' }],
      palpites: [{ usuarioId: 'u1', golsCasa: null, golsVisitante: 2 }],
      usuarioIdVoce: 'u1',
    });
    expect(bloco.linhas[0].palpitou).toBe(false);
  });
});

describe('montarMensagemRevelacao', () => {
  it('renderiza bloco com "Você", placar e "não palpitou"', () => {
    const msg = montarMensagemRevelacao([
      montarBloco({
        nomeBolao: 'Firma',
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [
          { id: 'u1', nome: 'Ana' },
          { id: 'u2', nome: 'Bruno' },
        ],
        palpites: [{ usuarioId: 'u1', golsCasa: 2, golsVisitante: 1 }],
        usuarioIdVoce: 'u1',
      }),
    ]);
    expect(msg).toContain('🏆 *Firma* — Brasil x Marrocos');
    expect(msg).toContain('• Você: *2×1*');
    expect(msg).toContain('• Bruno: _não palpitou_');
  });

  it('multi-bolão: um bloco por bolão, separados', () => {
    const mk = (nomeBolao: string, gols: number) =>
      montarBloco({
        nomeBolao,
        timeCasa: 'Brasil',
        timeVisitante: 'Marrocos',
        participantes: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }],
        palpites: [
          { usuarioId: 'u1', golsCasa: gols, golsVisitante: 0 },
          { usuarioId: 'u2', golsCasa: 1, golsVisitante: 1 },
        ],
        usuarioIdVoce: 'u1',
      });
    const msg = montarMensagemRevelacao([mk('Firma', 2), mk('Amigos', 3)]);
    expect(msg).toContain('🏆 *Firma* — Brasil x Marrocos');
    expect(msg).toContain('🏆 *Amigos* — Brasil x Marrocos');
    // dois blocos distintos
    expect(msg.match(/🏆/g)?.length).toBe(2);
  });
});
