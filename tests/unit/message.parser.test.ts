import { describe, it, expect } from 'vitest';
import { parseIntencao, parseMultiplePalpites, Intencao } from '../../src/whatsapp/message.parser.js';
import { parecePalpiteIncompleto } from '../../src/whatsapp/palpite.heuristics.js';

describe('v3.37.0 — separadores × (unicode) e "c" (typo de x), revisão diária 14/06', () => {
  it('"Holanda 2 × 2 Japão" (× unicode) → PALPITE_INLINE', () => {
    const p = parseIntencao('Holanda 2 × 2 Japão');
    expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
    expect(p.palpite).toMatchObject({ timeCasa: 'Holanda', golsCasa: 2, golsVisitante: 2, timeVisitante: 'Japão' });
  });
  it('"Holanda 2 c 2 Japão" (c = typo de x) → PALPITE_INLINE', () => {
    const p = parseIntencao('Holanda 2 c 2 Japão');
    expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
    expect(p.palpite).toMatchObject({ golsCasa: 2, golsVisitante: 2 });
  });
  it('"Brasil 2x1 Marrocos" (x normal) continua funcionando', () => {
    expect(parseIntencao('Brasil 2x1 Marrocos').intencao).toBe(Intencao.PALPITE_INLINE);
  });
  it('"as 2 da tarde" NÃO vira palpite (sem âncora NxN)', () => {
    expect(parseIntencao('as 2 da tarde').intencao).not.toBe(Intencao.PALPITE_INLINE);
  });
});

describe('parecePalpiteIncompleto (v3.37.0 — "Espanha 4x1", um time só)', () => {
  it('detecta time + placar sem adversário', () => {
    expect(parecePalpiteIncompleto('Espanha 4x1')).toEqual({ time: 'Espanha', placar: '4x1' });
  });
  it('detecta com "a"/× e pontuação final', () => {
    expect(parecePalpiteIncompleto('Brasil 2 a 1.')).toEqual({ time: 'Brasil', placar: '2x1' });
    expect(parecePalpiteIncompleto('Holanda 2 × 0')).toEqual({ time: 'Holanda', placar: '2x0' });
  });
  it('palpite COMPLETO (2 times) NÃO é incompleto', () => {
    expect(parecePalpiteIncompleto('Espanha 4x1 Japão')).toBeNull();
  });
  it('LOTE (2+ placares) NÃO é incompleto', () => {
    expect(parecePalpiteIncompleto('Espanha 4x1, Brasil 2x0')).toBeNull();
  });
  it('texto sem placar NÃO é incompleto', () => {
    expect(parecePalpiteIncompleto('quando começa a Espanha')).toBeNull();
    expect(parecePalpiteIncompleto('meus pontos')).toBeNull();
  });
});

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

  describe('v3.38.0 — ESTATISTICA_PONTOS (quebra por faixa)', () => {
    // Caso real Humberto 22/06 — frases que ANTES caíam em PONTOS_DETALHE.
    const FRASES_ESTATISTICA = [
      'Quantos jogos eu fiz 10ponto',
      'quantos fiz 10 pontos',
      'De todos meus palpites, quantos eu acertei o placar exato e fiz 10 pontos?',
      'quantas cravadas eu fiz?',
      'quantos placares exatos acertei',
      'quantos de 7 pontos',
      'quantas vezes tirei 5 pontos',
      'quantas vezes eu zerei',
      'estatistica dos meus pontos',
      'resumo da minha pontuacao',
      'de onde vem meus pontos',
      'meu aproveitamento',
      'acertei em cheio quantas vezes',
    ];
    for (const frase of FRASES_ESTATISTICA) {
      it(`"${frase}" → ESTATISTICA_PONTOS`, () => {
        expect(parseIntencao(frase).intencao).toBe(Intencao.ESTATISTICA_PONTOS);
      });
    }

    // NÃO-REGRESSÃO: estatística não pode roubar PONTOS_DETALHE / MEUS_PONTOS / RANKING.
    it('"quantos pontos fiz ontem" continua PONTOS_DETALHE', () => {
      expect(parseIntencao('quantos pontos fiz ontem').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    it('"quantos pontos fiz hoje" continua PONTOS_DETALHE', () => {
      expect(parseIntencao('quantos pontos fiz hoje').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    it('"meus pontos" continua MEUS_PONTOS', () => {
      expect(parseIntencao('meus pontos').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"quantos pontos eu tenho" continua MEUS_PONTOS', () => {
      expect(parseIntencao('quantos pontos eu tenho').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"ranking" continua RANKING', () => {
      expect(parseIntencao('ranking').intencao).toBe(Intencao.RANKING);
    });
  });

  describe('v3.39.0 — JOGOS_POR_FAIXA (drill-down: listar jogos da faixa)', () => {
    // Caso real Humberto 22/06: "Quais jogos eu cravei?" caía no handler genérico.
    const FRASES_JOGOS_FAIXA = [
      'Quais jogos eu cravei?',
      'quais cravei',
      'me mostra as cravadas',
      'quais jogos acertei o placar exato',
      'em quais cravei o placar',
      'quais jogos fiz 7 pontos?',
      'quais deram 5',
      'me mostra os de 3 pontos',
      'quais jogos eu zerei?',
      'em quais errei tudo',
      'quais fiz 10 pontos',
      'quais valeram 7',
    ];
    for (const frase of FRASES_JOGOS_FAIXA) {
      it(`"${frase}" → JOGOS_POR_FAIXA`, () => {
        expect(parseIntencao(frase).intencao).toBe(Intencao.JOGOS_POR_FAIXA);
      });
    }

    // NÃO-REGRESSÃO: contagem continua ESTATISTICA; demais intents intactas.
    it('"quantas cravadas eu fiz?" continua ESTATISTICA_PONTOS (contagem)', () => {
      expect(parseIntencao('quantas cravadas eu fiz?').intencao).toBe(Intencao.ESTATISTICA_PONTOS);
    });
    it('"quantos fiz 7 pontos" continua ESTATISTICA_PONTOS (contagem)', () => {
      expect(parseIntencao('quantos fiz 7 pontos').intencao).toBe(Intencao.ESTATISTICA_PONTOS);
    });
    it('"estatística dos meus pontos" continua ESTATISTICA_PONTOS', () => {
      expect(parseIntencao('estatística dos meus pontos').intencao).toBe(Intencao.ESTATISTICA_PONTOS);
    });
    it('"meus palpites" continua MEU_PALPITE', () => {
      expect(parseIntencao('meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"quantos pontos fiz ontem" continua PONTOS_DETALHE', () => {
      expect(parseIntencao('quantos pontos fiz ontem').intencao).toBe(Intencao.PONTOS_DETALHE);
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

  describe('variantes naturais — MEU_PALPITE', () => {
    it('"quais sao meus palpites?"', () => {
      expect(parseIntencao('quais sao meus palpites?').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"quais são meus palpites" (com acento)', () => {
      expect(parseIntencao('quais são meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"o que eu palpitei?"', () => {
      expect(parseIntencao('o que eu palpitei?').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"o que chutei"', () => {
      expect(parseIntencao('o que chutei').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"ver meus palpites"', () => {
      expect(parseIntencao('ver meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
  });

  describe('variantes naturais — PROXIMOS_JOGOS', () => {
    it('"proximos jogos"', () => {
      expect(parseIntencao('proximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"próximos jogos" (com acento)', () => {
      expect(parseIntencao('próximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"quais ainda nao palpitei"', () => {
      expect(parseIntencao('quais ainda nao palpitei').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"o que falta palpitar"', () => {
      expect(parseIntencao('o que falta palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"quero palpitar"', () => {
      expect(parseIntencao('quero palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"bora palpitar"', () => {
      expect(parseIntencao('bora palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"jogos pendentes"', () => {
      expect(parseIntencao('jogos pendentes').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });

    describe('v3.28.0 — "próximos jogos" + pergunta de horário NÃO vira listagem', () => {
      it('"próximos jogos quando?" → NÃO é PROXIMOS_JOGOS', () => {
        expect(parseIntencao('próximos jogos quando?').intencao).not.toBe(Intencao.PROXIMOS_JOGOS);
      });
      it('"proximos jogos que dia" → NÃO é PROXIMOS_JOGOS', () => {
        expect(parseIntencao('proximos jogos que dia').intencao).not.toBe(Intencao.PROXIMOS_JOGOS);
      });
      it('"próximos jogos onde" → NÃO é PROXIMOS_JOGOS', () => {
        expect(parseIntencao('próximos jogos onde').intencao).not.toBe(Intencao.PROXIMOS_JOGOS);
      });
      it('"próximos jogos" puro continua PROXIMOS_JOGOS', () => {
        expect(parseIntencao('próximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
      });
    });
  });

  describe('variantes naturais — MAIS_JOGOS (v3.5.0 paginação)', () => {
    it('"mais jogos"', () => {
      expect(parseIntencao('mais jogos').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"mais palpites"', () => {
      expect(parseIntencao('mais palpites').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"próximos 10 jogos"', () => {
      expect(parseIntencao('próximos 10 jogos').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"outros jogos"', () => {
      expect(parseIntencao('outros jogos').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"tem mais jogos?"', () => {
      expect(parseIntencao('tem mais jogos?').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"quero ver mais"', () => {
      expect(parseIntencao('quero ver mais').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"continuar palpitando"', () => {
      expect(parseIntencao('continuar palpitando').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    it('"ver mais"', () => {
      expect(parseIntencao('ver mais').intencao).toBe(Intencao.MAIS_JOGOS);
    });
    // MAIS_JOGOS precisa ter precedência sobre PROXIMOS_JOGOS — se cair em
    // PROXIMOS_JOGOS, reseta offset e a paginação quebra.
    it('"mais jogos" NÃO cai em PROXIMOS_JOGOS', () => {
      expect(parseIntencao('mais jogos').intencao).not.toBe(Intencao.PROXIMOS_JOGOS);
    });
  });

  describe('variantes naturais — MEUS_PONTOS', () => {
    it('"quanto eu fiz"', () => {
      expect(parseIntencao('quanto eu fiz').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"meu placar"', () => {
      expect(parseIntencao('meu placar').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"estou em qual posicao"', () => {
      expect(parseIntencao('estou em qual posicao').intencao).toBe(Intencao.MEUS_PONTOS);
    });
  });

  describe('variantes naturais — CRIAR_BOLAO', () => {
    it('"quero abrir um bolao"', () => {
      expect(parseIntencao('quero abrir um bolao').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('"bora criar bolão"', () => {
      expect(parseIntencao('bora criar bolão').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('"vamos montar um bolao"', () => {
      expect(parseIntencao('vamos montar um bolao').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    // v3.40.0 — pergunta com verbo de criação (revisão diária 22/06).
    it('caso real: "como posso fazer um bolao da minha familia?"', () => {
      expect(parseIntencao('como posso fazer um bolao da minha familia?').intencao).toBe(
        Intencao.CRIAR_BOLAO,
      );
    });
    it('"como crio um bolão?"', () => {
      expect(parseIntencao('como crio um bolão?').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('"como abro um bolão?"', () => {
      expect(parseIntencao('como abro um bolão?').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    it('imperativo "faz um bolão pra família"', () => {
      expect(parseIntencao('faz um bolão pra família').intencao).toBe(Intencao.CRIAR_BOLAO);
    });
    // NÃO-REGRESSÃO: "como funciona o bolão" (sem verbo de criação) → AJUDA.
    it('"como funciona o bolão" continua AJUDA (não CRIAR_BOLAO)', () => {
      expect(parseIntencao('como funciona o bolão').intencao).toBe(Intencao.AJUDA);
    });
  });

  describe('variantes naturais — ENTRAR_BOLAO', () => {
    it('"quero participar"', () => {
      expect(parseIntencao('quero participar').intencao).toBe(Intencao.ENTRAR_BOLAO);
    });
    it('"quero entrar num bolao"', () => {
      expect(parseIntencao('quero entrar num bolao').intencao).toBe(Intencao.ENTRAR_BOLAO);
    });
    it('"quero jogar"', () => {
      expect(parseIntencao('quero jogar').intencao).toBe(Intencao.ENTRAR_BOLAO);
    });
  });

  describe('variantes naturais — MEUS_BOLOES', () => {
    it('"quais sao meus boloes"', () => {
      expect(parseIntencao('quais sao meus boloes').intencao).toBe(Intencao.MEUS_BOLOES);
    });
    it('"onde eu participo"', () => {
      expect(parseIntencao('onde eu participo').intencao).toBe(Intencao.MEUS_BOLOES);
    });
  });

  describe('variantes naturais — RANKING', () => {
    it('"classificacao"', () => {
      expect(parseIntencao('classificacao').intencao).toBe(Intencao.RANKING);
    });
    it('"quem ta na frente"', () => {
      expect(parseIntencao('quem ta na frente').intencao).toBe(Intencao.RANKING);
    });
  });

  describe('variantes naturais — JOGOS_HOJE', () => {
    it('"tem jogo hoje?"', () => {
      expect(parseIntencao('tem jogo hoje?').intencao).toBe(Intencao.JOGOS_HOJE);
    });
    it('"o que tem hoje"', () => {
      expect(parseIntencao('o que tem hoje').intencao).toBe(Intencao.JOGOS_HOJE);
    });
    it('"agenda"', () => {
      expect(parseIntencao('agenda').intencao).toBe(Intencao.JOGOS_HOJE);
    });
  });

  describe('PROXIMOS_JOGOS — acao de palpitar (Bug feedback 14/05)', () => {
    it('"quero dar palpites" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('quero dar palpites').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"quero fazer palpites" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('quero fazer palpites').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"vou palpitar" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('vou palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"vamos palpitar" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('vamos palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"bora dar uns palpites" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('bora dar uns palpites').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"preciso registrar palpites" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('preciso registrar palpites').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"deixa eu palpitar" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('deixa eu palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"deixa eu dar uns palpites" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('deixa eu dar uns palpites').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"palpitar nos jogos" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('palpitar nos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"vou fazer um palpite" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('vou fazer um palpite').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    // Regressao garantida
    it('REGRESSAO: "meus palpites" continua MEU_PALPITE', () => {
      expect(parseIntencao('meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('REGRESSAO: "ver meus palpites" continua MEU_PALPITE', () => {
      expect(parseIntencao('ver meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('REGRESSAO: "palpites" sozinho continua PALPITES_AMBIGUO', () => {
      expect(parseIntencao('palpites').intencao).toBe(Intencao.PALPITES_AMBIGUO);
    });
  });

  describe('PROXIMOS_JOGOS — ordem invertida (Bug 4)', () => {
    it('"quais os jogos próximos?"', () => {
      expect(parseIntencao('quais os jogos próximos?').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"jogos proximos"', () => {
      expect(parseIntencao('jogos proximos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"lista de jogos"', () => {
      expect(parseIntencao('lista de jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"me mostra os jogos"', () => {
      expect(parseIntencao('me mostra os jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
  });

  describe('saudacao prefixada (P11)', () => {
    it('"oi, quais os proximos jogos?" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('oi, quais os proximos jogos?').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"opa bolão!!! quais os próximos jogos?" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('opa bolão!!! quais os próximos jogos?').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"oi, ranking" → RANKING', () => {
      expect(parseIntencao('oi, ranking').intencao).toBe(Intencao.RANKING);
    });
    it('"oi" sozinho continua SAUDACAO', () => {
      expect(parseIntencao('oi').intencao).toBe(Intencao.SAUDACAO);
    });
  });

  describe('ABRIR_RODADA', () => {
    it('"abrir rodada"', () => {
      expect(parseIntencao('abrir rodada').intencao).toBe(Intencao.ABRIR_RODADA);
    });
    it('"abrir rodada para palpites"', () => {
      expect(parseIntencao('abrir rodada para palpites').intencao).toBe(Intencao.ABRIR_RODADA);
    });
    it('"iniciar rodada"', () => {
      expect(parseIntencao('iniciar rodada').intencao).toBe(Intencao.ABRIR_RODADA);
    });
    it('"como inicio a rodada?"', () => {
      expect(parseIntencao('como inicio a rodada?').intencao).toBe(Intencao.ABRIR_RODADA);
    });
  });

  describe('COMO_CONVIDAR', () => {
    it('"como convido pessoas?"', () => {
      expect(parseIntencao('como convido pessoas?').intencao).toBe(Intencao.COMO_CONVIDAR);
    });
    it('"como compartilho o bolão"', () => {
      expect(parseIntencao('como compartilho o bolão').intencao).toBe(Intencao.COMO_CONVIDAR);
    });
    it('"convidar pessoas pro Bolao da Jeni"', () => {
      expect(parseIntencao('convidar pessoas pro Bolao da Jeni').intencao).toBe(Intencao.COMO_CONVIDAR);
    });
    it('"quero convidar amigos"', () => {
      expect(parseIntencao('quero convidar amigos').intencao).toBe(Intencao.COMO_CONVIDAR);
    });
    it('"mandar convite"', () => {
      expect(parseIntencao('mandar convite').intencao).toBe(Intencao.COMO_CONVIDAR);
    });
  });

  describe('SAIR_BOLAO', () => {
    it('"sair do bolão"', () => {
      expect(parseIntencao('sair do bolão').intencao).toBe(Intencao.SAIR_BOLAO);
    });
    it('"quero sair"', () => {
      expect(parseIntencao('quero sair').intencao).toBe(Intencao.SAIR_BOLAO);
    });
    it('"me remove"', () => {
      expect(parseIntencao('me remove').intencao).toBe(Intencao.SAIR_BOLAO);
    });
  });

  describe('QUEM_PARTICIPA', () => {
    it('"quem participa"', () => {
      expect(parseIntencao('quem participa').intencao).toBe(Intencao.QUEM_PARTICIPA);
    });
    it('"quem ta no bolão"', () => {
      expect(parseIntencao('quem ta no bolão').intencao).toBe(Intencao.QUEM_PARTICIPA);
    });
    it('"lista de participantes"', () => {
      expect(parseIntencao('lista de participantes').intencao).toBe(Intencao.QUEM_PARTICIPA);
    });
  });

  describe('REGRAS / PALPITES_AMBIGUO', () => {
    it('"regras" → REGRAS', () => {
      expect(parseIntencao('regras').intencao).toBe(Intencao.REGRAS);
    });
    it('"regras do bolão" → REGRAS', () => {
      expect(parseIntencao('regras do bolão').intencao).toBe(Intencao.REGRAS);
    });
    it('"como pontua" → REGRAS', () => {
      expect(parseIntencao('como pontua').intencao).toBe(Intencao.REGRAS);
    });
    it('"como funciona a pontuação" → REGRAS', () => {
      expect(parseIntencao('como funciona a pontuação').intencao).toBe(Intencao.REGRAS);
    });
    it('"palpites" sozinho → PALPITES_AMBIGUO', () => {
      expect(parseIntencao('palpites').intencao).toBe(Intencao.PALPITES_AMBIGUO);
    });
    it('"palpite" sozinho → PALPITES_AMBIGUO', () => {
      expect(parseIntencao('palpite').intencao).toBe(Intencao.PALPITES_AMBIGUO);
    });
    it('"palpites?" com pontuacao → PALPITES_AMBIGUO', () => {
      expect(parseIntencao('palpites?').intencao).toBe(Intencao.PALPITES_AMBIGUO);
    });
    it('"meus palpites" continua MEU_PALPITE (mais especifico vence)', () => {
      expect(parseIntencao('meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"como funciona" sem "pontuação" → AJUDA', () => {
      expect(parseIntencao('como funciona').intencao).toBe(Intencao.AJUDA);
    });
  });

  describe('PENDENTES coloquial (bug descoberto na simulacao)', () => {
    it('"tem pedido pra aprovar?" → PENDENTES (nao APROVAR_NOMEADO)', () => {
      expect(parseIntencao('tem pedido pra aprovar?').intencao).toBe(Intencao.PENDENTES);
    });
    it('"aprovações pendentes?" → PENDENTES', () => {
      expect(parseIntencao('aprovações pendentes?').intencao).toBe(Intencao.PENDENTES);
    });
    it('"tem alguém querendo entrar" → PENDENTES', () => {
      expect(parseIntencao('tem alguém querendo entrar').intencao).toBe(Intencao.PENDENTES);
    });
  });

  describe('Multi-palpite em IDLE (bug descoberto na simulacao)', () => {
    it('multilinha com placar valido em todas → PALPITE_INLINE', () => {
      const r = parseIntencao('Brasil 2x1 Marrocos\nFrança 1x0 Argentina\nAlemanha 3x2 Espanha');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toBeDefined();
    });
    it('multilinha com lixo + 1 palpite valido → PALPITE_INLINE', () => {
      const r = parseIntencao('blablabla\nBrasil 2x1 Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
    });
  });

  describe('INFO_SENHA (ISSUE-005)', () => {
    it('"qual a senha?" → INFO_SENHA', () => {
      expect(parseIntencao('qual a senha?').intencao).toBe(Intencao.INFO_SENHA);
    });
    it('"qual senha do bolao" → INFO_SENHA', () => {
      expect(parseIntencao('qual senha do bolao').intencao).toBe(Intencao.INFO_SENHA);
    });
    it('"esqueci a senha" → INFO_SENHA', () => {
      expect(parseIntencao('esqueci a senha').intencao).toBe(Intencao.INFO_SENHA);
    });
    it('"não lembro a senha" → INFO_SENHA', () => {
      expect(parseIntencao('não lembro a senha').intencao).toBe(Intencao.INFO_SENHA);
    });
    it('"me passa a senha" → INFO_SENHA', () => {
      expect(parseIntencao('me passa a senha').intencao).toBe(Intencao.INFO_SENHA);
    });
    it('"como pego a senha" → INFO_SENHA', () => {
      expect(parseIntencao('como pego a senha').intencao).toBe(Intencao.INFO_SENHA);
    });
  });

  describe('EXCLUIR_BOLAO (ISSUE-006)', () => {
    it('"excluir bolão" → EXCLUIR_BOLAO', () => {
      expect(parseIntencao('excluir bolão').intencao).toBe(Intencao.EXCLUIR_BOLAO);
    });
    it('"deletar meu bolao" → EXCLUIR_BOLAO', () => {
      expect(parseIntencao('deletar meu bolao').intencao).toBe(Intencao.EXCLUIR_BOLAO);
    });
    it('"quero excluir o bolão" → EXCLUIR_BOLAO', () => {
      expect(parseIntencao('quero excluir o bolão').intencao).toBe(Intencao.EXCLUIR_BOLAO);
    });
    it('"encerrar bolão" → EXCLUIR_BOLAO', () => {
      expect(parseIntencao('encerrar bolão').intencao).toBe(Intencao.EXCLUIR_BOLAO);
    });
    it('"apagar bolao" → EXCLUIR_BOLAO', () => {
      expect(parseIntencao('apagar bolao').intencao).toBe(Intencao.EXCLUIR_BOLAO);
    });
    it('"sair do bolão" continua SAIR_BOLAO (nao excluir)', () => {
      expect(parseIntencao('sair do bolão').intencao).toBe(Intencao.SAIR_BOLAO);
    });
  });

  describe('Sprint 2 — INFO_PRODUTO (ISSUE-009)', () => {
    it('"o que é esse bot?" → INFO_PRODUTO', () => {
      expect(parseIntencao('o que é esse bot?').intencao).toBe(Intencao.INFO_PRODUTO);
    });
    it('"pra que serve" → INFO_PRODUTO', () => {
      expect(parseIntencao('pra que serve').intencao).toBe(Intencao.INFO_PRODUTO);
    });
    it('"sobre o var" → INFO_PRODUTO', () => {
      expect(parseIntencao('sobre o var').intencao).toBe(Intencao.INFO_PRODUTO);
    });
    it('"como funciona" → AJUDA (genérico, regressão)', () => {
      expect(parseIntencao('como funciona').intencao).toBe(Intencao.AJUDA);
    });
  });

  describe('Sprint 2 — INFO_PRECO (ISSUE-010)', () => {
    it('"quanto custa" → INFO_PRECO', () => {
      expect(parseIntencao('quanto custa').intencao).toBe(Intencao.INFO_PRECO);
    });
    it('"é grátis?" → INFO_PRECO', () => {
      expect(parseIntencao('é grátis?').intencao).toBe(Intencao.INFO_PRECO);
    });
    it('"tem que pagar?" → INFO_PRECO', () => {
      expect(parseIntencao('tem que pagar?').intencao).toBe(Intencao.INFO_PRECO);
    });
    it('"qual o preço do bolão?" → INFO_PRECO', () => {
      expect(parseIntencao('qual o preço do bolão?').intencao).toBe(Intencao.INFO_PRECO);
    });
  });

  describe('Sprint 2 — COMO_PALPITAR (ISSUE-017)', () => {
    it('"como dou palpite?" → COMO_PALPITAR', () => {
      expect(parseIntencao('como dou palpite?').intencao).toBe(Intencao.COMO_PALPITAR);
    });
    it('"como palpitar" → COMO_PALPITAR', () => {
      expect(parseIntencao('como palpitar').intencao).toBe(Intencao.COMO_PALPITAR);
    });
    it('"qual o formato do palpite" → COMO_PALPITAR', () => {
      expect(parseIntencao('qual o formato do palpite').intencao).toBe(Intencao.COMO_PALPITAR);
    });
    it('"quero palpitar" continua PROXIMOS_JOGOS (regressão)', () => {
      expect(parseIntencao('quero palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
  });

  describe('Sprint 2 — QUANDO_COMECA (ISSUE-018)', () => {
    it('"quando começa?" → QUANDO_COMECA', () => {
      expect(parseIntencao('quando começa?').intencao).toBe(Intencao.QUANDO_COMECA);
    });
    it('"quando termina" → QUANDO_COMECA', () => {
      expect(parseIntencao('quando termina').intencao).toBe(Intencao.QUANDO_COMECA);
    });
    it('"que dia abre rodada" → QUANDO_COMECA', () => {
      expect(parseIntencao('que dia abre rodada').intencao).toBe(Intencao.QUANDO_COMECA);
    });
  });

  describe('Sprint 2 — EDITAR_PALPITE (ISSUE-011)', () => {
    it('"corrigir palpite" → EDITAR_PALPITE', () => {
      expect(parseIntencao('corrigir palpite').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"mudar palpite" → EDITAR_PALPITE', () => {
      expect(parseIntencao('mudar palpite').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"errei o palpite" → EDITAR_PALPITE', () => {
      expect(parseIntencao('errei o palpite').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    // v3.40.0 — "refazer"/"refaz" sozinho (revisão diária 22/06).
    it('caso real: "refazer" sozinho → EDITAR_PALPITE', () => {
      expect(parseIntencao('refazer').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"refaz" sozinho → EDITAR_PALPITE', () => {
      expect(parseIntencao('refaz').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"refazer Brasil 2x1 Marrocos" continua EDITAR_PALPITE', () => {
      expect(parseIntencao('refazer Brasil 2x1 Marrocos').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
  });

  describe('v3.40.0 — alias de autocorretor (MEU_PALPITE)', () => {
    it('caso real: "Meus olhares" → MEU_PALPITE', () => {
      expect(parseIntencao('Meus olhares').intencao).toBe(Intencao.MEU_PALPITE);
    });
  });

  describe('v3.8.0 — PROGRESSO_PALPITES', () => {
    it('"quem palpitou?" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('quem palpitou?').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"quem ja palpitou" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('quem ja palpitou').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"quem ainda nao palpitou?" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('quem ainda nao palpitou?').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"Mais gente registrou palpites?" (caso da Jeni 22/05) → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('Mais gente registrou palpites?').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"Quero ver se as pessoas que entraram registram algum palpite" (caso da Jeni 22/05) → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('Quero ver se as pessoas que entraram registram algum palpite').intencao).toBe(
        Intencao.PROGRESSO_PALPITES,
      );
    });
    it('"progresso do bolão" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('progresso do bolão').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"quem ta atrasado?" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('quem ta atrasado?').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    it('"quanto cada um palpitou?" → PROGRESSO_PALPITES', () => {
      expect(parseIntencao('quanto cada um palpitou?').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
    // Falsos positivos críticos: não pode virar MEU_PALPITE
    it('"quem palpitou" NÃO cai em MEU_PALPITE (que é "MEUS palpites")', () => {
      expect(parseIntencao('quem palpitou').intencao).not.toBe(Intencao.MEU_PALPITE);
    });
  });

  describe('v3.8.0 — CUTUCAR_PENDENTES', () => {
    it('"cutucar pendentes" → CUTUCAR_PENDENTES', () => {
      expect(parseIntencao('cutucar pendentes').intencao).toBe(Intencao.CUTUCAR_PENDENTES);
    });
    it('"cobrar palpites" → CUTUCAR_PENDENTES', () => {
      expect(parseIntencao('cobrar palpites').intencao).toBe(Intencao.CUTUCAR_PENDENTES);
    });
    it('"lembrar quem nao palpitou" → CUTUCAR_PENDENTES', () => {
      expect(parseIntencao('lembrar quem nao palpitou').intencao).toBe(Intencao.CUTUCAR_PENDENTES);
    });
    it('"chamar pendentes" → CUTUCAR_PENDENTES', () => {
      expect(parseIntencao('chamar pendentes').intencao).toBe(Intencao.CUTUCAR_PENDENTES);
    });
    // Precedência sobre PROGRESSO_PALPITES (mais específico)
    it('"cutucar pendentes" NÃO cai em PROGRESSO_PALPITES', () => {
      expect(parseIntencao('cutucar pendentes').intencao).not.toBe(Intencao.PROGRESSO_PALPITES);
    });
  });

  describe('v3.9.0 — DICAS_PALPITE (estratégia, não formato)', () => {
    it('"você tem dicas de como montar os palpites?" (caso Valéria 22/05) → DICAS_PALPITE', () => {
      expect(parseIntencao('você tem dicas de como montar os palpites?').intencao).toBe(
        Intencao.DICAS_PALPITE,
      );
    });
    it('"tem dicas?" → DICAS_PALPITE', () => {
      expect(parseIntencao('tem dicas?').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"dicas pra palpitar" → DICAS_PALPITE', () => {
      expect(parseIntencao('dicas pra palpitar').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"como eu monto um palpite?" → DICAS_PALPITE', () => {
      expect(parseIntencao('como eu monto um palpite?').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"como decido o placar?" → DICAS_PALPITE', () => {
      expect(parseIntencao('como decido o placar?').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"qual placar é mais comum?" → DICAS_PALPITE', () => {
      expect(parseIntencao('qual placar é mais comum?').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"tem estratégia?" → DICAS_PALPITE', () => {
      expect(parseIntencao('tem estratégia?').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    it('"me ensina a palpitar" → DICAS_PALPITE', () => {
      expect(parseIntencao('me ensina a palpitar').intencao).toBe(Intencao.DICAS_PALPITE);
    });
    // Anti-falso-positivo: COMO_PALPITAR continua sendo COMO_PALPITAR (formato)
    it('"como dou palpite" continua sendo COMO_PALPITAR (formato, não estratégia)', () => {
      expect(parseIntencao('como dou palpite').intencao).toBe(Intencao.COMO_PALPITAR);
    });
    it('"como faço palpite" continua sendo COMO_PALPITAR', () => {
      expect(parseIntencao('como faço palpite').intencao).toBe(Intencao.COMO_PALPITAR);
    });
  });

  describe('v3.9.0 — ACOLHIMENTO_NOVATO (vulnerabilidade)', () => {
    it('"nao entendo de futebol" (caso Valéria 22/05) → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('nao entendo de futebol').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"não entendo nada de futebol" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('não entendo nada de futebol').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"nao sei nada de futebol" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('nao sei nada de futebol').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"futebol não é minha praia" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('futebol não é minha praia').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"to perdida" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('to perdida').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"to perdido" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('to perdido').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"é minha primeira vez" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('é minha primeira vez').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"nunca palpitei" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('nunca palpitei').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"to com medo de errar" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('to com medo de errar').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"vou errar tudo" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('vou errar tudo').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    it('"sou leiga em bolão" → ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('sou leiga em bolão').intencao).toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
    // Anti-falso-positivo: "perdi minha senha" não cai em ACOLHIMENTO_NOVATO
    it('"perdi minha senha" NÃO cai em ACOLHIMENTO_NOVATO', () => {
      expect(parseIntencao('perdi minha senha').intencao).not.toBe(Intencao.ACOLHIMENTO_NOVATO);
    });
  });

  describe('v3.15.0 — PLACAR_JOGO (Copa rolando)', () => {
    it('"qual o placar?" → PLACAR_JOGO', () => {
      expect(parseIntencao('qual o placar?').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"quanto tá o jogo?" → PLACAR_JOGO', () => {
      expect(parseIntencao('quanto tá o jogo?').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"quem ganhou?" → PLACAR_JOGO', () => {
      expect(parseIntencao('quem ganhou?').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"como ficou o jogo do Brasil?" → PLACAR_JOGO', () => {
      expect(parseIntencao('como ficou o jogo do Brasil?').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"resultado de ontem" → PLACAR_JOGO', () => {
      expect(parseIntencao('resultado de ontem').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"ja acabou o jogo?" → PLACAR_JOGO', () => {
      expect(parseIntencao('ja acabou o jogo?').intencao).toBe(Intencao.PLACAR_JOGO);
    });
    it('"saiu o resultado?" → PLACAR_JOGO', () => {
      expect(parseIntencao('saiu o resultado?').intencao).toBe(Intencao.PLACAR_JOGO);
    });

    describe('v3.27.0 — jogo específico e finalizados (casos reais 11/06)', () => {
      it('"Qual foi placar de Mexico e Africa?" → PLACAR_JOGO (antes caía na LLM)', () => {
        expect(parseIntencao('Qual foi placar de Mexico e Africa?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"qual foi o resultado?" → PLACAR_JOGO', () => {
        expect(parseIntencao('qual foi o resultado?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"Quais jogos ja finalizaram?" → PLACAR_JOGO (antes caía na LLM)', () => {
        expect(parseIntencao('Quais jogos ja finalizaram?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"quais jogos já acabaram?" → PLACAR_JOGO', () => {
        expect(parseIntencao('quais jogos já acabaram?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"jogos finalizados" → PLACAR_JOGO', () => {
        expect(parseIntencao('jogos finalizados').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"jogos de ontem" → PLACAR_JOGO', () => {
        expect(parseIntencao('jogos de ontem').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"o que já rolou?" → PLACAR_JOGO', () => {
        expect(parseIntencao('o que já rolou?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"quem está ganhando?" → PLACAR_JOGO', () => {
        expect(parseIntencao('quem está ganhando?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"placar do México" → PLACAR_JOGO', () => {
        expect(parseIntencao('placar do México').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"placar dos demais participantes" NÃO é PLACAR_JOGO (é palpite dos outros)', () => {
        expect(parseIntencao('quais os placares dos demais participantes?').intencao).not.toBe(
          Intencao.PLACAR_JOGO,
        );
      });
    });

    describe('v3.32.0 — "rolando agora" (caso Humberto 11/06 23:49)', () => {
      it('"Quais jogos estao rolando?" → PLACAR_JOGO (antes caía na LLM "não sei")', () => {
        expect(parseIntencao('Quais jogos estao rolando?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"quais jogos estão acontecendo?" → PLACAR_JOGO', () => {
        expect(parseIntencao('quais jogos estão acontecendo?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"que jogos tão rolando" → PLACAR_JOGO', () => {
        expect(parseIntencao('que jogos tão rolando').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"tem jogo rolando?" → PLACAR_JOGO', () => {
        expect(parseIntencao('tem jogo rolando?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"tem algum jogo agora?" → PLACAR_JOGO', () => {
        expect(parseIntencao('tem algum jogo agora?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"jogos ao vivo" → PLACAR_JOGO', () => {
        expect(parseIntencao('jogos ao vivo').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"o que tá rolando agora?" → PLACAR_JOGO', () => {
        expect(parseIntencao('o que tá rolando agora?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"algum jogo acontecendo?" → PLACAR_JOGO', () => {
        expect(parseIntencao('algum jogo acontecendo?').intencao).toBe(Intencao.PLACAR_JOGO);
      });
    });

    describe('v3.21.0 — termos curtos/ambíguos (caso Bruna 11/06)', () => {
      it('"Placares de todos" → PLACAR_JOGO', () => {
        expect(parseIntencao('Placares de todos').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"placares" sozinho → PLACAR_JOGO', () => {
        expect(parseIntencao('placares').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"placar" sozinho → PLACAR_JOGO', () => {
        expect(parseIntencao('placar').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"Mostrar placar" → PLACAR_JOGO', () => {
        expect(parseIntencao('Mostrar placar').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"me mostra o placar" → PLACAR_JOGO', () => {
        expect(parseIntencao('me mostra o placar').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"resultados" sozinho → PLACAR_JOGO', () => {
        expect(parseIntencao('resultados').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      it('"como tão os placares" → PLACAR_JOGO', () => {
        expect(parseIntencao('como tão os placares').intencao).toBe(Intencao.PLACAR_JOGO);
      });
      // Anti-falsos-positivos
      it('"resultados foram bons" NÃO casa PLACAR_JOGO', () => {
        expect(parseIntencao('resultados foram bons').intencao).not.toBe(Intencao.PLACAR_JOGO);
      });
      it('"quero ver placar do palpite" continua roteando normalmente', () => {
        // Casa "placar" inicial mas é continuação, não ambíguo "placar sozinho"
        // Esse caso deve cair em PLACAR_JOGO (ok) ou outro — só não pode crashar
        expect(parseIntencao('quero ver placar do palpite').intencao).toBeDefined();
      });
    });
  });

  describe('v3.15.0 — PONTOS_DETALHE', () => {
    it('"quantos pontos eu fiz ontem?" → PONTOS_DETALHE (não MEUS_PONTOS)', () => {
      expect(parseIntencao('quantos pontos eu fiz ontem?').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    it('"acertei meu palpite?" → PONTOS_DETALHE', () => {
      expect(parseIntencao('acertei meu palpite?').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    it('"ganhei pontos?" → PONTOS_DETALHE', () => {
      expect(parseIntencao('ganhei pontos?').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    it('"pontos de ontem" → PONTOS_DETALHE', () => {
      expect(parseIntencao('pontos de ontem').intencao).toBe(Intencao.PONTOS_DETALHE);
    });
    // Anti-regressão: total geral continua MEUS_PONTOS
    it('"meus pontos" continua MEUS_PONTOS', () => {
      expect(parseIntencao('meus pontos').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"quanto eu fiz" (sem qualificador temporal) continua MEUS_PONTOS', () => {
      expect(parseIntencao('quanto eu fiz').intencao).toBe(Intencao.MEUS_PONTOS);
    });
  });

  describe('v3.15.0 — STATUS_RODADA', () => {
    it('"quando atualiza o ranking?" → STATUS_RODADA', () => {
      expect(parseIntencao('quando atualiza o ranking?').intencao).toBe(Intencao.STATUS_RODADA);
    });
    it('"quando sai o resultado?" → STATUS_RODADA', () => {
      expect(parseIntencao('quando sai o resultado?').intencao).toBe(Intencao.STATUS_RODADA);
    });
    it('"cade meus pontos?" → STATUS_RODADA', () => {
      expect(parseIntencao('cade meus pontos?').intencao).toBe(Intencao.STATUS_RODADA);
    });
    it('"quando os pontos são calculados?" → STATUS_RODADA', () => {
      expect(parseIntencao('quando os pontos são calculados?').intencao).toBe(Intencao.STATUS_RODADA);
    });
  });

  describe('v3.15.0 — DESABAFO_RANKING', () => {
    it('"to em ultimo" → DESABAFO_RANKING', () => {
      expect(parseIntencao('to em ultimo').intencao).toBe(Intencao.DESABAFO_RANKING);
    });
    it('"fui mal demais" → DESABAFO_RANKING', () => {
      expect(parseIntencao('fui mal demais').intencao).toBe(Intencao.DESABAFO_RANKING);
    });
    it('"to perdendo" → DESABAFO_RANKING', () => {
      expect(parseIntencao('to perdendo').intencao).toBe(Intencao.DESABAFO_RANKING);
    });
    it('"nunca acerto" → DESABAFO_RANKING', () => {
      expect(parseIntencao('nunca acerto').intencao).toBe(Intencao.DESABAFO_RANKING);
    });
    // Anti-falso-positivo: "foi mal" (gíria de desculpa) ≠ "fui mal"
    it('"foi mal" (desculpa) NÃO cai em DESABAFO_RANKING', () => {
      expect(parseIntencao('foi mal').intencao).not.toBe(Intencao.DESABAFO_RANKING);
    });
  });

  describe('v3.15.0 — RECLAMACAO_BUG', () => {
    it('"meus pontos estão errados" → RECLAMACAO_BUG (não MEUS_PONTOS)', () => {
      expect(parseIntencao('meus pontos estão errados').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
    it('"ta bugado" → RECLAMACAO_BUG', () => {
      expect(parseIntencao('ta bugado').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
    it('"o bot ta errado" → RECLAMACAO_BUG', () => {
      expect(parseIntencao('o bot ta errado').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
    it('"calculou errado" → RECLAMACAO_BUG', () => {
      expect(parseIntencao('calculou errado').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
    it('"faltou ponto" → RECLAMACAO_BUG', () => {
      expect(parseIntencao('faltou ponto').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
    it('"deveria ter mais pontos" → RECLAMACAO_BUG', () => {
      expect(parseIntencao('deveria ter mais pontos').intencao).toBe(Intencao.RECLAMACAO_BUG);
    });
  });

  describe('v3.27.0 — PALPITE_OUTROS: "placar dos demais" (caso real 11/06)', () => {
    it('"Quais os placares dos demais participantes no jogo Mexico e Africa do Sul" → PALPITE_OUTROS', () => {
      expect(
        parseIntencao('Quais os placares dos demais participantes no jogo Mexico e Africa do Sul')
          .intencao,
      ).toBe(Intencao.PALPITE_OUTROS);
    });
    it('"placar dos outros" → PALPITE_OUTROS', () => {
      expect(parseIntencao('placar dos outros').intencao).toBe(Intencao.PALPITE_OUTROS);
    });
    it('"placares da galera" → PALPITE_OUTROS', () => {
      expect(parseIntencao('placares da galera').intencao).toBe(Intencao.PALPITE_OUTROS);
    });
    it('"o que cada um cravou?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('o que cada um cravou?').intencao).toBe(Intencao.PALPITE_OUTROS);
    });
    it('"o que a galera apostou nesse jogo?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('o que a galera apostou nesse jogo?').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"palpites dos demais" → PALPITE_OUTROS', () => {
      expect(parseIntencao('palpites dos demais').intencao).toBe(Intencao.PALPITE_OUTROS);
    });
  });

  describe('v3.17.0 — PALPITE_OUTROS (caso Camila 11/06)', () => {
    it('"vai mostrar os palpites dos outros?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('vai mostrar os palpites dos outros?').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"vai me mostrar quem palpitou o quê?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('vai me mostrar quem palpitou o que').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"quem acertou Brasil x Marrocos?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('quem acertou Brasil x Marrocos?').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"quem pontuou no jogo de ontem?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('quem pontuou no jogo de ontem?').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"como vejo o palpite do Fulano?" → PALPITE_OUTROS', () => {
      expect(parseIntencao('como vejo o palpite do Fulano?').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"palpites dos participantes" → PALPITE_OUTROS', () => {
      expect(parseIntencao('palpites dos participantes').intencao).toBe(
        Intencao.PALPITE_OUTROS,
      );
    });
    it('"lista de palpites" → PALPITE_OUTROS', () => {
      expect(parseIntencao('lista de palpites').intencao).toBe(Intencao.PALPITE_OUTROS);
    });
    // Anti-regressão:
    it('"meus palpites" continua MEU_PALPITE (não vira PALPITE_OUTROS)', () => {
      expect(parseIntencao('meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });
    it('"quem palpitou" continua PROGRESSO_PALPITES (contagem agregada, não outros)', () => {
      expect(parseIntencao('quem palpitou').intencao).toBe(Intencao.PROGRESSO_PALPITES);
    });
  });

  describe('v3.19.0 — PALPITE_GOLS_SEPARADOS (caso Natane 11/06)', () => {
    // Formato dela: "<gols> <Time> X <gols> <Time>" — gols colados em cada time.
    // Antes era pego só pelo `tentarPalpiteLivreViaLLM` que registrava
    // SEM confirmação — risco crítico. Agora regex pega direto e vai
    // pro fluxo canônico de PREVIEW + sim/não/refazer.
    it('caso EXATO Natane: "1 México X 2 África do Sul"', () => {
      const p = parseIntencao('1 México X 2 África do Sul');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({
        timeCasa: 'México',
        golsCasa: 1,
        golsVisitante: 2,
        timeVisitante: 'África do Sul',
      });
    });
    it('"1 Coreia do sul x 0 República tcheca"', () => {
      const p = parseIntencao('1 Coreia do sul x 0 República tcheca');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({
        timeCasa: 'Coreia do sul',
        golsCasa: 1,
        golsVisitante: 0,
        timeVisitante: 'República tcheca',
      });
    });
    it('"3 brasil x 1 Marrocos" (lowercase + acento)', () => {
      const p = parseIntencao('3 brasil x 1 Marrocos');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({
        timeCasa: 'brasil',
        golsCasa: 3,
        golsVisitante: 1,
        timeVisitante: 'Marrocos',
      });
    });
    it('"2 Alemanha x 0 curaçao"', () => {
      const p = parseIntencao('2 Alemanha x 0 curaçao');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({
        timeCasa: 'Alemanha',
        golsCasa: 2,
        golsVisitante: 0,
        timeVisitante: 'curaçao',
      });
    });
    it('"0 Brasil X 0 Argentina" (empate 0x0)', () => {
      const p = parseIntencao('0 Brasil X 0 Argentina');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({
        timeCasa: 'Brasil',
        golsCasa: 0,
        golsVisitante: 0,
        timeVisitante: 'Argentina',
      });
    });

    // Anti-regressão dos outros formatos
    it('canônico "Brasil 2x1 Marrocos" continua casando', () => {
      const p = parseIntencao('Brasil 2x1 Marrocos');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({ timeCasa: 'Brasil', golsCasa: 2, golsVisitante: 1 });
    });
    it('invertido "2x1 Brasil x Marrocos" continua casando', () => {
      const p = parseIntencao('2x1 Brasil x Marrocos');
      expect(p.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(p.palpite).toMatchObject({ timeCasa: 'Brasil', golsCasa: 2, golsVisitante: 1 });
    });

    // Anti-falsos-positivos críticos
    it('"12 anos x 2 vitorias" NÃO é palpite (time começa com dígito)', () => {
      const p = parseIntencao('12 anos x 2 vitorias');
      expect(p.intencao).not.toBe(Intencao.PALPITE_INLINE);
    });
    it('"3 jogos x 5 derrotas" NÃO é palpite', () => {
      const p = parseIntencao('3 jogos x 5 derrotas');
      expect(p.intencao).not.toBe(Intencao.PALPITE_INLINE);
    });

    it('multi-linha do print (5 palpites Natane) parseia todos via parseMultiplePalpites', () => {
      const texto = `1 México X 2 África do Sul
1 Coreia do sul x 0 República tcheca
2 estados Unidos x 0 Paraguai
3 brasil x 1 Marrocos
2 Alemanha x 0 curaçao`;
      const palpites = parseMultiplePalpites(texto);
      expect(palpites).toHaveLength(5);
      expect(palpites[0]).toMatchObject({ timeCasa: 'México', golsCasa: 1, golsVisitante: 2 });
      expect(palpites[3]).toMatchObject({ timeCasa: 'brasil', golsCasa: 3, golsVisitante: 1 });
    });
  });

  describe('v3.7.0 — EDITAR_PALPITE com placar inline', () => {
    it('"corrigir Brasil 3x1 Marrocos" → EDITAR_PALPITE (não PALPITE_INLINE)', () => {
      expect(parseIntencao('corrigir Brasil 3x1 Marrocos').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"mudar pra Brasil 2x1 Marrocos" → EDITAR_PALPITE', () => {
      expect(parseIntencao('mudar pra Brasil 2x1 Marrocos').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"atualizar Brasil 3 a 1" → EDITAR_PALPITE', () => {
      expect(parseIntencao('atualizar Brasil 3 a 1').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"alterar Brasil 2 por 0" → EDITAR_PALPITE', () => {
      expect(parseIntencao('alterar Brasil 2 por 0').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    it('"refazer Brasil 1-1" → EDITAR_PALPITE', () => {
      expect(parseIntencao('refazer Brasil 1-1').intencao).toBe(Intencao.EDITAR_PALPITE);
    });
    // Casos falsos positivos que NÃO podem cair em EDITAR_PALPITE:
    it('"mudar de bolão" NÃO → EDITAR_PALPITE (sem placar)', () => {
      expect(parseIntencao('mudar de bolão').intencao).not.toBe(Intencao.EDITAR_PALPITE);
    });
    it('"atualizar minha senha" NÃO → EDITAR_PALPITE (sem placar)', () => {
      expect(parseIntencao('atualizar minha senha').intencao).not.toBe(Intencao.EDITAR_PALPITE);
    });
  });

  describe('Sprint 2 — APAGAR_PALPITE (ISSUE-012)', () => {
    it('"apagar meu palpite" → APAGAR_PALPITE', () => {
      expect(parseIntencao('apagar meu palpite').intencao).toBe(Intencao.APAGAR_PALPITE);
    });
    it('"desfazer palpite" → APAGAR_PALPITE', () => {
      expect(parseIntencao('desfazer palpite').intencao).toBe(Intencao.APAGAR_PALPITE);
    });
    it('"remover palpite" → APAGAR_PALPITE', () => {
      expect(parseIntencao('remover palpite').intencao).toBe(Intencao.APAGAR_PALPITE);
    });
  });

  describe('Sprint 2 — DEFINIR_BOLAO_PADRAO (ISSUE-016)', () => {
    it('"bolão padrão" → DEFINIR_BOLAO_PADRAO', () => {
      expect(parseIntencao('bolão padrão').intencao).toBe(Intencao.DEFINIR_BOLAO_PADRAO);
    });
    it('"meu bolão principal" → DEFINIR_BOLAO_PADRAO', () => {
      expect(parseIntencao('meu bolão principal').intencao).toBe(Intencao.DEFINIR_BOLAO_PADRAO);
    });
    it('"definir bolão padrão" → DEFINIR_BOLAO_PADRAO', () => {
      expect(parseIntencao('definir bolão padrão').intencao).toBe(Intencao.DEFINIR_BOLAO_PADRAO);
    });
  });

  describe('Sprint 2 — RENOMEAR_BOLAO (ISSUE-020)', () => {
    it('"renomear bolão" → RENOMEAR_BOLAO', () => {
      expect(parseIntencao('renomear bolão').intencao).toBe(Intencao.RENOMEAR_BOLAO);
    });
    it('"mudar o nome do bolão" → RENOMEAR_BOLAO', () => {
      expect(parseIntencao('mudar o nome do bolão').intencao).toBe(Intencao.RENOMEAR_BOLAO);
    });
    it('"trocar nome do bolão" → RENOMEAR_BOLAO', () => {
      expect(parseIntencao('trocar nome do bolão').intencao).toBe(Intencao.RENOMEAR_BOLAO);
    });
  });

  describe('Sprint 2 — REMOVER_PARTICIPANTE (ISSUE-021)', () => {
    it('"remover participante" → REMOVER_PARTICIPANTE', () => {
      expect(parseIntencao('remover participante').intencao).toBe(Intencao.REMOVER_PARTICIPANTE);
    });
    it('"expulsar do bolão" → REMOVER_PARTICIPANTE', () => {
      expect(parseIntencao('expulsar do bolão').intencao).toBe(Intencao.REMOVER_PARTICIPANTE);
    });
    it('"tirar Fulano do bolão" → REMOVER_PARTICIPANTE', () => {
      expect(parseIntencao('tirar Fulano do bolão').intencao).toBe(Intencao.REMOVER_PARTICIPANTE);
    });
  });

  describe('Sprint 2 — RESUMO_BOLOES (ISSUE-023)', () => {
    it('"como to indo nos boloes" → RESUMO_BOLOES', () => {
      expect(parseIntencao('como to indo nos boloes').intencao).toBe(Intencao.RESUMO_BOLOES);
    });
    it('"em quantos bolões to em primeiro" → RESUMO_BOLOES', () => {
      expect(parseIntencao('em quantos bolões to em primeiro').intencao).toBe(Intencao.RESUMO_BOLOES);
    });
    it('"meu desempenho geral" → RESUMO_BOLOES', () => {
      expect(parseIntencao('meu desempenho geral').intencao).toBe(Intencao.RESUMO_BOLOES);
    });
    it('"resumo dos meus bolões" → RESUMO_BOLOES', () => {
      expect(parseIntencao('resumo dos meus bolões').intencao).toBe(Intencao.RESUMO_BOLOES);
    });
  });

  describe('Sprint 4 — PERGUNTA_GERAL_FUTEBOL (Bug VPS 18/05)', () => {
    it('"qual canal passa o Brasil hoje?" → PERGUNTA_GERAL_FUTEBOL', () => {
      expect(parseIntencao('qual canal passa o Brasil hoje?').intencao).toBe(
        Intencao.PERGUNTA_GERAL_FUTEBOL,
      );
    });
    it('"que canal vai passar o jogo?" → PERGUNTA_GERAL_FUTEBOL', () => {
      expect(parseIntencao('que canal vai passar o jogo?').intencao).toBe(
        Intencao.PERGUNTA_GERAL_FUTEBOL,
      );
    });
    it('"onde assistir a final?" → PERGUNTA_GERAL_FUTEBOL', () => {
      expect(parseIntencao('onde assistir a final?').intencao).toBe(
        Intencao.PERGUNTA_GERAL_FUTEBOL,
      );
    });
    // Mata-mata (Copa 2026): "que horas joga o Brasil?" agora é HORARIO_JOGO —
    // o bot lê a chave semeada do bolão do user (com fallback gracioso se o time
    // não estiver na chave dele). Antes caía em PERGUNTA_GERAL_FUTEBOL (LLM).
    it('"que horas joga o Brasil?" → HORARIO_JOGO (lê a chave do bolão)', () => {
      expect(parseIntencao('que horas joga o Brasil?').intencao).toBe(
        Intencao.HORARIO_JOGO,
      );
    });
    it('mata-mata: dúvidas frequentes caem nos intents certos', () => {
      const casos: Array<[string, Intencao]> = [
        ['a prorrogação conta?', Intencao.INFO_PRORROGACAO],
        ['e se for pra prorrogação?', Intencao.INFO_PRORROGACAO],
        ['pênalti conta?', Intencao.INFO_PENALTI],
        ['e os pênaltis?', Intencao.INFO_PENALTI],
        ['e se empatar?', Intencao.INFO_EMPATE_MATAMATA],
        ['quanto vale a final?', Intencao.INFO_PONTOS_MATAMATA],
        ['o que é o bônus?', Intencao.INFO_BONUS_CLASSIFICADO],
        ['se errar quem passa perco a crava?', Intencao.INFO_CRAVA_EMPATE],
        ['o ranking zera?', Intencao.INFO_RANKING_CONTINUA],
        ['o que muda agora?', Intencao.INFO_O_QUE_MUDA],
        ['ver a chave', Intencao.VER_CHAVE],
        ['mostra o bracket', Intencao.VER_CHAVE],
        ['quem o Brasil enfrenta?', Intencao.ADVERSARIO_TIME],
        ['que horas joga o Brasil?', Intencao.HORARIO_JOGO],
      ];
      for (const [texto, esperado] of casos) {
        expect(parseIntencao(texto).intencao, texto).toBe(esperado);
      }
    });

    it('"quem joga hoje?" → PERGUNTA_GERAL_FUTEBOL', () => {
      expect(parseIntencao('quem joga hoje?').intencao).toBe(
        Intencao.PERGUNTA_GERAL_FUTEBOL,
      );
    });
    // v3.15.0: "quem ganhou" agora roteia pra PLACAR_JOGO (banco TEM os
    // placares). O handler delega de volta pra PERGUNTA_GERAL_FUTEBOL
    // quando detecta fora-de-escopo (copa antiga) — comportamento final
    // pro usuário é idêntico (recusa educada), mas placar recente vem
    // do banco em vez de "checa na FIFA".
    it('"quem ganhou copa de 94?" → PLACAR_JOGO (handler delega fora-de-escopo)', () => {
      expect(parseIntencao('quem ganhou copa de 94?').intencao).toBe(
        Intencao.PLACAR_JOGO,
      );
    });
    it('"em que grupo o Brasil está?" → PERGUNTA_GERAL_FUTEBOL', () => {
      expect(parseIntencao('em que grupo o Brasil está?').intencao).toBe(
        Intencao.PERGUNTA_GERAL_FUTEBOL,
      );
    });
    it('"qual o placar do jogo?" → PLACAR_JOGO (v3.15.0: banco tem placares)', () => {
      expect(parseIntencao('qual o placar do jogo?').intencao).toBe(
        Intencao.PLACAR_JOGO,
      );
    });

    // PROXIMOS_JOGOS deve continuar funcionando pra comandos puros
    it('regressão: "próximos jogos" sozinho → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('próximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('regressão: "quais próximos jogos" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('quais próximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('regressão: "quero palpitar" → PROXIMOS_JOGOS', () => {
      expect(parseIntencao('quero palpitar').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });

    // Negative lookahead: pergunta sobre time/país NAO matcha PROXIMOS_JOGOS
    it('"quais próximos jogos da Inglaterra?" → NÃO é PROXIMOS_JOGOS', () => {
      const r = parseIntencao('quais próximos jogos da Inglaterra?').intencao;
      expect(r).not.toBe(Intencao.PROXIMOS_JOGOS);
    });
    it('"próximos jogos do Brasil" → NÃO é PROXIMOS_JOGOS (entidade especifica)', () => {
      const r = parseIntencao('próximos jogos do Brasil').intencao;
      expect(r).not.toBe(Intencao.PROXIMOS_JOGOS);
    });
  });

  describe('Bug Humberto 18/05 — MEUS_PONTOS variantes', () => {
    it('"pontuação" sozinho → MEUS_PONTOS', () => {
      expect(parseIntencao('pontuação').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"pontuacao" sem til → MEUS_PONTOS', () => {
      expect(parseIntencao('pontuacao').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"Pontuação" (capitalizado) → MEUS_PONTOS', () => {
      expect(parseIntencao('Pontuação').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"pontos" sozinho → MEUS_PONTOS', () => {
      expect(parseIntencao('pontos').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"minha pontuação" → MEUS_PONTOS', () => {
      expect(parseIntencao('minha pontuação').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"quanto pontuei" → MEUS_PONTOS', () => {
      expect(parseIntencao('quanto pontuei').intencao).toBe(Intencao.MEUS_PONTOS);
    });
    it('"score" → MEUS_PONTOS', () => {
      expect(parseIntencao('score').intencao).toBe(Intencao.MEUS_PONTOS);
    });
  });

  describe('Sprint 3 — DESPEDIDA', () => {
    it('"tchau" → DESPEDIDA', () => {
      expect(parseIntencao('tchau').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"até mais" → DESPEDIDA', () => {
      expect(parseIntencao('até mais').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"falou" → DESPEDIDA', () => {
      expect(parseIntencao('falou').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"flw" → DESPEDIDA', () => {
      expect(parseIntencao('flw').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"fui" → DESPEDIDA', () => {
      expect(parseIntencao('fui').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"abraço" → DESPEDIDA', () => {
      expect(parseIntencao('abraço').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"abs" → DESPEDIDA', () => {
      expect(parseIntencao('abs').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"bjs" → DESPEDIDA', () => {
      expect(parseIntencao('bjs').intencao).toBe(Intencao.DESPEDIDA);
    });
    it('"até amanhã" → DESPEDIDA', () => {
      expect(parseIntencao('até amanhã').intencao).toBe(Intencao.DESPEDIDA);
    });
  });

  describe('Sprint 3 — CUMPRIMENTO_CASUAL', () => {
    it('"tudo bem?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('tudo bem?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"tudo bom?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('tudo bom?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"td certo?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('td certo?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"como vai?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('como vai?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"como ta?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('como ta?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"suave?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('suave?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    it('"firmeza?" → CUMPRIMENTO_CASUAL', () => {
      expect(parseIntencao('firmeza?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
    // Saudacao encadeada: "oi tudo bem?" deve cair em CUMPRIMENTO_CASUAL
    // (e nao em SAUDACAO pura) graças ao stripSaudacao + INTENT_RULES.
    it('"oi tudo bem?" → CUMPRIMENTO_CASUAL (após strip saudação)', () => {
      expect(parseIntencao('oi tudo bem?').intencao).toBe(Intencao.CUMPRIMENTO_CASUAL);
    });
  });

  describe('Sprint 3 — CONCORDANCIA_CASUAL', () => {
    it('"ok" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('ok').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"beleza" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('beleza').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"blz" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('blz').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"show" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('show').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"fechou" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('fechou').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"perfeito" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('perfeito').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"top" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('top').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    it('"entendi" → CONCORDANCIA_CASUAL', () => {
      expect(parseIntencao('entendi').intencao).toBe(Intencao.CONCORDANCIA_CASUAL);
    });
    // Pattern restritivo: "ok eu quero criar bolão" não deve virar CONCORDANCIA
    it('"ok quero criar bolão" NÃO é CONCORDANCIA (pattern restrito)', () => {
      const r = parseIntencao('ok quero criar bolão');
      expect(r.intencao).not.toBe(Intencao.CONCORDANCIA_CASUAL);
    });
  });

  describe('Sprint 3 — RISADA', () => {
    it('"kkkk" → RISADA', () => {
      expect(parseIntencao('kkkk').intencao).toBe(Intencao.RISADA);
    });
    it('"kk" → RISADA', () => {
      expect(parseIntencao('kk').intencao).toBe(Intencao.RISADA);
    });
    it('"rsrsrs" → RISADA', () => {
      expect(parseIntencao('rsrsrs').intencao).toBe(Intencao.RISADA);
    });
    it('"hahaha" → RISADA', () => {
      expect(parseIntencao('hahaha').intencao).toBe(Intencao.RISADA);
    });
    it('"huehue" → RISADA', () => {
      expect(parseIntencao('huehue').intencao).toBe(Intencao.RISADA);
    });
    it('"😂" → RISADA', () => {
      expect(parseIntencao('😂').intencao).toBe(Intencao.RISADA);
    });
    it('"🤣🤣🤣" → RISADA', () => {
      expect(parseIntencao('🤣🤣🤣').intencao).toBe(Intencao.RISADA);
    });
  });

  describe('Sprint 3 — AGRADECIMENTO (bug Jeni 17/05)', () => {
    it('"obrigada" → AGRADECIMENTO (nao SAUDACAO)', () => {
      expect(parseIntencao('obrigada').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"obrigado" → AGRADECIMENTO', () => {
      expect(parseIntencao('obrigado').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"muito obrigado" → AGRADECIMENTO', () => {
      expect(parseIntencao('muito obrigado').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"valeu" → AGRADECIMENTO', () => {
      expect(parseIntencao('valeu').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"vlw" → AGRADECIMENTO', () => {
      expect(parseIntencao('vlw').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"vlwww" → AGRADECIMENTO', () => {
      expect(parseIntencao('vlwww').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"brigado" → AGRADECIMENTO', () => {
      expect(parseIntencao('brigado').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"brigadão" → AGRADECIMENTO', () => {
      expect(parseIntencao('brigadão').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"thx" → AGRADECIMENTO', () => {
      expect(parseIntencao('thx').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"thanks" → AGRADECIMENTO', () => {
      expect(parseIntencao('thanks').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"tmj" → AGRADECIMENTO', () => {
      expect(parseIntencao('tmj').intencao).toBe(Intencao.AGRADECIMENTO);
    });
    it('"agradecido" → AGRADECIMENTO', () => {
      expect(parseIntencao('agradecido').intencao).toBe(Intencao.AGRADECIMENTO);
    });

    describe('v3.18.0 — anti-loop: auto-replies NÃO viram AGRADECIMENTO', () => {
      // Caso real Lucas 11/06: "Agradeço seu contato, respondo em breve"
      // batia pattern /^agrade[cç]o\b/ e disparava loop. Patterns
      // endurecidos + cap de 30 chars no matchIntent garantem que essas
      // frases longas NÃO casam mais AGRADECIMENTO.
      it('"Agradeço seu contato, respondo em breve" → NÃO é AGRADECIMENTO', () => {
        expect(parseIntencao('Agradeço seu contato, respondo em breve').intencao).not.toBe(
          Intencao.AGRADECIMENTO,
        );
      });
      it('"Obrigado pelo contato, retorno em breve" → NÃO é AGRADECIMENTO', () => {
        expect(parseIntencao('Obrigado pelo contato, retorno em breve').intencao).not.toBe(
          Intencao.AGRADECIMENTO,
        );
      });
      it('"Thanks for reaching out, will get back soon" → NÃO é AGRADECIMENTO', () => {
        expect(parseIntencao('Thanks for reaching out, will get back soon').intencao).not.toBe(
          Intencao.AGRADECIMENTO,
        );
      });
      it('"valeu cara, muito obrigado pelo bom dia" → NÃO casa (frase longa)', () => {
        expect(parseIntencao('valeu cara, muito obrigado pelo bom dia').intencao).not.toBe(
          Intencao.AGRADECIMENTO,
        );
      });
      // Anti-regressão das curtas
      it('"Agradeço!" → continua AGRADECIMENTO', () => {
        expect(parseIntencao('Agradeço!').intencao).toBe(Intencao.AGRADECIMENTO);
      });
      it('"obrigado mesmo" → continua AGRADECIMENTO', () => {
        expect(parseIntencao('obrigado mesmo').intencao).toBe(Intencao.AGRADECIMENTO);
      });
      it('"muito obrigado!" → continua AGRADECIMENTO', () => {
        expect(parseIntencao('muito obrigado!').intencao).toBe(Intencao.AGRADECIMENTO);
      });
    });
    // Regressao: "oi" continua SAUDACAO
    it('"oi" continua SAUDACAO (regressao)', () => {
      expect(parseIntencao('oi').intencao).toBe(Intencao.SAUDACAO);
    });
  });

  describe('Sprint 3 — RANKING natural language (bug Jeni 17/05)', () => {
    it('"Quero ver o ranking" → RANKING', () => {
      expect(parseIntencao('Quero ver o ranking').intencao).toBe(Intencao.RANKING);
    });
    it('"Ver o ranking" → RANKING', () => {
      expect(parseIntencao('Ver o ranking').intencao).toBe(Intencao.RANKING);
    });
    it('"me mostra a tabela" → RANKING', () => {
      expect(parseIntencao('me mostra a tabela').intencao).toBe(Intencao.RANKING);
    });
    it('"qual eh a classificacao" → RANKING', () => {
      expect(parseIntencao('qual eh a classificacao').intencao).toBe(Intencao.RANKING);
    });
    it('"mostra o ranking" → RANKING', () => {
      expect(parseIntencao('mostra o ranking').intencao).toBe(Intencao.RANKING);
    });
    // Regressao: continua funcionando o caminho classico
    it('"ranking" (sozinho) continua RANKING', () => {
      expect(parseIntencao('ranking').intencao).toBe(Intencao.RANKING);
    });
    it('"ranking Firma FC" continua RANKING', () => {
      expect(parseIntencao('ranking Firma FC').intencao).toBe(Intencao.RANKING);
    });
  });

  describe('Palpite inline — variantes de placar (Bug 5a, P1, P2, P3)', () => {
    it('"Brasil 2x1 Marrocos" (canonico)', () => {
      const r = parseIntencao('Brasil 2x1 Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toMatchObject({ timeCasa: 'Brasil', golsCasa: 2, golsVisitante: 1, timeVisitante: 'Marrocos' });
    });
    it('"Brasil 2 a 1 Marrocos"', () => {
      const r = parseIntencao('Brasil 2 a 1 Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toMatchObject({ golsCasa: 2, golsVisitante: 1 });
    });
    it('"Brasil 2-1 Marrocos"', () => {
      const r = parseIntencao('Brasil 2-1 Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toMatchObject({ golsCasa: 2, golsVisitante: 1 });
    });
    it('"Brasil 2 por 1 Marrocos"', () => {
      const r = parseIntencao('Brasil 2 por 1 Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toMatchObject({ golsCasa: 2, golsVisitante: 1 });
    });
    it('"Brasil dois a um Marrocos" (extenso)', () => {
      const r = parseIntencao('Brasil dois a um Marrocos');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite).toMatchObject({ golsCasa: 2, golsVisitante: 1 });
    });
    it('"México 1 x 2 África do Sul" (multipalavra)', () => {
      const r = parseIntencao('México 1 x 2 África do Sul');
      expect(r.intencao).toBe(Intencao.PALPITE_INLINE);
      expect(r.palpite?.timeVisitante).toContain('África');
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

  it('v3.28.0 — teto anti-abuso: processa no máximo 80 linhas', () => {
    // 100 palpites válidos numa mensagem → só as 80 primeiras entram
    const linhas = Array.from({ length: 100 }, (_, i) => `Brasil ${i % 5}x0 Time${i}`);
    const r = parseMultiplePalpites(linhas.join('\n'));
    expect(r.length).toBeLessThanOrEqual(80);
  });

  describe('v3.34.0 — separados por VÍRGULA (caso Felipe 11/06 20:44, palpites perdidos)', () => {
    it('mensagem EXATA do Felipe (3 palpites por vírgula numa linha) → extrai os 3', () => {
      const msg =
        'Coreia do Sul 1x1 República Tcheca, Canadá 0x2 Bósnia e Herzegovina, Estados Unidos 1x0 Paraguai';
      const r = parseMultiplePalpites(msg);
      expect(r).toHaveLength(3);
      expect(r[0]).toMatchObject({ timeCasa: 'Coreia do Sul', golsCasa: 1, golsVisitante: 1, timeVisitante: 'República Tcheca' });
      expect(r[1]).toMatchObject({ timeCasa: 'Canadá', golsCasa: 0, golsVisitante: 2 });
      expect(r[2]).toMatchObject({ golsCasa: 1, golsVisitante: 0, timeVisitante: 'Paraguai' });
    });

    it('parseIntencao da mensagem do Felipe → PALPITE_INLINE (não TEXTO_LIVRE)', () => {
      const msg =
        'Coreia do Sul 1x1 República Tcheca, Canadá 0x2 Bósnia e Herzegovina, Estados Unidos 1x0 Paraguai';
      expect(parseIntencao(msg).intencao).toBe(Intencao.PALPITE_INLINE);
    });

    it('exemplo que o PRÓPRIO bot anuncia ("...separados por vírgula") funciona', () => {
      const r = parseMultiplePalpites('Brasil 2x1 Marrocos, México 1x1 África do Sul');
      expect(r).toHaveLength(2);
    });

    it('ponto e vírgula também separa', () => {
      const r = parseMultiplePalpites('Brasil 2x1 Marrocos; França 1x0 Argentina');
      expect(r).toHaveLength(2);
    });

    it('vírgula + quebra de linha misturados', () => {
      const r = parseMultiplePalpites('Brasil 2x1 Marrocos, França 1x0 Argentina\nEspanha 3x0 Japão');
      expect(r).toHaveLength(3);
    });

    it('palpite ÚNICO não é quebrado por vírgula inexistente', () => {
      const r = parseMultiplePalpites('Brasil 2x1 Marrocos');
      expect(r).toHaveLength(1);
    });
  });

  describe('v3.35.0 — "Meus palpites:" como rótulo de submissão (caso +5531 12/06)', () => {
    const lista =
      'Meus palpites:\nCoreia do Sul 0x2 República Tcheca\nCanadá 1x1 Bósnia e Herzegovina\nEstados Unidos 0x3 Paraguai';

    it('rótulo "Meus palpites:" + lista → PALPITE_INLINE (não MEU_PALPITE)', () => {
      expect(parseIntencao(lista).intencao).toBe(Intencao.PALPITE_INLINE);
    });

    it('os palpites da lista são extraídos com nomes limpos', () => {
      const r = parseMultiplePalpites(lista);
      expect(r).toHaveLength(3);
      expect(r[0]).toMatchObject({ timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca' });
    });

    it('PRESERVA "meus palpites" puro → MEU_PALPITE (sem lista)', () => {
      expect(parseIntencao('meus palpites').intencao).toBe(Intencao.MEU_PALPITE);
    });

    it('PRESERVA "meus palpites firma fc" → MEU_PALPITE', () => {
      expect(parseIntencao('meus palpites firma fc').intencao).toBe(Intencao.MEU_PALPITE);
    });

    it('PRESERVA "ranking" e "próximos jogos" puros', () => {
      expect(parseIntencao('ranking').intencao).toBe(Intencao.RANKING);
      expect(parseIntencao('próximos jogos').intencao).toBe(Intencao.PROXIMOS_JOGOS);
    });
  });

  describe('v3.35.0 — prefixo de data/hora copiado do formato do bot', () => {
    it('"11/06, 23:00 — Coreia do Sul 0x2 República Tcheca" → time limpo', () => {
      const r = parseMultiplePalpites('11/06, 23:00 — Coreia do Sul 0x2 República Tcheca');
      expect(r).toHaveLength(1);
      expect(r[0].timeCasa).toBe('Coreia do Sul');
      expect(r[0].timeVisitante).toBe('República Tcheca');
      expect(r[0]).toMatchObject({ golsCasa: 0, golsVisitante: 2 });
    });

    it('"✅ 13/06 19:00 — Brasil 2x1 Marrocos" → Brasil 2x1 Marrocos', () => {
      const r = parseMultiplePalpites('✅ 13/06 19:00 — Brasil 2x1 Marrocos');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ timeCasa: 'Brasil', golsCasa: 2, golsVisitante: 1, timeVisitante: 'Marrocos' });
    });

    it('NÃO quebra o formato invertido "1x1 México x África do Sul"', () => {
      const r = parseMultiplePalpites('1x1 México x África do Sul');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ timeCasa: 'México', golsCasa: 1, golsVisitante: 1, timeVisitante: 'África do Sul' });
    });
  });

  describe('v3.10.0 — formato invertido + tokenizer (caso Valéria 22/05)', () => {
    it('parseia uma linha invertida "1x1 México x África do Sul"', () => {
      const r = parseMultiplePalpites('1x1 México x África do Sul');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({
        timeCasa: 'México',
        timeVisitante: 'África do Sul',
        golsCasa: 1,
        golsVisitante: 1,
      });
    });

    it('parseia várias linhas invertidas (Valéria 11:22, 10 palpites)', () => {
      const text = `1x1 México x África do Sul
1x0 Coreia do Sul x República Tcheca
0x1 Canadá x Bósnia e Herzegovina
1x2 Estados Unidos x Paraguai
1x0 Catar x Suíça
2x1 Brasil x Marrocos
1x0 Haiti x Escócia
0x1 Austrália x Turquia
1x2 Alemanha x Curaçao
1x2 Holanda x Japao`;
      const r = parseMultiplePalpites(text);
      expect(r).toHaveLength(10);
      expect(r[0]).toMatchObject({ timeCasa: 'México', timeVisitante: 'África do Sul' });
      expect(r[5]).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Marrocos', golsCasa: 2, golsVisitante: 1 });
      expect(r[9]).toMatchObject({ timeCasa: 'Holanda', timeVisitante: 'Japao' });
    });

    it('tokeniza palpites concatenados em UMA linha sem newline (Valéria 11:20)', () => {
      const text =
        '1x1 México x África do Sul 1x0 Coreia do Sul x República Tcheca 0x1 Canadá x Bósnia ' +
        '1x2 Estados Unidos x Paraguai 1x0 Catar x Suíça 2x1 Brasil x Marrocos';
      const r = parseMultiplePalpites(text);
      expect(r.length).toBeGreaterThanOrEqual(5);
      // Confere que Brasil x Marrocos (último do trecho) foi capturado certo
      const brasil = r.find((p) => p.timeCasa === 'Brasil');
      expect(brasil).toBeDefined();
      expect(brasil?.timeVisitante).toBe('Marrocos');
      expect(brasil?.golsCasa).toBe(2);
      expect(brasil?.golsVisitante).toBe(1);
    });

    it('NÃO captura "1x1 México x África do Sul" como UM palpite com timeCasa contendo placar', () => {
      // Bug raiz: PALPITE_REGEX casaria timeCasa="1x1 México x África do Sul"
      // e timeVisitante seria todo o resto. Validador anti-lixo deve descartar.
      const r = parseMultiplePalpites(
        '1x1 México x África do Sul 1x0 Coreia do Sul x República Tcheca',
      );
      // Não pode existir um palpite cujo time tenha "1x" embutido
      for (const p of r) {
        expect(p.timeCasa).not.toMatch(/\d+\s*[xX-]\s*\d+/);
        expect(p.timeVisitante).not.toMatch(/\d+\s*[xX-]\s*\d+/);
      }
    });

    it('formato canônico continua funcionando (anti-regressão)', () => {
      const text = `Flamengo 2x1 Palmeiras
Corinthians 0x0 São Paulo`;
      const r = parseMultiplePalpites(text);
      expect(r).toHaveLength(2);
      expect(r[0].timeCasa).toBe('Flamengo');
    });

    it('mistura formato canônico e invertido', () => {
      const text = `Brasil 2x1 Marrocos
1x0 Argentina x Peru`;
      const r = parseMultiplePalpites(text);
      expect(r).toHaveLength(2);
      expect(r[0].timeCasa).toBe('Brasil');
      expect(r[1]).toMatchObject({ timeCasa: 'Argentina', timeVisitante: 'Peru', golsCasa: 1, golsVisitante: 0 });
    });

    it('separador "vs" funciona no invertido', () => {
      const r = parseMultiplePalpites('2-1 Brasil vs Argentina');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Argentina', golsCasa: 2, golsVisitante: 1 });
    });

    it('separador "a" funciona no invertido', () => {
      const r = parseMultiplePalpites('2 a 1 Brasil x Argentina');
      expect(r).toHaveLength(1);
      expect(r[0]).toMatchObject({ timeCasa: 'Brasil', timeVisitante: 'Argentina', golsCasa: 2, golsVisitante: 1 });
    });
  });
});
