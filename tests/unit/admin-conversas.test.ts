import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Comandos de consulta do dono (v3.60.0): parse + resolução de alvo +
 * interceptação (só dono) + formatação das respostas.
 */

vi.mock('../../src/config/env.js', () => ({
  env: {
    DRY_RUN_WHATSAPP: true,
    ENABLE_WHATSAPP: true,
    ENABLE_TELEGRAM: false,
    OWNER_WHATSAPP_IDS: '5511976135412',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'dry-run-key',
    EVOLUTION_INSTANCE: 'varbolao',
  },
}));

const { usuarioFindFirst, usuarioFindMany, conversaFindMany, auditoriaFindMany } = vi.hoisted(
  () => ({
    usuarioFindFirst: vi.fn(),
    usuarioFindMany: vi.fn(),
    conversaFindMany: vi.fn(),
    auditoriaFindMany: vi.fn(),
  }),
);

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    usuario: {
      findFirst: (...a: unknown[]) => usuarioFindFirst(...a),
      findMany: (...a: unknown[]) => usuarioFindMany(...a),
    },
    mensagemConversa: {
      findMany: (...a: unknown[]) => conversaFindMany(...a),
      create: vi.fn(),
    },
    palpiteAuditoria: {
      findMany: (...a: unknown[]) => auditoriaFindMany(...a),
      create: vi.fn(),
    },
  },
}));

vi.mock('../../src/config/redis.js', () => ({ redis: {} }));

import { parseConsultaCmd, tentarConsultaAdmin } from '../../src/whatsapp/admin-conversas.js';
import { drainCapturedMessages } from '../../src/whatsapp/evolution.client.js';

const DONO = '5511976135412@s.whatsapp.net';

beforeEach(() => {
  drainCapturedMessages();
  usuarioFindFirst.mockReset().mockResolvedValue(null);
  usuarioFindMany.mockReset().mockResolvedValue([]);
  conversaFindMany.mockReset().mockResolvedValue([]);
  auditoriaFindMany.mockReset().mockResolvedValue([]);
});

describe('parseConsultaCmd', () => {
  it('#CONVERSASGLOBAL sem N usa default 20', () => {
    expect(parseConsultaCmd('#CONVERSASGLOBAL')).toEqual({
      tipo: 'CONVERSAS_GLOBAL',
      limite: 20,
    });
  });

  it('#CONVERSASGLOBAL 50 respeita o N', () => {
    expect(parseConsultaCmd('#conversasglobal 50')).toEqual({
      tipo: 'CONVERSAS_GLOBAL',
      limite: 50,
    });
  });

  it('#CONVERSASGLOBAL 999 é capado em 100', () => {
    expect(parseConsultaCmd('#CONVERSASGLOBAL 999')?.limite).toBe(100);
  });

  it('#CONVERSAS com número e N', () => {
    expect(parseConsultaCmd('#CONVERSAS +5511912345678 30')).toEqual({
      tipo: 'CONVERSAS_USUARIO',
      alvo: '+5511912345678',
      limite: 30,
    });
  });

  it('#CONVERSAS com nome composto (sem N)', () => {
    expect(parseConsultaCmd('#conversas Maria Silva')).toEqual({
      tipo: 'CONVERSAS_USUARIO',
      alvo: 'Maria Silva',
      limite: 20,
    });
  });

  it('#AUDITORIA com nome', () => {
    expect(parseConsultaCmd('#AUDITORIA Rafael 10')).toEqual({
      tipo: 'AUDITORIA',
      alvo: 'Rafael',
      limite: 10,
    });
  });

  it('não intercepta mensagem normal', () => {
    expect(parseConsultaCmd('ranking')).toBeNull();
    expect(parseConsultaCmd('quero ver as conversas')).toBeNull();
    expect(parseConsultaCmd('#CLASSIFICADO WC2026_R32_73 CASA')).toBeNull();
  });
});

describe('tentarConsultaAdmin', () => {
  it('não-dono é ignorado (não vaza o comando)', async () => {
    const tratou = await tentarConsultaAdmin({ waId: '5511888888888', text: '#CONVERSASGLOBAL' });
    expect(tratou).toBe(false);
    expect(drainCapturedMessages()).toHaveLength(0);
  });

  it('dono + #CONVERSASGLOBAL lista com nome de quem mandou', async () => {
    conversaFindMany.mockResolvedValue([
      {
        criadoEm: new Date('2026-07-01T18:32:00Z'),
        direcao: 'ENTRADA',
        canal: 'telegram',
        texto: 'Brasil 2x1 França',
        waId: '5511912345678',
        usuario: { nome: 'Rafael' },
      },
      {
        criadoEm: new Date('2026-07-01T18:32:10Z'),
        direcao: 'SAIDA',
        canal: 'telegram',
        texto: 'Confere teu palpite…',
        waId: '5511912345678',
        usuario: { nome: 'Rafael' },
      },
    ]);
    const tratou = await tentarConsultaAdmin({ waId: DONO, text: '#CONVERSASGLOBAL 2' });
    expect(tratou).toBe(true);
    const sent = drainCapturedMessages();
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('👤 Rafael Brasil 2x1 França');
    expect(sent[0].text).toContain('🤖 Confere teu palpite…');
  });

  it('#CONVERSAS por número resolve por variantes (9º dígito)', async () => {
    usuarioFindFirst.mockResolvedValue({
      id: 'u1',
      nome: 'Rafael',
      whatsappId: '5511912345678@s.whatsapp.net',
    });
    conversaFindMany.mockResolvedValue([]);
    await tentarConsultaAdmin({ waId: DONO, text: '#CONVERSAS +55 11 91234-5678' });
    const arg = usuarioFindFirst.mock.calls[0][0] as { where: { whatsappId: { in: string[] } } };
    expect(arg.where.whatsappId.in).toContain('5511912345678');
    expect(arg.where.whatsappId.in).toContain('551112345678'); // sem o 9
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('Sem mensagens de *Rafael*');
  });

  it('#CONVERSAS por nome com vários matches pede refino', async () => {
    usuarioFindMany.mockResolvedValue([
      { id: 'u1', nome: 'Rafael A', whatsappId: 'x' },
      { id: 'u2', nome: 'Rafaela B', whatsappId: 'y' },
    ]);
    await tentarConsultaAdmin({ waId: DONO, text: '#CONVERSAS Rafa' });
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('mais de um');
    expect(sent[0].text).toContain('Rafael A');
  });

  it('#AUDITORIA formata registro/edição/apagamento com a msg original', async () => {
    usuarioFindMany.mockResolvedValue([{ id: 'u1', nome: 'Rafael', whatsappId: 'x' }]);
    auditoriaFindMany.mockResolvedValue([
      {
        acao: 'EDITADO',
        placarAntes: '2x1',
        placarDepois: '3x1',
        classificado: null,
        textoOriginal: 'corrigir Brasil 3x1 França',
        canal: 'telegram',
        criadoEm: new Date('2026-07-01T14:33:00Z'),
        jogo: { timeCasa: 'Brasil', timeVisitante: 'França', dataHora: new Date() },
      },
      {
        acao: 'REGISTRADO',
        placarAntes: null,
        placarDepois: '2x1',
        classificado: null,
        textoOriginal: 'Brasil 2x1 França',
        canal: 'whatsapp',
        criadoEm: new Date('2026-07-01T14:32:00Z'),
        jogo: { timeCasa: 'Brasil', timeVisitante: 'França', dataHora: new Date() },
      },
    ]);
    await tentarConsultaAdmin({ waId: DONO, text: '#AUDITORIA Rafael' });
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('EDITOU 2x1 → 3x1');
    expect(sent[0].text).toContain('REGISTROU 2x1');
    expect(sent[0].text).toContain('"corrigir Brasil 3x1 França"');
    expect(sent[0].text).toContain('via telegram');
  });

  it('alvo não encontrado responde amigável', async () => {
    usuarioFindMany.mockResolvedValue([]);
    await tentarConsultaAdmin({ waId: DONO, text: '#AUDITORIA Zé' });
    const sent = drainCapturedMessages();
    expect(sent[0].text).toContain('Não achei');
  });
});
