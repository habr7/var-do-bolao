import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Histórico de conversas (v3.60.0): escrita fire-and-forget nunca lança,
 * resolução de usuarioId por variantes do waId, truncamento, e o contexto
 * de auditoria em memória.
 */

const { usuarioFindFirst, conversaCreate, auditoriaCreate } = vi.hoisted(() => ({
  usuarioFindFirst: vi.fn(),
  conversaCreate: vi.fn(),
  auditoriaCreate: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    usuario: { findFirst: (...a: unknown[]) => usuarioFindFirst(...a) },
    mensagemConversa: { create: (...a: unknown[]) => conversaCreate(...a) },
    palpiteAuditoria: { create: (...a: unknown[]) => auditoriaCreate(...a) },
  },
}));

import {
  registrarMensagemConversa,
  gravarAuditoriaPalpite,
} from '../../src/modules/conversa/conversa.service.js';
import {
  setContextoAuditoria,
  getContextoAuditoria,
  limparContextosAuditoria,
} from '../../src/modules/conversa/auditoria-contexto.js';

beforeEach(() => {
  usuarioFindFirst.mockReset().mockResolvedValue(null);
  conversaCreate.mockReset().mockResolvedValue({});
  auditoriaCreate.mockReset().mockResolvedValue({});
  limparContextosAuditoria();
});

describe('registrarMensagemConversa', () => {
  it('resolve usuarioId por variantes do waId (JID → dígitos)', async () => {
    usuarioFindFirst.mockResolvedValue({ id: 'u1' });
    await registrarMensagemConversa({
      waId: '5511912345678@s.whatsapp.net',
      canal: 'whatsapp',
      direcao: 'ENTRADA',
      texto: 'oi',
      messageId: 'm1',
    });
    const busca = usuarioFindFirst.mock.calls[0][0] as { where: { whatsappId: { in: string[] } } };
    expect(busca.where.whatsappId.in).toContain('5511912345678');
    const criado = conversaCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(criado.data.usuarioId).toBe('u1');
    expect(criado.data.canal).toBe('whatsapp');
    expect(criado.data.direcao).toBe('ENTRADA');
  });

  it('endereço tg: (onboarding) não busca usuário — usuarioId null', async () => {
    await registrarMensagemConversa({
      waId: 'tg:777',
      canal: 'telegram',
      direcao: 'ENTRADA',
      texto: '/start',
    });
    expect(usuarioFindFirst).not.toHaveBeenCalled();
    const criado = conversaCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(criado.data.usuarioId).toBeNull();
  });

  it('trunca texto em 2000 chars', async () => {
    await registrarMensagemConversa({
      waId: '551199',
      canal: 'whatsapp',
      direcao: 'SAIDA',
      texto: 'x'.repeat(5000),
    });
    const criado = conversaCreate.mock.calls[0][0] as { data: { texto: string } };
    expect(criado.data.texto.length).toBe(2000);
  });

  it('NUNCA lança — banco fora do ar vira console.warn', async () => {
    conversaCreate.mockRejectedValue(new Error('db down'));
    await expect(
      registrarMensagemConversa({ waId: 'x', canal: 'whatsapp', direcao: 'ENTRADA', texto: 'oi' }),
    ).resolves.toBeUndefined();
  });
});

describe('gravarAuditoriaPalpite', () => {
  it('grava evento completo', async () => {
    await gravarAuditoriaPalpite({
      usuarioId: 'u1',
      jogoId: 'j1',
      bolaoId: 'b1',
      acao: 'EDITADO',
      placarAntes: '2x1',
      placarDepois: '3x1',
      textoOriginal: 'corrigir Brasil 3x1',
      canal: 'telegram',
    });
    const criado = auditoriaCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(criado.data).toMatchObject({
      usuarioId: 'u1',
      acao: 'EDITADO',
      placarAntes: '2x1',
      placarDepois: '3x1',
      canal: 'telegram',
    });
  });

  it('NUNCA lança em erro de banco', async () => {
    auditoriaCreate.mockRejectedValue(new Error('db down'));
    await expect(
      gravarAuditoriaPalpite({ usuarioId: 'u', jogoId: 'j', bolaoId: 'b', acao: 'REGISTRADO' }),
    ).resolves.toBeUndefined();
  });
});

describe('contexto de auditoria', () => {
  it('set/get por usuário', () => {
    setContextoAuditoria('u1', 'Brasil 2x1 França', 'telegram');
    expect(getContextoAuditoria('u1')).toEqual({ texto: 'Brasil 2x1 França', canal: 'telegram' });
  });

  it('usuário sem contexto → null', () => {
    expect(getContextoAuditoria('u-desconhecido')).toBeNull();
  });

  it('mensagem nova sobrescreve a anterior', () => {
    setContextoAuditoria('u1', 'primeira', 'whatsapp');
    setContextoAuditoria('u1', 'segunda', 'telegram');
    expect(getContextoAuditoria('u1')?.texto).toBe('segunda');
  });
});
