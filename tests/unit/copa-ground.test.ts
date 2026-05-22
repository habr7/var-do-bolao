import { describe, it, expect } from 'vitest';
import { construirFatosCopa2026, respostaForaDeEscopo } from '../../src/llm/copa.ground.js';

describe('construirFatosCopa2026 — bug original que motivou o módulo', () => {
  it('"Quais próximos jogos da Inglaterra?" → bloco diz Grupo L (não C)', () => {
    const f = construirFatosCopa2026('Quais próximos jogos da Inglaterra?');
    expect(f.dentroDoEscopo).toBe(true);
    expect(f.motivo).toBe('TIME');
    expect(f.bloco).toContain('Inglaterra');
    expect(f.bloco).toContain('Grupo L');
    expect(f.bloco).toContain('Croácia');
    expect(f.bloco).toContain('Gana');
    expect(f.bloco).toContain('Panamá');
    // Garante explicitamente que NÃO menciona o grupo errado do bug original
    expect(f.bloco).not.toContain('Grupo C');
    expect(f.bloco).not.toMatch(/\bIrã\b/);
  });

  it('"Inglaterra está em qual grupo?" detecta time e responde Grupo L', () => {
    const f = construirFatosCopa2026('Inglaterra está em qual grupo?');
    expect(f.dentroDoEscopo).toBe(true);
    expect(f.bloco).toContain('Grupo L');
  });
});

describe('construirFatosCopa2026 — detecção dentro de escopo', () => {
  it('time citado → motivo TIME, bloco com composição do grupo', () => {
    const f = construirFatosCopa2026('quando joga o Brasil?');
    expect(f.motivo).toBe('TIME');
    expect(f.bloco).toContain('Brasil');
    expect(f.bloco).toContain('Grupo C');
    expect(f.bloco).toContain('Marrocos');
    expect(f.bloco).toContain('Escócia');
  });

  it('grupo direto "grupo C" → motivo GRUPO', () => {
    const f = construirFatosCopa2026('como é o grupo C?');
    expect(f.motivo).toBe('GRUPO');
    expect(f.bloco).toContain('Grupo C: ');
    expect(f.bloco).toContain('Brasil');
    expect(f.bloco).toContain('Haiti');
  });

  it('pergunta sobre sede → motivo ESTADIO_SEDE', () => {
    const f = construirFatosCopa2026('em quais cidades vai ser a copa?');
    expect(f.motivo).toBe('ESTADIO_SEDE');
    expect(f.bloco).toContain('Canadá');
    expect(f.bloco).toContain('Estados Unidos');
    expect(f.bloco).toContain('México');
  });

  it('pergunta sobre quando começa → motivo DATA', () => {
    const f = construirFatosCopa2026('quando começa a copa?');
    expect(f.motivo).toBe('DATA');
    expect(f.bloco).toContain('Início');
    expect(f.bloco).toContain('11/jun');
  });

  it('pergunta genérica sobre a copa → motivo GERAL_COPA', () => {
    const f = construirFatosCopa2026('me fala da copa do mundo');
    expect(f.motivo).toBe('GERAL_COPA');
    expect(f.bloco).toContain('48 seleções');
    expect(f.bloco).toContain('12 grupos');
  });
});

describe('construirFatosCopa2026 — fora de escopo', () => {
  it('Libertadores → fora de escopo', () => {
    const f = construirFatosCopa2026('quem ganhou a Libertadores 2025?');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.motivo).toBe('FORA_DE_COPA');
    expect(f.bloco).toBeNull();
    expect(f.detectado?.foraEscopo).toBe('Libertadores');
  });

  it('Brasileirão → fora de escopo', () => {
    const f = construirFatosCopa2026('como tá o Brasileirão?');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.detectado?.foraEscopo).toBe('Brasileirão');
  });

  it('Flamengo → fora de escopo (clube)', () => {
    const f = construirFatosCopa2026('jogo do Flamengo hoje?');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.detectado?.foraEscopo).toBe('Flamengo');
  });

  it('Copa de 94 → fora de escopo (copa antiga)', () => {
    const f = construirFatosCopa2026('quem ganhou a copa de 94?');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.detectado?.foraEscopo).toBe('Copa de 1994');
  });

  it('jogador específico (Vinicius Jr) → fora de escopo', () => {
    const f = construirFatosCopa2026('o Vinicius Jr vai jogar?');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.detectado?.foraEscopo).toBe('jogador específico');
  });

  it('Real Madrid → fora de escopo mesmo citando time da Copa', () => {
    const f = construirFatosCopa2026('Real Madrid contra a Argentina');
    expect(f.dentroDoEscopo).toBe(false);
    expect(f.detectado?.foraEscopo).toBe('Real Madrid');
  });
});

describe('respostaForaDeEscopo', () => {
  it('é cordial, menciona Copa 2026 e redireciona pro bolão', () => {
    const r = respostaForaDeEscopo();
    expect(r).toMatch(/Copa.*2026/i);
    expect(r.toLowerCase()).toContain('bolões');
    expect(r.toLowerCase()).toContain('ranking');
    // Não pode ser frio/agressivo
    expect(r).not.toMatch(/erro|não posso|inválido/i);
  });
});

describe('construirFatosCopa2026 — sempre inclui cabeçalho de fonte', () => {
  it('bloco menciona openfootball e data de atualização', () => {
    const f = construirFatosCopa2026('grupo do Brasil');
    expect(f.bloco).toContain('FATOS VERIFICADOS');
    expect(f.bloco).toContain('openfootball');
    expect(f.bloco).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
