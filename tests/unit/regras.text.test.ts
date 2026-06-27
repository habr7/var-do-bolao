import { describe, it, expect } from 'vitest';
import { regrasTexto, regrasCompletas, regrasMataMata } from '../../src/whatsapp/regras.text.js';
import { TABELA_PONTOS, BONUS_CLASSIFICADO } from '../../src/modules/ranking/ranking.types.js';

/**
 * v3.13.0 — testes pro texto canônico de regras.
 *
 * Bug histórico: dizia "palpites travam quando o primeiro jogo da rodada
 * começa" — MENTIRA. Código (`palpite.service.ts:66`) trava cada jogo
 * no seu kickoff individual. Knowledge da LLM já estava correta. Texto
 * de regras era a única peça mentindo.
 */
describe('regrasTexto', () => {
  const texto = regrasTexto();
  const lower = texto.toLowerCase();

  describe('pontuação canônica 10/7/5/3/0', () => {
    it('cita 10 pts placar exato', () => {
      expect(texto).toContain('10 pts');
      expect(lower).toMatch(/placar exato/);
    });
    it('cita 7 pts vencedor + gols de um time', () => {
      expect(texto).toContain('7 pts');
    });
    it('cita 5 pts só vencedor', () => {
      expect(texto).toContain('5 pts');
    });
    it('cita 3 pts só gols com resultado errado', () => {
      expect(texto).toContain('3 pts');
    });
    it('cita 0 pts erro total', () => {
      expect(texto).toContain('0 pts');
    });
    it('explica que critérios NÃO acumulam', () => {
      expect(lower).toMatch(/n[ãa]o acumulam|melhor acerto/);
    });
  });

  describe('PRAZO DE PALPITE — v3.13.0 (caso pré-Copa)', () => {
    it('NÃO menciona mais "primeiro jogo da rodada" (texto antigo errado)', () => {
      expect(lower).not.toMatch(/primeiro jogo da rodada come[çc]a/);
    });
    it('cita que CADA jogo trava no kickoff individual', () => {
      expect(lower).toMatch(/cada palpite trava|cada jogo|kickoff/);
    });
    it('cita explicitamente que pode palpitar nos próximos do mesmo dia', () => {
      expect(lower).toMatch(/pr[óo]ximos do mesmo dia|cada jogo tem seu pr[óo]prio prazo/);
    });
    it('cita fuso de Brasília', () => {
      expect(lower).toMatch(/bras[íi]lia/);
    });
  });

  describe('comandos canônicos citados', () => {
    it('cita próximos jogos', () => {
      expect(lower).toContain('próximos jogos');
    });
    it('cita meus palpites', () => {
      expect(lower).toContain('meus palpites');
    });
    it('cita ranking', () => {
      expect(lower).toContain('ranking');
    });
  });
});

describe('regrasCompletas', () => {
  it('é o mesmo texto canônico de regrasTexto', () => {
    expect(regrasCompletas()).toBe(regrasTexto());
  });
});

describe('regrasMataMata', () => {
  const texto = regrasMataMata();
  const lower = texto.toLowerCase();

  it('destaca que o placar vale 90+prorrogação e pênalti não entra', () => {
    expect(lower).toMatch(/prorroga[çc][ãa]o/);
    expect(lower).toMatch(/p[êe]naltis? n[ãa]o entram|n[ãa]o entram no placar/);
  });

  it('explica o bônus de quem passa e que a crava nunca é perdida', () => {
    expect(lower).toMatch(/quem (se )?classifica|quem passa/);
    expect(lower).toMatch(/nunca tira|crava (fica )?garantida/);
  });

  it('mostra a grade de pontos por fase a partir da fonte única (TABELA_PONTOS)', () => {
    // valores derivados de TABELA_PONTOS/BONUS — travam o sincronismo
    expect(texto).toContain(`${TABELA_PONTOS.R32.placarExato} pts no placar exato + ${BONUS_CLASSIFICADO.R32}`);
    expect(texto).toContain(`${TABELA_PONTOS.FINAL.placarExato} pts no placar exato + ${BONUS_CLASSIFICADO.FINAL}`);
    expect(texto).toContain(`${TABELA_PONTOS.OITAVAS.placarExato} pts no placar exato + ${BONUS_CLASSIFICADO.OITAVAS}`);
  });

  it('reforça que o ranking é cumulativo (não zera)', () => {
    expect(lower).toMatch(/cumulativo|n[ãa]o zera|continuam valendo/);
  });
});
