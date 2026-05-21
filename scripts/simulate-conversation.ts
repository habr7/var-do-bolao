/**
 * Simula uma conversa real com o bot, passando mensagens pelo parser e
 * mostrando intent detectada + palpite extraido + handler que seria chamado.
 *
 * NAO toca DB/Redis — so testa o parsing, que eh onde mora a maioria dos
 * bugs corrigidos. Cobre cenarios alem dos 7 bugs originais.
 *
 * Uso: tsx scripts/simulate-conversation.ts
 */
import { parseIntencao, Intencao } from '../src/whatsapp/message.parser.js';
import { detectarAcaoAdmin } from '../src/whatsapp/admin.parser.js';

interface Cenario {
  grupo: string;
  desc: string;
  msg: string;
  esperado: {
    intencao?: Intencao;
    palpite?: { timeCasa?: string; golsCasa?: number; golsVisitante?: number; timeVisitante?: string };
    adminAcao?:
      | 'APROVAR_NOMEADO'
      | 'RECUSAR_NOMEADO'
      | 'APROVAR_TODOS'
      | 'RECUSAR_TODOS'
      | 'AFIRMATIVO_GENERICO'
      | 'NEGATIVO_GENERICO'
      | null;
  };
}

const CENARIOS: Cenario[] = [
  // ====================================================================
  // GRUPO 1: Bugs originais (regressao)
  // ====================================================================
  {
    grupo: '🐛 Bug 1 — Como convidar',
    desc: 'Admin perguntando como convidar',
    msg: 'Como convidar pessoas para o Bolão da Jeni?',
    esperado: { intencao: Intencao.COMO_CONVIDAR },
  },
  {
    grupo: '🐛 Bug 2 — Abrir rodada',
    desc: 'Admin querendo abrir rodada',
    msg: 'Abrir rodada para palpites',
    esperado: { intencao: Intencao.ABRIR_RODADA },
  },
  {
    grupo: '🐛 Bug 3 — FSM escape (admin parser)',
    desc: 'Admin manda "Aprovar" — detecta como AFIRMATIVO_GENERICO (sem nome)',
    msg: 'Aprovar',
    esperado: { adminAcao: 'AFIRMATIVO_GENERICO' }, // sem nome = generico (despacho decide)
  },
  {
    grupo: '🐛 Bug 4 — Ordem invertida',
    desc: '"Quais os jogos próximos?"',
    msg: 'Quais os jogos próximos?',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🐛 Bug 5a — Placar com "a"',
    desc: 'Brasil 2 a 1 Marrocos',
    msg: 'Brasil 2 a 1 Marrocos',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { timeCasa: 'Brasil', golsCasa: 2, golsVisitante: 1, timeVisitante: 'Marrocos' },
    },
  },
  {
    grupo: '🐛 Bug 5b — Inline em IDLE',
    desc: 'México 1 x 2 África do Sul',
    msg: 'México 1 x 2 África do Sul',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 1, golsVisitante: 2 },
    },
  },

  // ====================================================================
  // GRUPO 2: Variantes de placar (P1-P3)
  // ====================================================================
  {
    grupo: '⚽ Placar com hifen',
    desc: 'Brasil 3-1 Marrocos',
    msg: 'Brasil 3-1 Marrocos',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 3, golsVisitante: 1 },
    },
  },
  {
    grupo: '⚽ Placar com "por"',
    desc: 'Brasil 4 por 0 Argentina',
    msg: 'Brasil 4 por 0 Argentina',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 4, golsVisitante: 0 },
    },
  },
  {
    grupo: '⚽ Placar por extenso',
    desc: 'Brasil dois a um Marrocos',
    msg: 'Brasil dois a um Marrocos',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 2, golsVisitante: 1 },
    },
  },
  {
    grupo: '⚽ Placar zero a zero',
    desc: 'Empate 0x0',
    msg: 'Brasil 0 a 0 Marrocos',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 0, golsVisitante: 0 },
    },
  },
  {
    grupo: '⚽ Placar alto',
    desc: 'Goleada Alemanha 7x1 Brasil',
    msg: 'Alemanha 7x1 Brasil',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 7, golsVisitante: 1 },
    },
  },
  {
    grupo: '⚽ Caso DEDICADO: time abreviado',
    desc: 'BRA 2x1 ARG (abreviacao)',
    msg: 'BRA 2x1 ARG',
    esperado: {
      intencao: Intencao.PALPITE_INLINE,
      palpite: { golsCasa: 2, golsVisitante: 1 },
    },
  },

  // ====================================================================
  // GRUPO 3: Saudacao + intent (P11 e variacoes)
  // ====================================================================
  {
    grupo: '👋 Saudacao + intent',
    desc: '"oi, ranking" → RANKING',
    msg: 'oi, ranking',
    esperado: { intencao: Intencao.RANKING },
  },
  {
    grupo: '👋 Saudacao expressiva',
    desc: '"opa bolão!!! quais os proximos jogos?"',
    msg: 'opa bolão!!! quais os proximos jogos?',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '👋 Saudacao pura',
    desc: 'Só "oi" continua SAUDACAO',
    msg: 'oi',
    esperado: { intencao: Intencao.SAUDACAO },
  },
  {
    grupo: '👋 Bom dia + intent',
    desc: '"bom dia, meus palpites"',
    msg: 'bom dia, meus palpites',
    esperado: { intencao: Intencao.MEU_PALPITE },
  },

  // ====================================================================
  // GRUPO 4: Novos handlers (Fase 2)
  // ====================================================================
  {
    grupo: '🆕 SAIR_BOLAO direto',
    desc: '"sair do bolão"',
    msg: 'sair do bolão',
    esperado: { intencao: Intencao.SAIR_BOLAO },
  },
  {
    grupo: '🆕 SAIR_BOLAO coloquial',
    desc: '"quero sair"',
    msg: 'quero sair',
    esperado: { intencao: Intencao.SAIR_BOLAO },
  },
  {
    grupo: '🆕 QUEM_PARTICIPA',
    desc: '"quem participa do bolão?"',
    msg: 'quem participa do bolão?',
    esperado: { intencao: Intencao.QUEM_PARTICIPA },
  },
  {
    grupo: '🆕 QUEM_PARTICIPA variante',
    desc: '"quem ta no bolão da firma"',
    msg: 'quem ta no bolão da firma',
    esperado: { intencao: Intencao.QUEM_PARTICIPA },
  },
  {
    grupo: '🆕 COMO_CONVIDAR',
    desc: '"quero convidar amigos"',
    msg: 'quero convidar amigos',
    esperado: { intencao: Intencao.COMO_CONVIDAR },
  },
  {
    grupo: '🆕 COMO_CONVIDAR — pegar ID',
    desc: '"como pegar o ID do bolão"',
    msg: 'como pegar o ID do bolão',
    esperado: { intencao: Intencao.COMO_CONVIDAR },
  },

  // ====================================================================
  // GRUPO 5: Admin parser (acoes em DM)
  // ====================================================================
  {
    grupo: '👑 Admin "Aprovar João"',
    desc: 'Aprovar nominado',
    msg: 'Aprovar João da Silva',
    esperado: { adminAcao: 'APROVAR_NOMEADO' },
  },
  {
    grupo: '👑 Admin "Recusar Maria"',
    desc: 'Recusar nominado',
    msg: 'Recusar Maria Santos',
    esperado: { adminAcao: 'RECUSAR_NOMEADO' },
  },
  {
    grupo: '👑 Admin "Aprovar todos"',
    desc: 'Aprovar em lote',
    msg: 'Aprovar todos',
    esperado: { adminAcao: 'APROVAR_TODOS' },
  },
  {
    grupo: '👑 Admin "Pendentes"',
    desc: '"pendentes" — intent PENDENTES (nao admin acao)',
    msg: 'pendentes',
    esperado: { intencao: Intencao.PENDENTES },
  },
  {
    grupo: '👑 Admin "tem pedido pra aprovar?" (Bug descoberto)',
    desc: 'pergunta sobre pendentes — deve virar PENDENTES, nao APROVAR_NOMEADO',
    msg: 'tem pedido pra aprovar?',
    esperado: { intencao: Intencao.PENDENTES },
  },
  {
    grupo: '👑 Admin "aprovações pendentes?"',
    desc: 'variante',
    msg: 'aprovações pendentes?',
    esperado: { intencao: Intencao.PENDENTES },
  },

  // ====================================================================
  // GRUPO 6: Edge cases e negativos
  // ====================================================================
  {
    grupo: '⚠️ Palpite + texto extra',
    desc: 'frase decorativa — parser permissivo captura como PALPITE_INLINE',
    msg: 'acho que vai ser Brasil 2x1 Marrocos amanhã',
    esperado: { intencao: Intencao.PALPITE_INLINE }, // OK: handler busca jogo por times
  },
  {
    grupo: '⚠️ Cancelar no meio',
    desc: '"esquece"',
    msg: 'esquece',
    esperado: { intencao: Intencao.CANCELAR },
  },
  {
    grupo: '⚠️ Cancelar variante',
    desc: '"deixa pra la"',
    msg: 'deixa pra la',
    esperado: { intencao: Intencao.CANCELAR },
  },
  {
    grupo: '⚠️ Ajuda',
    desc: '"!ajuda"',
    msg: '!ajuda',
    esperado: { intencao: Intencao.AJUDA },
  },
  {
    grupo: '⚠️ Ajuda NL',
    desc: '"como funciona"',
    msg: 'como funciona',
    esperado: { intencao: Intencao.AJUDA },
  },
  {
    grupo: '⚠️ Numero so',
    desc: 'usuario manda so um numero (talvez resposta a "qual bolão?")',
    msg: '2',
    esperado: { intencao: Intencao.TEXTO_LIVRE }, // sera tratado pelo state se houver
  },
  {
    grupo: '⚠️ Texto puro sem intent',
    desc: '"futebol é legal"',
    msg: 'futebol é legal',
    esperado: { intencao: Intencao.TEXTO_LIVRE }, // cai no LLM fallback
  },

  // ====================================================================
  // GRUPO 7: Fluxo real complexo (multipalpite)
  // ====================================================================
  {
    grupo: '🎯 Multi-palpite em linhas (Bug descoberto)',
    desc: 'usuario manda varios palpites em IDLE — primeira linha deve ativar PALPITE_INLINE',
    msg: 'Brasil 2x1 Marrocos\nFrança 1x0 Argentina\nAlemanha 3x2 Espanha',
    esperado: { intencao: Intencao.PALPITE_INLINE },
  },

  // ====================================================================
  // GRUPO 8: Codigos de bolao (fast-path)
  // ====================================================================
  {
    grupo: '🔑 Codigo #ABCD12 inline',
    desc: 'fast-path — quero entrar #K3MZ8P',
    msg: 'Olá! Quero entrar no bolão Bolão da Firma #K3MZ8P',
    esperado: { intencao: Intencao.ENTRAR_BOLAO },
  },

  // ====================================================================
  // GRUPO 9: Bugs reportados pelo user em 13/05 — devem ser PALPITE_INLINE
  // ====================================================================
  {
    grupo: '🆕 Multi-palpite natural #1',
    desc: 'México 2 a 0 na África / Holanda 3 x 1 Japão / Brasil perde do Marrocos de 1 a 0',
    msg: 'México 2 a 0 na África\nHolanda 3 x 1 Japão\nBrasil perde do Marrocos de 1 a 0',
    esperado: { intencao: Intencao.PALPITE_INLINE },
  },
  {
    grupo: '🆕 Palpite com preposicao "na"',
    desc: 'México 2 a 0 na África',
    msg: 'México 2 a 0 na África',
    esperado: { intencao: Intencao.PALPITE_INLINE },
  },

  // ====================================================================
  // GRUPO 10: REGRAS + PALPITES_AMBIGUO (feedback do user)
  // ====================================================================
  {
    grupo: '📖 Regras direto',
    desc: '"regras" → REGRAS',
    msg: 'regras',
    esperado: { intencao: Intencao.REGRAS },
  },
  {
    grupo: '📖 Regras coloquial',
    desc: '"como pontua" → REGRAS',
    msg: 'como pontua',
    esperado: { intencao: Intencao.REGRAS },
  },
  {
    grupo: '📖 Regras frase',
    desc: '"como funciona a pontuação?" → REGRAS',
    msg: 'como funciona a pontuação?',
    esperado: { intencao: Intencao.REGRAS },
  },
  {
    grupo: '🤔 Palpites ambiguo',
    desc: '"palpites" → PALPITES_AMBIGUO (pergunta entre 3 opcoes)',
    msg: 'palpites',
    esperado: { intencao: Intencao.PALPITES_AMBIGUO },
  },
  {
    grupo: '🤔 Palpite singular ambiguo',
    desc: '"palpite" → PALPITES_AMBIGUO',
    msg: 'palpite',
    esperado: { intencao: Intencao.PALPITES_AMBIGUO },
  },
  {
    grupo: '✅ Meus palpites (especifico) NAO deve cair em ambiguo',
    desc: '"meus palpites" → MEU_PALPITE',
    msg: 'meus palpites',
    esperado: { intencao: Intencao.MEU_PALPITE },
  },

  // ====================================================================
  // GRUPO 11: "quero dar palpites" (Bug feedback 14/05)
  // ====================================================================
  {
    grupo: '🆕 Acao de palpitar #1',
    desc: '"quero dar palpites" → PROXIMOS_JOGOS (era MEU_PALPITE)',
    msg: 'quero dar palpites',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🆕 Acao de palpitar #2',
    desc: '"vou palpitar" → PROXIMOS_JOGOS',
    msg: 'vou palpitar',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🆕 Acao de palpitar #3',
    desc: '"bora dar uns palpites" → PROXIMOS_JOGOS',
    msg: 'bora dar uns palpites',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  // ====================================================================
  // ISSUE-005: Pergunta sobre senha → INFO_SENHA (sem custo de LLM)
  // ====================================================================
  {
    grupo: '🔓 ISSUE-005 — info senha',
    desc: '"qual a senha?" → INFO_SENHA',
    msg: 'qual a senha?',
    esperado: { intencao: Intencao.INFO_SENHA },
  },
  {
    grupo: '🔓 ISSUE-005 — info senha',
    desc: '"esqueci a senha" → INFO_SENHA',
    msg: 'esqueci a senha',
    esperado: { intencao: Intencao.INFO_SENHA },
  },
  {
    grupo: '🔓 ISSUE-005 — info senha',
    desc: '"como pego a senha do bolao" → INFO_SENHA',
    msg: 'como pego a senha do bolao',
    esperado: { intencao: Intencao.INFO_SENHA },
  },
  // ====================================================================
  // ISSUE-006: Admin querendo excluir bolao
  // ====================================================================
  {
    grupo: '🗑️ ISSUE-006 — excluir bolao',
    desc: '"excluir bolão" → EXCLUIR_BOLAO',
    msg: 'excluir bolão',
    esperado: { intencao: Intencao.EXCLUIR_BOLAO },
  },
  {
    grupo: '🗑️ ISSUE-006 — excluir bolao',
    desc: '"quero excluir o bolao" → EXCLUIR_BOLAO',
    msg: 'quero excluir o bolao',
    esperado: { intencao: Intencao.EXCLUIR_BOLAO },
  },
  {
    grupo: '🗑️ ISSUE-006 — excluir bolao',
    desc: '"encerrar meu bolao" → EXCLUIR_BOLAO',
    msg: 'encerrar meu bolao',
    esperado: { intencao: Intencao.EXCLUIR_BOLAO },
  },
  {
    grupo: '🗑️ ISSUE-006 — regressao',
    desc: '"sair do bolão" continua SAIR_BOLAO (nao confundir)',
    msg: 'sair do bolão',
    esperado: { intencao: Intencao.SAIR_BOLAO },
  },
  // ====================================================================
  // SPRINT 2 — handlers info (ISSUE-009, 010, 017, 018)
  // ====================================================================
  {
    grupo: '🟢 ISSUE-009 — info produto',
    desc: '"o que é esse bot?" → INFO_PRODUTO',
    msg: 'o que é esse bot?',
    esperado: { intencao: Intencao.INFO_PRODUTO },
  },
  {
    grupo: '🟢 ISSUE-009 — info produto',
    desc: '"pra que serve?" → INFO_PRODUTO',
    msg: 'pra que serve?',
    esperado: { intencao: Intencao.INFO_PRODUTO },
  },
  {
    grupo: '🟢 ISSUE-010 — info preço',
    desc: '"quanto custa?" → INFO_PRECO',
    msg: 'quanto custa?',
    esperado: { intencao: Intencao.INFO_PRECO },
  },
  {
    grupo: '🟢 ISSUE-010 — info preço',
    desc: '"é grátis?" → INFO_PRECO',
    msg: 'é grátis?',
    esperado: { intencao: Intencao.INFO_PRECO },
  },
  {
    grupo: '🟢 ISSUE-017 — como palpitar',
    desc: '"como dou palpite?" → COMO_PALPITAR',
    msg: 'como dou palpite?',
    esperado: { intencao: Intencao.COMO_PALPITAR },
  },
  {
    grupo: '🟢 ISSUE-017 — regressao',
    desc: '"quero palpitar" continua PROXIMOS_JOGOS',
    msg: 'quero palpitar',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🟢 ISSUE-018 — quando começa',
    desc: '"quando começa?" → QUANDO_COMECA',
    msg: 'quando começa?',
    esperado: { intencao: Intencao.QUANDO_COMECA },
  },
  {
    grupo: '🟢 ISSUE-018 — quando termina',
    desc: '"quando termina?" → QUANDO_COMECA',
    msg: 'quando termina?',
    esperado: { intencao: Intencao.QUANDO_COMECA },
  },
  // ====================================================================
  // SPRINT 2 — fluxo palpite (ISSUE-011, 012)
  // ====================================================================
  {
    grupo: '🟡 ISSUE-011 — editar palpite',
    desc: '"corrigir palpite" → EDITAR_PALPITE',
    msg: 'corrigir palpite',
    esperado: { intencao: Intencao.EDITAR_PALPITE },
  },
  {
    grupo: '🟡 ISSUE-011 — editar palpite',
    desc: '"errei o palpite" → EDITAR_PALPITE',
    msg: 'errei o palpite',
    esperado: { intencao: Intencao.EDITAR_PALPITE },
  },
  {
    grupo: '🟡 ISSUE-012 — apagar palpite',
    desc: '"apagar meu palpite" → APAGAR_PALPITE',
    msg: 'apagar meu palpite',
    esperado: { intencao: Intencao.APAGAR_PALPITE },
  },
  {
    grupo: '🟡 ISSUE-012 — apagar palpite',
    desc: '"desfazer palpite" → APAGAR_PALPITE',
    msg: 'desfazer palpite',
    esperado: { intencao: Intencao.APAGAR_PALPITE },
  },
  // ====================================================================
  // SPRINT 2 — bolao padrao (ISSUE-016)
  // ====================================================================
  {
    grupo: '🔵 ISSUE-016 — bolão padrão',
    desc: '"bolão padrão" → DEFINIR_BOLAO_PADRAO',
    msg: 'bolão padrão',
    esperado: { intencao: Intencao.DEFINIR_BOLAO_PADRAO },
  },
  {
    grupo: '🔵 ISSUE-016 — bolão padrão',
    desc: '"definir bolão padrão" → DEFINIR_BOLAO_PADRAO',
    msg: 'definir bolão padrão',
    esperado: { intencao: Intencao.DEFINIR_BOLAO_PADRAO },
  },
  // ====================================================================
  // SPRINT 2 — admin actions (ISSUE-020, 021)
  // ====================================================================
  {
    grupo: '🟣 ISSUE-020 — renomear bolão',
    desc: '"renomear bolão" → RENOMEAR_BOLAO',
    msg: 'renomear bolão',
    esperado: { intencao: Intencao.RENOMEAR_BOLAO },
  },
  {
    grupo: '🟣 ISSUE-020 — renomear bolão',
    desc: '"mudar nome do bolão" → RENOMEAR_BOLAO',
    msg: 'mudar nome do bolão',
    esperado: { intencao: Intencao.RENOMEAR_BOLAO },
  },
  {
    grupo: '🟣 ISSUE-021 — remover participante',
    desc: '"remover participante" → REMOVER_PARTICIPANTE',
    msg: 'remover participante',
    esperado: { intencao: Intencao.REMOVER_PARTICIPANTE },
  },
  {
    grupo: '🟣 ISSUE-021 — remover participante',
    desc: '"expulsar do bolão" → REMOVER_PARTICIPANTE',
    msg: 'expulsar do bolão',
    esperado: { intencao: Intencao.REMOVER_PARTICIPANTE },
  },
  // ====================================================================
  // SPRINT 2 — pontuacao cruzada (ISSUE-023)
  // ====================================================================
  {
    grupo: '🟤 ISSUE-023 — resumo bolões',
    desc: '"como to indo nos boloes" → RESUMO_BOLOES',
    msg: 'como to indo nos boloes',
    esperado: { intencao: Intencao.RESUMO_BOLOES },
  },
  {
    grupo: '🟤 ISSUE-023 — resumo bolões',
    desc: '"meu desempenho geral" → RESUMO_BOLOES',
    msg: 'meu desempenho geral',
    esperado: { intencao: Intencao.RESUMO_BOLOES },
  },

  // ====================================================================
  // SPRINT 3 — bug Jeni 17/05
  // ====================================================================
  {
    grupo: '🩹 Hotfix Jeni — AGRADECIMENTO',
    desc: '"obrigada" → AGRADECIMENTO (nao SAUDACAO)',
    msg: 'obrigada',
    esperado: { intencao: Intencao.AGRADECIMENTO },
  },
  {
    grupo: '🩹 Hotfix Jeni — AGRADECIMENTO',
    desc: '"valeu" → AGRADECIMENTO',
    msg: 'valeu',
    esperado: { intencao: Intencao.AGRADECIMENTO },
  },
  {
    grupo: '🩹 Hotfix Jeni — AGRADECIMENTO',
    desc: '"vlw" → AGRADECIMENTO',
    msg: 'vlw',
    esperado: { intencao: Intencao.AGRADECIMENTO },
  },
  {
    grupo: '🩹 Hotfix Jeni — AGRADECIMENTO',
    desc: '"muito obrigado" → AGRADECIMENTO',
    msg: 'muito obrigado',
    esperado: { intencao: Intencao.AGRADECIMENTO },
  },
  {
    grupo: '🩹 Hotfix Jeni — AGRADECIMENTO',
    desc: '"tmj" → AGRADECIMENTO',
    msg: 'tmj',
    esperado: { intencao: Intencao.AGRADECIMENTO },
  },
  {
    grupo: '🩹 Hotfix Jeni — RANKING natural',
    desc: '"Quero ver o ranking" → RANKING',
    msg: 'Quero ver o ranking',
    esperado: { intencao: Intencao.RANKING },
  },
  {
    grupo: '🩹 Hotfix Jeni — RANKING natural',
    desc: '"Ver o ranking" → RANKING',
    msg: 'Ver o ranking',
    esperado: { intencao: Intencao.RANKING },
  },
  {
    grupo: '🩹 Hotfix Jeni — RANKING natural',
    desc: '"me mostra a tabela" → RANKING',
    msg: 'me mostra a tabela',
    esperado: { intencao: Intencao.RANKING },
  },
  {
    grupo: '🩹 Hotfix Jeni — RANKING natural',
    desc: '"qual eh a classificacao" → RANKING',
    msg: 'qual eh a classificacao',
    esperado: { intencao: Intencao.RANKING },
  },
  // Regressao: "oi" continua SAUDACAO (nao virou AGRADECIMENTO)
  {
    grupo: '🩹 Hotfix Jeni — regressao',
    desc: '"oi" continua SAUDACAO (regressao)',
    msg: 'oi',
    esperado: { intencao: Intencao.SAUDACAO },
  },

  // ====================================================================
  // SPRINT 3 — expansao de cordialidade (DESPEDIDA / CUMPRIMENTO / etc)
  // ====================================================================
  {
    grupo: '👋 Sprint 3 — DESPEDIDA',
    desc: '"tchau" → DESPEDIDA',
    msg: 'tchau',
    esperado: { intencao: Intencao.DESPEDIDA },
  },
  {
    grupo: '👋 Sprint 3 — DESPEDIDA',
    desc: '"falou" → DESPEDIDA',
    msg: 'falou',
    esperado: { intencao: Intencao.DESPEDIDA },
  },
  {
    grupo: '👋 Sprint 3 — DESPEDIDA',
    desc: '"flw" → DESPEDIDA',
    msg: 'flw',
    esperado: { intencao: Intencao.DESPEDIDA },
  },
  {
    grupo: '👋 Sprint 3 — DESPEDIDA',
    desc: '"até mais" → DESPEDIDA',
    msg: 'até mais',
    esperado: { intencao: Intencao.DESPEDIDA },
  },
  {
    grupo: '🤝 Sprint 3 — CUMPRIMENTO_CASUAL',
    desc: '"tudo bem?" → CUMPRIMENTO_CASUAL',
    msg: 'tudo bem?',
    esperado: { intencao: Intencao.CUMPRIMENTO_CASUAL },
  },
  {
    grupo: '🤝 Sprint 3 — CUMPRIMENTO_CASUAL',
    desc: '"blz?" → CUMPRIMENTO_CASUAL',
    msg: 'blz?',
    esperado: { intencao: Intencao.CUMPRIMENTO_CASUAL },
  },
  {
    grupo: '🤝 Sprint 3 — CUMPRIMENTO_CASUAL',
    desc: '"como vai?" → CUMPRIMENTO_CASUAL',
    msg: 'como vai?',
    esperado: { intencao: Intencao.CUMPRIMENTO_CASUAL },
  },
  {
    grupo: '🤝 Sprint 3 — CUMPRIMENTO_CASUAL',
    desc: '"oi tudo bem?" → CUMPRIMENTO_CASUAL (apos strip saudacao)',
    msg: 'oi tudo bem?',
    esperado: { intencao: Intencao.CUMPRIMENTO_CASUAL },
  },
  {
    grupo: '👍 Sprint 3 — CONCORDANCIA_CASUAL',
    desc: '"ok" → CONCORDANCIA_CASUAL',
    msg: 'ok',
    esperado: { intencao: Intencao.CONCORDANCIA_CASUAL },
  },
  {
    grupo: '👍 Sprint 3 — CONCORDANCIA_CASUAL',
    desc: '"beleza" → CONCORDANCIA_CASUAL',
    msg: 'beleza',
    esperado: { intencao: Intencao.CONCORDANCIA_CASUAL },
  },
  {
    grupo: '👍 Sprint 3 — CONCORDANCIA_CASUAL',
    desc: '"blz" (sem ?) → CONCORDANCIA_CASUAL',
    msg: 'blz',
    esperado: { intencao: Intencao.CONCORDANCIA_CASUAL },
  },
  {
    grupo: '👍 Sprint 3 — CONCORDANCIA_CASUAL',
    desc: '"show" → CONCORDANCIA_CASUAL',
    msg: 'show',
    esperado: { intencao: Intencao.CONCORDANCIA_CASUAL },
  },
  {
    grupo: '👍 Sprint 3 — CONCORDANCIA_CASUAL',
    desc: '"top" → CONCORDANCIA_CASUAL',
    msg: 'top',
    esperado: { intencao: Intencao.CONCORDANCIA_CASUAL },
  },
  {
    grupo: '😂 Sprint 3 — RISADA',
    desc: '"kkkk" → RISADA',
    msg: 'kkkk',
    esperado: { intencao: Intencao.RISADA },
  },
  {
    grupo: '😂 Sprint 3 — RISADA',
    desc: '"hahaha" → RISADA',
    msg: 'hahaha',
    esperado: { intencao: Intencao.RISADA },
  },
  {
    grupo: '😂 Sprint 3 — RISADA',
    desc: '"rsrsrs" → RISADA',
    msg: 'rsrsrs',
    esperado: { intencao: Intencao.RISADA },
  },
  // Regressao critica: "ok quero criar bolão" nao pode virar CONCORDANCIA
  {
    grupo: '🛡️ Sprint 3 — regressao',
    desc: '"ok quero criar bolão" NAO eh CONCORDANCIA (pattern restrito)',
    msg: 'ok quero criar bolão',
    esperado: { intencao: Intencao.CRIAR_BOLAO },
  },

  // ====================================================================
  // Bug Humberto 18/05 — Pontuação / Ajuda / FSM escape / Match contextual
  // ====================================================================
  {
    grupo: '📊 Bug Humberto 18/05 — pontuação',
    desc: '"Pontuação" → MEUS_PONTOS (era RANKING("pontuacao"))',
    msg: 'Pontuação',
    esperado: { intencao: Intencao.MEUS_PONTOS },
  },
  {
    grupo: '📊 Bug Humberto 18/05 — pontuação',
    desc: '"pontuacao" sem til → MEUS_PONTOS',
    msg: 'pontuacao',
    esperado: { intencao: Intencao.MEUS_PONTOS },
  },
  {
    grupo: '📊 Bug Humberto 18/05 — pontuação',
    desc: '"score" → MEUS_PONTOS',
    msg: 'score',
    esperado: { intencao: Intencao.MEUS_PONTOS },
  },
  {
    grupo: '📊 Bug Humberto 18/05 — pontuação',
    desc: '"quanto pontuei" → MEUS_PONTOS',
    msg: 'quanto pontuei',
    esperado: { intencao: Intencao.MEUS_PONTOS },
  },

  // ====================================================================
  // Sprint 4 — Bug VPS 18/05: perguntas gerais de futebol
  // ====================================================================
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"Quais próximos jogos da Inglaterra?" → PERGUNTA_GERAL_FUTEBOL (era PROXIMOS_JOGOS do bolão do user)',
    msg: 'Quais próximos jogos da Inglaterra?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"Qual canal posso assistir o Brasil hoje?" → PERGUNTA_GERAL_FUTEBOL',
    msg: 'Qual canal posso assistir o Brasil hoje?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"onde assistir a final?" → PERGUNTA_GERAL_FUTEBOL',
    msg: 'onde assistir a final?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"que horas joga o Brasil?" → PERGUNTA_GERAL_FUTEBOL',
    msg: 'que horas joga o Brasil?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"quem ganhou copa de 94?" → PERGUNTA_GERAL_FUTEBOL',
    msg: 'quem ganhou copa de 94?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  {
    grupo: '⚽ Sprint 4 — PERGUNTA_GERAL_FUTEBOL',
    desc: '"em que grupo o Brasil está?" → PERGUNTA_GERAL_FUTEBOL',
    msg: 'em que grupo o Brasil está?',
    esperado: { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL },
  },
  // Regressões críticas: comandos sobre o bolão DO USER continuam funcionando
  {
    grupo: '🛡️ Sprint 4 — regressão',
    desc: '"próximos jogos" sozinho continua PROXIMOS_JOGOS',
    msg: 'próximos jogos',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🛡️ Sprint 4 — regressão',
    desc: '"quero palpitar" continua PROXIMOS_JOGOS',
    msg: 'quero palpitar',
    esperado: { intencao: Intencao.PROXIMOS_JOGOS },
  },
  {
    grupo: '🛡️ Sprint 4 — regressão',
    desc: '"quando começa?" continua QUANDO_COMECA',
    msg: 'quando começa?',
    esperado: { intencao: Intencao.QUANDO_COMECA },
  },
  {
    grupo: '🛡️ Sprint 4 — regressão',
    desc: '"ranking" sozinho continua RANKING',
    msg: 'ranking',
    esperado: { intencao: Intencao.RANKING },
  },
];

// ============================================================
// EXECUCAO
// ============================================================
let passou = 0;
let falhou = 0;
const falhas: string[] = [];

console.log('═══════════════════════════════════════════════════════════════');
console.log('   SIMULACAO DE CONVERSA COM O BOT — VAR do Bolão');
console.log('═══════════════════════════════════════════════════════════════\n');

let grupoAtual = '';
for (const c of CENARIOS) {
  if (c.grupo !== grupoAtual) {
    console.log(`\n──── ${c.grupo} ────`);
    grupoAtual = c.grupo;
  }

  const parsed = parseIntencao(c.msg);
  const adminAcao = detectarAcaoAdmin(c.msg);

  let ok = true;
  const linhas: string[] = [];

  // Validar intencao
  if (c.esperado.intencao !== undefined) {
    if (parsed.intencao === c.esperado.intencao) {
      linhas.push(`   ✓ intencao = ${parsed.intencao}`);
    } else {
      linhas.push(`   ✗ intencao esperada=${c.esperado.intencao} recebida=${parsed.intencao}`);
      ok = false;
    }
  }

  // Validar palpite
  if (c.esperado.palpite) {
    const p = parsed.palpite;
    const exp = c.esperado.palpite;
    if (!p) {
      linhas.push(`   ✗ palpite esperado mas parser nao extraiu`);
      ok = false;
    } else {
      const checks: Array<[string, unknown, unknown]> = [];
      if (exp.timeCasa !== undefined) checks.push(['timeCasa', exp.timeCasa, p.timeCasa]);
      if (exp.golsCasa !== undefined) checks.push(['golsCasa', exp.golsCasa, p.golsCasa]);
      if (exp.golsVisitante !== undefined) checks.push(['golsVisitante', exp.golsVisitante, p.golsVisitante]);
      if (exp.timeVisitante !== undefined) checks.push(['timeVisitante', exp.timeVisitante, p.timeVisitante]);
      for (const [campo, esp, rec] of checks) {
        if (esp === rec) {
          linhas.push(`   ✓ palpite.${campo} = ${JSON.stringify(rec)}`);
        } else {
          linhas.push(`   ✗ palpite.${campo} esperado=${JSON.stringify(esp)} recebido=${JSON.stringify(rec)}`);
          ok = false;
        }
      }
    }
  }

  // Validar admin acao
  if (c.esperado.adminAcao !== undefined) {
    if (c.esperado.adminAcao === null) {
      if (adminAcao === null) {
        linhas.push(`   ✓ adminAcao = null (correto)`);
      } else {
        linhas.push(`   ✗ adminAcao esperada=null recebida=${adminAcao.tipo}`);
        ok = false;
      }
    } else {
      if (adminAcao && adminAcao.tipo === c.esperado.adminAcao) {
        linhas.push(`   ✓ adminAcao.tipo = ${adminAcao.tipo}`);
      } else {
        linhas.push(`   ✗ adminAcao esperada=${c.esperado.adminAcao} recebida=${adminAcao?.tipo ?? 'null'}`);
        ok = false;
      }
    }
  }

  const status = ok ? '✅' : '❌';
  console.log(`\n${status} ${c.desc}`);
  console.log(`   📩 "${c.msg.replace(/\n/g, '\\n')}"`);
  for (const l of linhas) console.log(l);

  if (ok) passou++;
  else {
    falhou++;
    falhas.push(`${c.grupo}: ${c.desc}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`   RESULTADO: ${passou} ✅  ${falhou} ❌  (total ${passou + falhou})`);
console.log('═══════════════════════════════════════════════════════════════');
if (falhas.length > 0) {
  console.log('\nFalhas:');
  for (const f of falhas) console.log(`  • ${f}`);
}

process.exit(falhou > 0 ? 1 : 0);
