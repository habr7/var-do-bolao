import { describe, it, expect } from 'vitest';
import {
  whatsappParaTelegramHtml,
  htmlParaTextoPuro,
  quebrarMensagemLonga,
} from '../../src/messaging/telegram.format.js';

describe('whatsappParaTelegramHtml', () => {
  it('converte *negrito* pra <b>', () => {
    expect(whatsappParaTelegramHtml('manda *próximos jogos* aí')).toBe(
      'manda <b>próximos jogos</b> aí',
    );
  });

  it('converte _itálico_ pra <i>', () => {
    expect(whatsappParaTelegramHtml('_horários em fuso de Brasília_')).toBe(
      '<i>horários em fuso de Brasília</i>',
    );
  });

  it('converte ~tachado~ pra <s>', () => {
    expect(whatsappParaTelegramHtml('~riscado~')).toBe('<s>riscado</s>');
  });

  it('converte `mono` pra <code>', () => {
    expect(whatsappParaTelegramHtml('ex: `Brasil 2x1 Marrocos`')).toBe(
      'ex: <code>Brasil 2x1 Marrocos</code>',
    );
  });

  it('converte bloco ``` pra <pre>', () => {
    expect(whatsappParaTelegramHtml('```\nlinha1\nlinha2\n```')).toBe('<pre>linha1\nlinha2</pre>');
  });

  it('escapa < > & fora e dentro de tags', () => {
    expect(whatsappParaTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    expect(whatsappParaTelegramHtml('*a<b*')).toBe('<b>a&lt;b</b>');
    expect(whatsappParaTelegramHtml('`x & y`')).toBe('<code>x &amp; y</code>');
  });

  it('asterisco solto fica literal (nao quebra o envio)', () => {
    expect(whatsappParaTelegramHtml('2 * 3 = 6')).toBe('2 * 3 = 6');
    expect(whatsappParaTelegramHtml('nota: *importante')).toBe('nota: *importante');
  });

  it('par nao cruza linha (mesma regra do WhatsApp)', () => {
    expect(whatsappParaTelegramHtml('*abre\nfecha*')).toBe('*abre\nfecha*');
  });

  it('varios pares na mesma linha', () => {
    expect(whatsappParaTelegramHtml('*Rodada 3* — _Oitavas_ ok')).toBe(
      '<b>Rodada 3</b> — <i>Oitavas</i> ok',
    );
  });

  it('mensagem real do bot (bom-dia) converte inteira', () => {
    const msg =
      '☀️ *Bom dia, boleiros!* Hoje rola Copa, ó:\n\n' +
      '✅ 25/06 16:00 — Brasil x Marrocos\n' +
      '⚪ = falta palpitar (2). Manda *próximos jogos*.\n\n' +
      '_(horários em fuso de Brasília 🇧🇷)_';
    const html = whatsappParaTelegramHtml(msg);
    expect(html).toContain('<b>Bom dia, boleiros!</b>');
    expect(html).toContain('<b>próximos jogos</b>');
    expect(html).toContain('<i>(horários em fuso de Brasília 🇧🇷)</i>');
    expect(html).not.toContain('*');
  });

  it('nunca lanca — pior caso devolve texto escapado', () => {
    expect(() => whatsappParaTelegramHtml('***___```')).not.toThrow();
  });
});

describe('htmlParaTextoPuro', () => {
  it('remove tags e des-escapa entidades', () => {
    expect(htmlParaTextoPuro('<b>oi</b> &lt;3 &amp; tal')).toBe('oi <3 & tal');
  });
});

describe('quebrarMensagemLonga', () => {
  it('mensagem curta = 1 parte', () => {
    expect(quebrarMensagemLonga('oi')).toEqual(['oi']);
  });

  it('quebra em \\n perto do limite', () => {
    const linha = 'x'.repeat(100);
    const texto = Array.from({ length: 60 }, () => linha).join('\n'); // ~6060 chars
    const partes = quebrarMensagemLonga(texto, 4000);
    expect(partes.length).toBe(2);
    expect(partes[0].length).toBeLessThanOrEqual(4000);
    // nenhuma linha partida no meio
    for (const p of partes) {
      for (const l of p.split('\n')) expect(l.length).toBe(100);
    }
    expect(partes.join('\n')).toBe(texto);
  });

  it('corte duro quando nao ha \\n util', () => {
    const texto = 'y'.repeat(9000);
    const partes = quebrarMensagemLonga(texto, 4000);
    expect(partes.length).toBe(3);
    expect(partes.join('')).toBe(texto);
  });
});
