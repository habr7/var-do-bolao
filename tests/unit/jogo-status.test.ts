import { describe, it, expect } from 'vitest';
import {
  jogoEstaRolandoPorHorario,
  jogoEncerradoAguardandoPlacar,
  jogoAindaNaoComecou,
  JANELA_JOGO_ROLANDO_MS,
} from '../../src/utils/jogo-status.js';

/**
 * v3.20.0 — estado de jogo derivado por horário.
 *
 * Análise feita com México x África do Sul ROLANDO (11/06 16:19, jogo
 * começou 16:00): status no banco fica AGENDADO durante todo o jogo
 * porque openfootball não publica placar ao vivo. Estado "rolando"
 * precisa ser derivado do kickoff.
 */

// Cenário real: jogo às 16:00 BRT = 19:00 UTC
const KICKOFF = new Date('2026-06-11T19:00:00.000Z');

function jogo(status: string, dataHora: Date = KICKOFF) {
  return { dataHora, status };
}

describe('jogoEstaRolandoPorHorario', () => {
  it('caso REAL: 16:19 BRT com jogo iniciado 16:00 e status AGENDADO → rolando', () => {
    const agora = new Date('2026-06-11T19:19:00.000Z'); // 16:19 BRT
    expect(jogoEstaRolandoPorHorario(jogo('AGENDADO'), agora)).toBe(true);
  });
  it('1 minuto ANTES do kickoff → NÃO rolando', () => {
    const agora = new Date('2026-06-11T18:59:00.000Z');
    expect(jogoEstaRolandoPorHorario(jogo('AGENDADO'), agora)).toBe(false);
  });
  it('exatamente no kickoff → rolando', () => {
    expect(jogoEstaRolandoPorHorario(jogo('AGENDADO'), KICKOFF)).toBe(true);
  });
  it('2h29 após kickoff → ainda rolando (dentro da janela)', () => {
    const agora = new Date(KICKOFF.getTime() + JANELA_JOGO_ROLANDO_MS - 60_000);
    expect(jogoEstaRolandoPorHorario(jogo('AGENDADO'), agora)).toBe(true);
  });
  it('2h31 após kickoff → NÃO rolando (saiu da janela)', () => {
    const agora = new Date(KICKOFF.getTime() + JANELA_JOGO_ROLANDO_MS + 60_000);
    expect(jogoEstaRolandoPorHorario(jogo('AGENDADO'), agora)).toBe(false);
  });
  it('status AO_VIVO explícito → rolando mesmo fora da janela', () => {
    const agora = new Date(KICKOFF.getTime() + JANELA_JOGO_ROLANDO_MS + 3600_000);
    expect(jogoEstaRolandoPorHorario(jogo('AO_VIVO'), agora)).toBe(true);
  });
  it('FINALIZADO → nunca rolando (mesmo dentro da janela)', () => {
    const agora = new Date(KICKOFF.getTime() + 30 * 60_000);
    expect(jogoEstaRolandoPorHorario(jogo('FINALIZADO'), agora)).toBe(false);
  });
  it('ADIADO → nunca rolando', () => {
    const agora = new Date(KICKOFF.getTime() + 30 * 60_000);
    expect(jogoEstaRolandoPorHorario(jogo('ADIADO'), agora)).toBe(false);
  });
  it('CANCELADO → nunca rolando', () => {
    const agora = new Date(KICKOFF.getTime() + 30 * 60_000);
    expect(jogoEstaRolandoPorHorario(jogo('CANCELADO'), agora)).toBe(false);
  });
});

describe('jogoEncerradoAguardandoPlacar', () => {
  it('AGENDADO 3h após kickoff (openfootball não commitou) → aguardando', () => {
    const agora = new Date(KICKOFF.getTime() + 3 * 3600_000);
    expect(jogoEncerradoAguardandoPlacar(jogo('AGENDADO'), agora)).toBe(true);
  });
  it('AGENDADO 1h após kickoff (ainda rolando) → NÃO aguardando', () => {
    const agora = new Date(KICKOFF.getTime() + 3600_000);
    expect(jogoEncerradoAguardandoPlacar(jogo('AGENDADO'), agora)).toBe(false);
  });
  it('FINALIZADO → NÃO aguardando (placar já chegou)', () => {
    const agora = new Date(KICKOFF.getTime() + 3 * 3600_000);
    expect(jogoEncerradoAguardandoPlacar(jogo('FINALIZADO'), agora)).toBe(false);
  });
});

describe('jogoAindaNaoComecou', () => {
  it('antes do kickoff → true (palpite aberto)', () => {
    const agora = new Date(KICKOFF.getTime() - 3600_000);
    expect(jogoAindaNaoComecou(jogo('AGENDADO'), agora)).toBe(true);
  });
  it('depois do kickoff → false (palpite travado)', () => {
    const agora = new Date(KICKOFF.getTime() + 60_000);
    expect(jogoAindaNaoComecou(jogo('AGENDADO'), agora)).toBe(false);
  });
  it('ADIADO → false mesmo antes do horário (não palpitável)', () => {
    const agora = new Date(KICKOFF.getTime() - 3600_000);
    expect(jogoAindaNaoComecou(jogo('ADIADO'), agora)).toBe(false);
  });
});
