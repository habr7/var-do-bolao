import { describe, it, expect } from 'vitest';
import { parseIntencao, parseMultiplePalpites, Intencao } from '../../src/whatsapp/message.parser.js';

describe('parseIntencao', () => {
  describe('saudacoes e menu', () => {
    it('identifica "oi"', () => {
      expect(parseIntencao('oi').intencao).toBe(Intencao.SAUDACAO);
    });
    it('identifica "olá" com acento', () => {
      expect(parseIntencao('olá').intencao).toBe(Intencao.SAUDACAO);
    });
    it('identifica "bom dia"', () => {
      expect(parseIntencao('bom dia').intencao).toBe(Intencao.SAUDACAO);
    });
    it('identifica "menu"', () => {
      expect(parseIntencao('menu').intencao).toBe(Intencao.MENU);
    });
    it('identifica "ajuda" e "help"', () => {
      expect(parseIntencao('ajuda').intencao).toBe(Intencao.AJUDA);
      expect(parseIntencao('help').intencao).toBe(Intencao.AJUDA);
    });
    it('identifica "cancelar"', () => {
      expect(parseIntencao('cancelar').intencao).toBe(Intencao.CANCELAR);
      expect(parseIntencao('sair').intencao).toBe(Intencao.CANCELAR);
    });
  });

  describe('fluxos principais', () => {
    it('identifica "criar bolão"', () => {
      expect(parseIntencao('criar bolão').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('identifica "criar bolao" sem acento', () => {
      expect(parseIntencao('criar bolao').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('identifica "entrar em bolão"', () => {
      expect(parseIntencao('entrar em bolão').intencao).toBe(Intencao.ENTRAR_BOLAO);
    });
    it('identifica "entrar"', () => {
      expect(parseIntencao('entrar').intencao).toBe(Intencao.ENTRAR_BOLAO);
    });
    it('identifica "meus bolões"', () => {
      expect(parseIntencao('meus bolões').intencao).toBe(Intencao.MEUS_BOLOES);
    });
  });

  describe('ranking e pontos', () => {
    it('parseia ranking sem argumento', () => {
      const r = parseIntencao('ranking');
      expect(r.intencao).toBe(Intencao.RANKING);
      expect(r.args).toEqual([]);
    });
    it('parseia ranking com nome do bolão', () => {
      const r = parseIntencao('ranking Firma FC');
      expect(r.intencao).toBe(Intencao.RANKING);
      expect(r.args).toEqual(['Firma FC']);
    });
    it('parseia meus pontos com nome do bolão', () => {
      const r = parseIntencao('meus pontos Firma FC');
      expect(r.intencao).toBe(Intencao.MEUS_PONTOS);
      expect(r.args).toEqual(['Firma FC']);
    });
  });

  describe('admin approvals', () => {
    it('parseia !aprovar com nome', () => {
      const r = parseIntencao('!aprovar João Silva');
      expect(r.intencao).toBe(Intencao.APROVAR);
      expect(r.args).toEqual(['João Silva']);
    });
    it('parseia !recusar com nome', () => {
      const r = parseIntencao('!recusar Fulano');
      expect(r.intencao).toBe(Intencao.RECUSAR);
      expect(r.args).toEqual(['Fulano']);
    });
    it('parseia !pendentes', () => {
      expect(parseIntencao('!pendentes').intencao).toBe(Intencao.PENDENTES);
      expect(parseIntencao('pendentes').intencao).toBe(Intencao.PENDENTES);
    });
  });

  describe('palpite inline', () => {
    it('parseia "Flamengo 2x1 Palmeiras"', () => {
      const r = parseIntencao('Flamengo 2x1 Palmeiras');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toEqual({
        timeCasa: 'Flamengo',
        golsCasa: 2,
        golsVisitante: 1,
        timeVisitante: 'Palmeiras',
      });
    });
    it('aceita espaço em volta do x', () => {
      const r = parseIntencao('São Paulo 0 x 0 Corinthians');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite?.timeCasa).toBe('São Paulo');
      expect(r.palpite?.timeVisitante).toBe('Corinthians');
    });
    it('aceita X maiúsculo', () => {
      const r = parseIntencao('Grêmio 1X3 Inter');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite?.golsCasa).toBe(1);
      expect(r.palpite?.golsVisitante).toBe(3);
    });
  });

  describe('texto livre e casos irreconhecidos', () => {
    it('retorna TEXTO_LIVRE para mensagem aleatória', () => {
      expect(parseIntencao('aaaaa').intencao).toBe(Intencao.TEXTO_LIVRE);
    });
    it('retorna TEXTO_LIVRE para string vazia', () => {
      expect(parseIntencao('').intencao).toBe(Intencao.TEXTO_LIVRE);
    });
  });
});

describe('parseMultiplePalpites', () => {
  it('parseia vários palpites em linhas separadas', () => {
    const text = `Flamengo 2x1 Palmeiras
Corinthians 0x0 São Paulo
Grêmio 1x2 Internacional`;
    const r = parseMultiplePalpites(text);
    expect(r).toHaveLength(3);
    expect(r[0].timeCasa).toBe('Flamengo');
    expect(r[2].timeVisitante).toBe('Internacional');
  });

  it('ignora linhas que não são palpite', () => {
    const text = `Flamengo 2x1 Palmeiras
bom dia galera
Grêmio 1x2 Inter`;
    const r = parseMultiplePalpites(text);
    expect(r).toHaveLength(2);
  });

  it('retorna array vazio se nenhum palpite', () => {
    expect(parseMultiplePalpites('oi tudo bem?')).toEqual([]);
  });
});
