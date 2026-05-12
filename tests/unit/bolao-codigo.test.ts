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
    // BOLAO tem O (excluido) — falha em codigoBate;
    // ENTRAR tem so letras validas mas eh natural — falha por falta de digito
    expect(extrairCodigoBolao('quero entrar no bolao agora')).toBeNull();
  });

  it('rejeita codigo com vogais ambiguas (O/I/L)', () => {
    // OPSILO tem O e I — nao deve ser aceito
    expect(extrairCodigoBolao('#OPSILO')).toBeNull();
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
