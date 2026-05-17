import { describe, it, expect } from 'vitest';
import {
  soDigitos,
  montarLinkWaMe,
  montarTextoSolicitacaoEntrada,
  renderizarConvite,
} from '../../src/whatsapp/convite.helper.js';

describe('soDigitos', () => {
  it('remove tudo que nao for digito', () => {
    expect(soDigitos('+55 11 97827-7516')).toBe('5511978277516');
    expect(soDigitos('(11) 99999.9999')).toBe('11999999999');
    expect(soDigitos('abc')).toBe('');
    expect(soDigitos('')).toBe('');
  });
});

describe('montarLinkWaMe', () => {
  it('gera link wa.me com texto URL-encoded', () => {
    const link = montarLinkWaMe('+55 11 97827-7516', 'Olá!');
    expect(link).toBe('https://wa.me/5511978277516?text=Ol%C3%A1!');
  });

  it('aceita numero sem formatacao', () => {
    expect(montarLinkWaMe('5511978277516', 'oi')).toContain('https://wa.me/5511978277516');
  });

  it('retorna vazio quando numero nao configurado', () => {
    expect(montarLinkWaMe('', 'oi')).toBe('');
  });

  it('retorna vazio quando numero curto demais', () => {
    expect(montarLinkWaMe('123', 'oi')).toBe('');
  });
});

describe('montarTextoSolicitacaoEntrada', () => {
  it('gera texto com nome e ID', () => {
    const t = montarTextoSolicitacaoEntrada('Bolão da Firma', 'K3MZ8P');
    expect(t).toContain('Bolão da Firma');
    expect(t).toContain('#K3MZ8P');
  });
});

describe('renderizarConvite', () => {
  it('quando numero do bot setado, retorna link wa.me clicavel', () => {
    const r = renderizarConvite({
      nomeBolao: 'Bolão da Jeni',
      codigoBolao: 'K3MZ8P',
      numeroBot: '+55 11 97827-7516',
    });
    expect(r.linkWaMe).toContain('https://wa.me/5511978277516');
    expect(r.textoPrincipal).toContain('https://wa.me/5511978277516');
    expect(r.textoEncaminhavel).toContain('https://wa.me/5511978277516');
    expect(r.textoPrincipal).toContain('Bolão da Jeni');
  });

  it('quando numero do bot vazio, cai no fallback sem link', () => {
    const r = renderizarConvite({
      nomeBolao: 'Bolão X',
      codigoBolao: 'AD71F3',
      numeroBot: '',
    });
    expect(r.linkWaMe).toBe('');
    expect(r.textoPrincipal).not.toContain('https://wa.me');
    expect(r.textoEncaminhavel).toContain('#AD71F3');
  });

  it('texto principal inclui ID visivel mesmo com link (pra quem nao puder clicar)', () => {
    const r = renderizarConvite({
      nomeBolao: 'Bolão Y',
      codigoBolao: 'XYZ789',
      numeroBot: '+5511999999999',
    });
    expect(r.textoPrincipal).toContain('#XYZ789');
  });
});
