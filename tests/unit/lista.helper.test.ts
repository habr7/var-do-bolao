import { describe, it, expect } from 'vitest';
import { formatarBoloesNumerados, parseEscolhaBolao, ehEscolhaTodos } from '../../src/whatsapp/lista.helper.js';

const BOLOES = [
  { id: 'a', nome: 'Bolão da Jeni', codigo: 'AAAA11' },
  { id: 'b', nome: 'Bolão do João', codigo: 'BBBB22' },
  { id: 'c', nome: 'Bolão da Firma 2026' },
];

describe('formatarBoloesNumerados', () => {
  it('renderiza com indice 1-based + codigo', () => {
    const out = formatarBoloesNumerados(BOLOES);
    expect(out).toContain('1. *Bolão da Jeni*');
    expect(out).toContain('(`#AAAA11`)');
    expect(out).toContain('3. *Bolão da Firma 2026*');
  });

  it('sem boloes', () => {
    expect(formatarBoloesNumerados([])).toContain('nenhum bolao');
  });
});

describe('parseEscolhaBolao', () => {
  it('por indice numerico simples', () => {
    expect(parseEscolhaBolao('1', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('2', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('3', BOLOES)?.id).toBe('c');
  });

  it('indice com espaco/pontuacao', () => {
    expect(parseEscolhaBolao('  2  ', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('1.', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('1 quero esse', BOLOES)?.id).toBe('a');
  });

  it('indice fora do range cai pra outra estrategia', () => {
    // "10" não bate indice e nem nome nem codigo
    expect(parseEscolhaBolao('10', BOLOES)).toBeNull();
  });

  it('por codigo curto', () => {
    expect(parseEscolhaBolao('#AAAA11', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('AAAA11', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('#bbbb22', BOLOES)?.id).toBe('b');
  });

  it('por nome (match exato case+acento-insensitivo)', () => {
    expect(parseEscolhaBolao('Bolao da Jeni', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('BOLÃO DO JOÃO', BOLOES)?.id).toBe('b');
  });

  it('por nome (fuzzy substring)', () => {
    expect(parseEscolhaBolao('jeni', BOLOES)?.id).toBe('a');
    expect(parseEscolhaBolao('joao', BOLOES)?.id).toBe('b');
    expect(parseEscolhaBolao('firma', BOLOES)?.id).toBe('c');
  });

  it('texto que nao bate nada → null', () => {
    expect(parseEscolhaBolao('coisa diferente', BOLOES)).toBeNull();
  });

  it('lista vazia → null', () => {
    expect(parseEscolhaBolao('1', [])).toBeNull();
  });

  it('texto vazio → null', () => {
    expect(parseEscolhaBolao('   ', BOLOES)).toBeNull();
  });
});

describe('v3.12.0 — ehEscolhaTodos (caso Bruna 10/06)', () => {
  // User estava em 2 bolões e mandou o lote de 10 palpites 2x.
  // Agora oferecemos "TODOS" como opção N+1.
  it('aceita "todos"', () => {
    expect(ehEscolhaTodos('todos', 2)).toBe(true);
  });
  it('aceita "TODOS" maiúsculo', () => {
    expect(ehEscolhaTodos('TODOS', 2)).toBe(true);
  });
  it('aceita "ambos"', () => {
    expect(ehEscolhaTodos('ambos', 2)).toBe(true);
  });
  it('aceita "tudo"', () => {
    expect(ehEscolhaTodos('tudo', 2)).toBe(true);
  });
  it('aceita "all"', () => {
    expect(ehEscolhaTodos('all', 3)).toBe(true);
  });
  it('aceita "todos os bolões"', () => {
    expect(ehEscolhaTodos('todos os bolões', 2)).toBe(true);
  });
  it('aceita índice N+1 (2 bolões → "3")', () => {
    expect(ehEscolhaTodos('3', 2)).toBe(true);
  });
  it('aceita índice N+1 (3 bolões → "4")', () => {
    expect(ehEscolhaTodos('4', 3)).toBe(true);
  });
  // Anti-falsos-positivos
  it('"1" NÃO é todos (escolha de bolão)', () => {
    expect(ehEscolhaTodos('1', 2)).toBe(false);
  });
  it('"2" NÃO é todos (escolha de bolão)', () => {
    expect(ehEscolhaTodos('2', 2)).toBe(false);
  });
  it('texto qualquer NÃO é todos', () => {
    expect(ehEscolhaTodos('Bolão das Girls', 2)).toBe(false);
  });
  it('"todos os times" NÃO casa (não é palavra-chave isolada)', () => {
    // Edge case: "todos os times jogam amanhã" — false positivo se
    // user mandar como resposta. Aceitável porque a frase é estranha
    // de mandar como resposta a "qual bolão".
    expect(ehEscolhaTodos('todos os times jogam amanhã', 2)).toBe(false);
  });
});
