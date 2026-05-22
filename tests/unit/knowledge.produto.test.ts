import { describe, it, expect } from 'vitest';
import { KNOWLEDGE_PRODUTO } from '../../src/llm/knowledge.produto.js';
import { PONTUACAO_PADRAO } from '../../src/modules/ranking/ranking.types.js';

/**
 * v3.6.0 — Knowledge base do produto injetado no system prompt do
 * conversational responder. Testes garantem que NAO ha drift entre o
 * texto do knowledge e os fatos canonicos do codigo (PONTUACAO_PADRAO,
 * comandos, etc).
 *
 * Cada teste cobre um fato verificavel — se mudar pontuacao em
 * ranking.types.ts ou um comando em message.parser.ts e esquecer de
 * atualizar knowledge.produto.ts, o teste correspondente quebra.
 */

describe('KNOWLEDGE_PRODUTO — fatos canônicos do produto', () => {
  it('inclui cabeçalho [REGRAS DO BOT] e marcador de fim', () => {
    expect(KNOWLEDGE_PRODUTO).toMatch(/\[REGRAS DO BOT/i);
    expect(KNOWLEDGE_PRODUTO).toMatch(/\[FIM DAS REGRAS DO BOT\]/i);
  });

  it('pontuação bate com PONTUACAO_PADRAO (sem drift do código)', () => {
    expect(PONTUACAO_PADRAO.placarExato).toBe(10);
    expect(PONTUACAO_PADRAO.resultadoMaisGols).toBe(7);
    expect(PONTUACAO_PADRAO.resultadoCerto).toBe(5);
    expect(PONTUACAO_PADRAO.golsDeUmTime).toBe(3);
    expect(PONTUACAO_PADRAO.errouTudo).toBe(0);
    // E o knowledge tem que mencionar cada um:
    expect(KNOWLEDGE_PRODUTO).toContain('10 pts');
    expect(KNOWLEDGE_PRODUTO).toContain('7 pts');
    expect(KNOWLEDGE_PRODUTO).toContain('5 pts');
    expect(KNOWLEDGE_PRODUTO).toContain('3 pts');
    expect(KNOWLEDGE_PRODUTO).toContain('0 pts');
  });

  it('cobre multi-palpite (motivo original da v3.6.0)', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('multi-palpite');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/v[áa]rios palpites/);
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/(v[ií]rgula|separados|linhas)/);
  });

  it('cobre editar e apagar palpite', () => {
    expect(KNOWLEDGE_PRODUTO).toContain('corrigir palpite');
    expect(KNOWLEDGE_PRODUTO).toContain('apagar palpite');
  });

  it('cobre prazo de palpite (até kickoff)', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('kickoff');
  });

  it('cobre ranking + critério de desempate', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('ranking');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/desempat/);
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/(hora|hourly|a cada)/);
  });

  it('cobre multi-bolão e bolão padrão', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/v[áa]rios bol[õo]es/);
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('bolão padrão');
  });

  it('cobre admin / convite / ID curto (não senha)', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('admin');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/(convido|convidar|wa\.me)/);
    expect(KNOWLEDGE_PRODUTO).toMatch(/#[A-Z0-9]{2,}/); // ID curto
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/n[ãa]o usam senha|n[ãa]o.*senha/);
  });

  it('cobre custo (grátis)', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/gr[áa]tis/);
  });

  it('cobre escopo: Copa 2026 + recusa de outros campeonatos', () => {
    expect(KNOWLEDGE_PRODUTO).toMatch(/Copa.*2026/i);
    // Lista explícita do que o bot NÃO faz
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/n[ãa]o cobre/);
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('brasileirão');
  });

  it('cobre privacidade: palpite privado', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('privado');
  });

  it('lista comandos principais (próximos jogos / mais jogos / ranking / regras)', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('próximos jogos');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('mais jogos');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('ranking');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('regras');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('meus bolões');
  });

  it('v3.8.0 — cobre comandos progresso do bolão + cutucar pendentes', () => {
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('progresso do bolão');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toContain('cutucar pendentes');
    // cita que placar continua privado
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/placar.*privado/);
  });

  it('v3.8.0 — tem legenda de emoji (resolve "por que Fulano tem emoji?")', () => {
    expect(KNOWLEDGE_PRODUTO.toUpperCase()).toContain('LEGENDA DE EMOJI');
    // 👑 e a explicação dele
    expect(KNOWLEDGE_PRODUTO).toContain('👑');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/admin do bol[ãa]o/);
    // ⭐ pra bolão padrão
    expect(KNOWLEDGE_PRODUTO).toContain('⭐');
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/bol[ãa]o padr[ãa]o/);
    // Esclarece que outros emojis no nome são parte do cadastro do user
    expect(KNOWLEDGE_PRODUTO.toLowerCase()).toMatch(/parte do nome/);
    expect(KNOWLEDGE_PRODUTO).toContain('🍀');
  });

  it('tamanho cabe num system prompt sem inflar custo (estimativa <1500 tokens ~= <6000 chars)', () => {
    expect(KNOWLEDGE_PRODUTO.length).toBeLessThan(6000);
    expect(KNOWLEDGE_PRODUTO.length).toBeGreaterThan(800); // não pode estar vazio/superficial
  });
});

describe('RESPONDER_PROMPT inclui KNOWLEDGE_PRODUTO', () => {
  it('o prompt do responder embute o knowledge inteiro', async () => {
    // Importação dinâmica via leitura do arquivo — evita acoplar a interna
    // do módulo (que não exporta RESPONDER_PROMPT)
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../src/llm/conversational.responder.ts', import.meta.url),
      'utf-8',
    );
    expect(src).toContain('KNOWLEDGE_PRODUTO');
    expect(src).toMatch(/\$\{KNOWLEDGE_PRODUTO\}/);
  });
});
