import { describe, it, expect } from 'vitest';
import { detectarAcaoAdmin } from '../../src/whatsapp/admin.parser.js';

describe('detectarAcaoAdmin', () => {
  describe('APROVAR_TODOS — varios formatos', () => {
    it('"aprovar todos"', () => {
      expect(detectarAcaoAdmin('aprovar todos')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('"aprovado todos"', () => {
      expect(detectarAcaoAdmin('aprovado todos')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('"libera geral"', () => {
      expect(detectarAcaoAdmin('libera geral')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('"libera todo mundo"', () => {
      expect(detectarAcaoAdmin('libera todo mundo')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('"ok geral"', () => {
      expect(detectarAcaoAdmin('ok geral')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('"aprovo geral"', () => {
      expect(detectarAcaoAdmin('aprovo geral')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('com pontuacao "aprovar todos!"', () => {
      expect(detectarAcaoAdmin('aprovar todos!')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
    it('com acento "aprovar todos os pedidos"', () => {
      expect(detectarAcaoAdmin('aprovar todos os pedidos')).toEqual({ tipo: 'APROVAR_TODOS' });
    });
  });

  describe('RECUSAR_TODOS', () => {
    it('"recusar todos"', () => {
      expect(detectarAcaoAdmin('recusar todos')).toEqual({ tipo: 'RECUSAR_TODOS' });
    });
    it('"rejeitar geral"', () => {
      expect(detectarAcaoAdmin('rejeitar geral')).toEqual({ tipo: 'RECUSAR_TODOS' });
    });
  });

  describe('APROVAR_NOMEADO', () => {
    it('"aprovar João"', () => {
      const r = detectarAcaoAdmin('aprovar João');
      expect(r?.tipo).toBe('APROVAR_NOMEADO');
      if (r?.tipo === 'APROVAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('joão');
    });
    it('"aprovado fulano"', () => {
      const r = detectarAcaoAdmin('aprovado fulano');
      expect(r?.tipo).toBe('APROVAR_NOMEADO');
      if (r?.tipo === 'APROVAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('fulano');
    });
    it('"libera o pedro"', () => {
      const r = detectarAcaoAdmin('libera o pedro');
      expect(r?.tipo).toBe('APROVAR_NOMEADO');
      if (r?.tipo === 'APROVAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('pedro');
    });
    it('"ok ana silva"', () => {
      const r = detectarAcaoAdmin('ok ana silva');
      expect(r?.tipo).toBe('APROVAR_NOMEADO');
      if (r?.tipo === 'APROVAR_NOMEADO') {
        expect(r.nome.toLowerCase()).toContain('ana');
      }
    });
  });

  describe('RECUSAR_NOMEADO', () => {
    it('"recusar joao"', () => {
      const r = detectarAcaoAdmin('recusar joao');
      expect(r?.tipo).toBe('RECUSAR_NOMEADO');
      if (r?.tipo === 'RECUSAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('joao');
    });
    it('"rejeito o pedro"', () => {
      const r = detectarAcaoAdmin('rejeito o pedro');
      expect(r?.tipo).toBe('RECUSAR_NOMEADO');
      if (r?.tipo === 'RECUSAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('pedro');
    });
    it('"fora maria"', () => {
      const r = detectarAcaoAdmin('fora maria');
      expect(r?.tipo).toBe('RECUSAR_NOMEADO');
      if (r?.tipo === 'RECUSAR_NOMEADO') expect(r.nome.toLowerCase()).toContain('maria');
    });
  });

  describe('AFIRMATIVO_GENERICO — sem nome', () => {
    it('"aprovado"', () => {
      expect(detectarAcaoAdmin('aprovado')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"sim"', () => {
      expect(detectarAcaoAdmin('sim')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"ta liberado"', () => {
      expect(detectarAcaoAdmin('ta liberado')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"ta dentro"', () => {
      expect(detectarAcaoAdmin('ta dentro')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"beleza"', () => {
      expect(detectarAcaoAdmin('beleza')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"pode entrar"', () => {
      expect(detectarAcaoAdmin('pode entrar')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
    it('"ok"', () => {
      expect(detectarAcaoAdmin('ok')).toEqual({ tipo: 'AFIRMATIVO_GENERICO' });
    });
  });

  describe('NEGATIVO_GENERICO — sem nome', () => {
    it('"recusar"', () => {
      expect(detectarAcaoAdmin('recusar')).toEqual({ tipo: 'NEGATIVO_GENERICO' });
    });
    it('"nao"', () => {
      expect(detectarAcaoAdmin('nao')).toEqual({ tipo: 'NEGATIVO_GENERICO' });
    });
    it('"recusado"', () => {
      expect(detectarAcaoAdmin('recusado')).toEqual({ tipo: 'NEGATIVO_GENERICO' });
    });
    it('"fora"', () => {
      expect(detectarAcaoAdmin('fora')).toEqual({ tipo: 'NEGATIVO_GENERICO' });
    });
  });

  describe('mensagens que NAO sao acao admin', () => {
    it('"oi" → null', () => {
      expect(detectarAcaoAdmin('oi')).toBeNull();
    });
    it('"meus palpites" → null', () => {
      expect(detectarAcaoAdmin('meus palpites')).toBeNull();
    });
    it('"ranking" → null', () => {
      expect(detectarAcaoAdmin('ranking')).toBeNull();
    });
    it('string vazia → null', () => {
      expect(detectarAcaoAdmin('')).toBeNull();
    });
    it('"jogos hoje" → null', () => {
      expect(detectarAcaoAdmin('jogos hoje')).toBeNull();
    });
  });
});
