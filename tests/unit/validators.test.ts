import { describe, it, expect } from 'vitest';
import {
  isValidScore,
  isGroupJid,
  isUserJid,
  extractPhoneFromJid,
  normalizeTeamName,
  parseScore,
  validarPlacar,
  timeCorresponde,
  acharJogoPorTimes,
  resolverPalpiteParaJogo,
} from '../../src/utils/validators.js';

describe('isValidScore', () => {
  it('aceita 0', () => expect(isValidScore(0)).toBe(true));
  it('aceita numeros positivos', () => expect(isValidScore(5)).toBe(true));
  it('rejeita negativos', () => expect(isValidScore(-1)).toBe(false));
  it('rejeita decimais', () => expect(isValidScore(1.5)).toBe(false));
  it('rejeita valores maiores que 99', () => expect(isValidScore(100)).toBe(false));
});

describe('isGroupJid', () => {
  it('identifica JID de grupo', () => {
    expect(isGroupJid('120363123456789@g.us')).toBe(true);
  });
  it('rejeita JID de usuario', () => {
    expect(isGroupJid('5511999999999@s.whatsapp.net')).toBe(false);
  });
});

describe('isUserJid', () => {
  it('identifica JID de usuario', () => {
    expect(isUserJid('5511999999999@s.whatsapp.net')).toBe(true);
  });
  it('rejeita JID de grupo', () => {
    expect(isUserJid('120363123456789@g.us')).toBe(false);
  });
});

describe('extractPhoneFromJid', () => {
  it('extrai telefone de JID', () => {
    expect(extractPhoneFromJid('5511999999999@s.whatsapp.net')).toBe('5511999999999');
  });
});

describe('normalizeTeamName', () => {
  it('normaliza para lowercase sem acentos', () => {
    expect(normalizeTeamName('São Paulo')).toBe('sao paulo');
  });
  it('remove acentos', () => {
    expect(normalizeTeamName('Grêmio')).toBe('gremio');
  });
  it('trim espaços', () => {
    expect(normalizeTeamName('  Flamengo  ')).toBe('flamengo');
  });

  // Bug real: usuario manda "na África" e bot precisa bater
  // "África do Sul" — preposicao prefixada quebrava o includes().
  describe('strip de preposicoes prefixadas', () => {
    it('"na África" → "africa"', () => {
      expect(normalizeTeamName('na África')).toBe('africa');
    });
    it('"do Brasil" → "brasil"', () => {
      expect(normalizeTeamName('do Brasil')).toBe('brasil');
    });
    it('"pra Espanha" → "espanha"', () => {
      expect(normalizeTeamName('pra Espanha')).toBe('espanha');
    });
    it('"contra Argentina" → "argentina"', () => {
      expect(normalizeTeamName('contra Argentina')).toBe('argentina');
    });
    it('strip iterativo "pra na Africa" → "africa"', () => {
      expect(normalizeTeamName('pra na Africa')).toBe('africa');
    });
    it('NAO strip palavra que sobreviveria como time isolado', () => {
      // "Estados" não está nas stopwords (é palavra valida)
      expect(normalizeTeamName('Estados Unidos')).toBe('estados unidos');
    });
    it('verifica matching pos-strip', () => {
      const naAfrica = normalizeTeamName('na África');
      const africaDoSul = normalizeTeamName('África do Sul');
      // "africa" deve estar contido em "africa do sul" — caso de uso real
      expect(africaDoSul.includes(naAfrica)).toBe(true);
    });
  });
});

describe('parseScore', () => {
  it('parseia formato NxN', () => {
    expect(parseScore('2x1')).toEqual({ golsCasa: 2, golsVisitante: 1 });
  });
  it('parseia com espaco', () => {
    expect(parseScore('2 x 1')).toEqual({ golsCasa: 2, golsVisitante: 1 });
  });
  it('parseia com X maiusculo', () => {
    expect(parseScore('0X3')).toEqual({ golsCasa: 0, golsVisitante: 3 });
  });
  it('retorna null para texto invalido', () => {
    expect(parseScore('abc')).toBeNull();
  });
});

describe('validarPlacar (ISSUE-013)', () => {
  it('aceita placar comum', () => {
    expect(validarPlacar(2, 1).ok).toBe(true);
    expect(validarPlacar(0, 0).ok).toBe(true);
    expect(validarPlacar(5, 4).ok).toBe(true);
  });

  it('rejeita gols negativos como invalido', () => {
    const r = validarPlacar(-1, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('invalido');
      expect(r.sugerirConfirmacao).toBe(false);
    }
  });

  it('marca placar com >15 gols como absurdo', () => {
    const r = validarPlacar(18, 0);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toBe('absurdo');
      expect(r.sugerirConfirmacao).toBe(true);
    }
  });

  it('marca placar com 16x0 como absurdo (limite)', () => {
    const r = validarPlacar(16, 0);
    expect(r.ok).toBe(false);
  });

  it('aceita 15x0 (limite OK)', () => {
    expect(validarPlacar(15, 0).ok).toBe(true);
  });

  it('marca total >20 como absurdo (mesmo se cada lado <=15)', () => {
    const r = validarPlacar(12, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toBe('absurdo');
  });

  it('aceita total exato 20', () => {
    expect(validarPlacar(10, 10).ok).toBe(true);
  });
});

describe('timeCorresponde — abreviação/grafia (v3.29.0, caso Mauricio 11/06)', () => {
  it('"Rep Checa" casa "República Tcheca" (token-match + alias)', () => {
    expect(timeCorresponde('Rep Checa', 'República Tcheca')).toBe(true);
  });
  it('"Coreia" casa "Coreia do Sul" (includes)', () => {
    expect(timeCorresponde('Coreia', 'Coreia do Sul')).toBe(true);
  });
  it('"Checa" casa "República Tcheca" (alias)', () => {
    expect(timeCorresponde('Checa', 'República Tcheca')).toBe(true);
  });
  it('"EUA" casa "Estados Unidos" (alias)', () => {
    expect(timeCorresponde('EUA', 'Estados Unidos')).toBe(true);
  });
  it('"Bósnia" casa "Bósnia e Herzegovina"', () => {
    expect(timeCorresponde('Bósnia', 'Bósnia e Herzegovina')).toBe(true);
  });
  it('ordem canônica/acentos: "republica tcheca" == "República Tcheca"', () => {
    expect(timeCorresponde('republica tcheca', 'República Tcheca')).toBe(true);
  });
  // anti-falso-positivo
  it('"Real Madrid" NÃO casa "República Tcheca"', () => {
    expect(timeCorresponde('Real Madrid', 'República Tcheca')).toBe(false);
  });
  it('"Coreia do Norte" NÃO casa "Coreia do Sul" (token "norte" ≠ "sul")', () => {
    expect(timeCorresponde('Coreia do Norte', 'Coreia do Sul')).toBe(false);
  });
  it('"Paraguai" NÃO casa "Uruguai"', () => {
    expect(timeCorresponde('Paraguai', 'Uruguai')).toBe(false);
  });
});

describe('acharJogoPorTimes com abreviações (v3.29.0)', () => {
  const jogos = [
    { id: 'j1', timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca' },
    { id: 'j2', timeCasa: 'Estados Unidos', timeVisitante: 'Paraguai' },
  ];
  it('"Coreia" / "Rep Checa" → acha o jogo (canônico)', () => {
    const m = acharJogoPorTimes(jogos, 'Coreia', 'Rep Checa');
    expect(m?.jogo.id).toBe('j1');
    expect(m?.invertido).toBe(false);
  });
  it('"Rep Checa" / "Coreia" → acha o jogo invertido', () => {
    const m = acharJogoPorTimes(jogos, 'Rep Checa', 'Coreia');
    expect(m?.jogo.id).toBe('j1');
    expect(m?.invertido).toBe(true);
  });
  it('"EUA" / "Paraguai" → acha o jogo', () => {
    expect(acharJogoPorTimes(jogos, 'EUA', 'Paraguai')?.jogo.id).toBe('j2');
  });
});

describe('acharJogoPorTimes — ordem invertida (v3.25.0)', () => {
  const jogos = [
    { id: 'j1', timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca' },
    { id: 'j2', timeCasa: 'Brasil', timeVisitante: 'Marrocos' },
  ];

  it('casa na ordem canônica (invertido=false)', () => {
    const m = acharJogoPorTimes(jogos, 'Coreia do Sul', 'República Tcheca');
    expect(m?.jogo.id).toBe('j1');
    expect(m?.invertido).toBe(false);
  });

  it('casa com times TROCADOS (invertido=true) — caso B. 11/06', () => {
    const m = acharJogoPorTimes(jogos, 'República Tcheca', 'Coreia do Sul');
    expect(m?.jogo.id).toBe('j1');
    expect(m?.invertido).toBe(true);
  });

  it('prioriza canônico quando ambos poderiam casar', () => {
    // Brasil x Marrocos na ordem certa nunca deve marcar invertido
    const m = acharJogoPorTimes(jogos, 'Brasil', 'Marrocos');
    expect(m?.invertido).toBe(false);
  });

  it('retorna null quando nenhum jogo bate', () => {
    expect(acharJogoPorTimes(jogos, 'Argentina', 'Chile')).toBeNull();
  });
});

describe('resolverPalpiteParaJogo — troca o placar quando invertido (v3.25.0)', () => {
  const jogos = [{ id: 'j1', timeCasa: 'Coreia do Sul', timeVisitante: 'República Tcheca' }];

  it('ordem certa: mantém o placar', () => {
    const r = resolverPalpiteParaJogo(jogos, {
      timeCasa: 'Coreia do Sul',
      timeVisitante: 'República Tcheca',
      golsCasa: 0,
      golsVisitante: 2,
    });
    expect(r).toMatchObject({ timeCasa: 'Coreia do Sul', golsCasa: 0, golsVisitante: 2 });
  });

  it('times trocados: "República Tcheca 2x0 Coreia do Sul" → Coreia 0 x 2 Tcheca', () => {
    const r = resolverPalpiteParaJogo(jogos, {
      timeCasa: 'República Tcheca',
      timeVisitante: 'Coreia do Sul',
      golsCasa: 2,
      golsVisitante: 0,
    });
    // no fixture, mandante é Coreia: deve receber o gol que o user deu à Coreia (0)
    expect(r).toMatchObject({
      timeCasa: 'Coreia do Sul',
      timeVisitante: 'República Tcheca',
      golsCasa: 0,
      golsVisitante: 2,
    });
  });

  it('sem jogo correspondente → null', () => {
    const r = resolverPalpiteParaJogo(jogos, {
      timeCasa: 'Argentina',
      timeVisitante: 'Chile',
      golsCasa: 1,
      golsVisitante: 0,
    });
    expect(r).toBeNull();
  });
});
