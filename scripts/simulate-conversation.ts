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
