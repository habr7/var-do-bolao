import { describe, it, expect } from 'vitest';
import { gerarCodigoBolao, extrairCodigoBolao } from '../../src/utils/bolao-codigo.js';

describe('gerarCodigoBolao', () => {
  it('gera codigo de 6 chars por padrao', () => {
    const c = gerarCodigoBolao();
    expect(c).toHaveLength(6);
  });

  it('gera codigo do tamanho pedido', () => {
    expect(gerarCodigoBolao(8)).toHaveLength(8);
  });

  it('usa apenas chars do alfabeto sem ambiguidade (sem 0, 1, I, L, O)', () => {
    const proibidos = ['0', '1', 'I', 'L', 'O'];
    for (let i = 0; i < 200; i++) {
      const c = gerarCodigoBolao(6);
      for (const p of proibidos) {
        expect(c).not.toContain(p);
      }
    }
  });

  it('gera codigos diferentes entre chamadas (probabilistico)', () => {
    const set = new Set<string>();
    for (let i = 0; i < 50; i++) set.add(gerarCodigoBolao(6));
    // 30^6 ≈ 729M combinacoes — em 50 amostras nao pode dar todas iguais
    expect(set.size).toBeGreaterThan(45);
  });
});

describe('extrairCodigoBolao', () => {
  it('extrai codigo com prefixo #', () => {
    expect(extrairCodigoBolao('Quero entrar no bolão #K3MZ8P, manda a senha')).toBe('K3MZ8P');
  });

  it('extrai codigo no meio da mensagem-convite encaminhada', () => {
    const msg = 'Olá! Quero entrar no bolão Família 2026 🏆\nID: *#K3MZ8P*\n\nManda esse texto pro número...';
    expect(extrairCodigoBolao(msg)).toBe('K3MZ8P');
  });

  it('eh case insensitive (retorna em UPPER)', () => {
    expect(extrairCodigoBolao('#k3mz8p')).toBe('K3MZ8P');
  });

  it('retorna null quando nao acha codigo', () => {
    expect(extrairCodigoBolao('oi tudo bem?')).toBeNull();
  });

  it('nao acha "palavra normal" como codigo', () => {
    // ENTRAR/BOLAO sao palavras sem digito — falham na exigencia de
    // ter ao menos um digito (regra de palavra isolada sem #)
    expect(extrairCodigoBolao('quero entrar no bolao agora')).toBeNull();
  });

  // ISSUE-001: ACEITA codigos legados que contem 0/1/I/L/O. A migration
  // que gerou codigos antigos via UPPER(MD5(...)) usa alfabeto hex (0-9A-F)
  // — esses codigos precisam continuar funcionando. A geracao nova (alfabeto
  // restritivo) garante que codigos novos sao sem ambiguidade visual.
  it('ISSUE-001: aceita codigo legado com 1 (#AD71F3)', () => {
    expect(extrairCodigoBolao('#AD71F3')).toBe('AD71F3');
  });

  it('ISSUE-001: aceita codigo legado dentro de mensagem-convite', () => {
    expect(
      extrairCodigoBolao('Olá! Quero entrar no bolão *Bolao da jeni* 🏆 ID: *#AD71F3*'),
    ).toBe('AD71F3');
  });

  it('ISSUE-001: aceita codigo legado com 0 (#100ABC)', () => {
    expect(extrairCodigoBolao('#100ABC')).toBe('100ABC');
  });

  it('ISSUE-001: aceita codigo legado com I/L/O junto de digito (#OL2345)', () => {
    expect(extrairCodigoBolao('#OL2345')).toBe('OL2345');
  });

  it('ISSUE-001: palavra de letras puras (sem digito, sem #) continua null', () => {
    // OPSILO em texto livre: ainda eh palavra natural; sem digito → null
    expect(extrairCodigoBolao('opsilo era um deus grego')).toBeNull();
  });

  it('ISSUE-001: com #, aceita codigo so letras (admin manda explicito)', () => {
    // Com # o usuario foi explicito ao indicar codigo. Aceita.
    expect(extrairCodigoBolao('#OPSILO')).toBe('OPSILO');
  });

  it('aceita codigo com # de 4 a 10 chars', () => {
    expect(extrairCodigoBolao('#ABCD')).toBe('ABCD');
    expect(extrairCodigoBolao('#ABCDEFGHJK')).toBe('ABCDEFGHJK');
  });

  it('extrai apenas o primeiro codigo quando ha mais de um', () => {
    // (note: o alfabeto exclui o digito 1, entao usamos 2-9 nos testes)
    expect(extrairCodigoBolao('#ABCD23 e #WXYZ89')).toBe('ABCD23');
  });

  it('sem #, exige pelo menos um digito (evita falso positivo com palavras)', () => {
    // "ENTRAR" tem so letras validas mas eh palavra natural — nao deve casar
    expect(extrairCodigoBolao('quero entrar')).toBeNull();
    // ja "K3MZ8P" tem digitos, eh codigo legitimo
    expect(extrairCodigoBolao('entrar K3MZ8P')).toBe('K3MZ8P');
  });
});
