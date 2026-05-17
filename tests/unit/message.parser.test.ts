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
});
