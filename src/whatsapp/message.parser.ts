/**
 * Parser de mensagens em DM.
 *
 * Diferente da v1, em DM a maior parte do fluxo e guiada por estado (FSM) —
 * o usuario envia texto livre e o command.router decide o que fazer baseado
 * no estado atual. Este parser so identifica intencoes principais e palpites
 * inline.
 *
 * Camada 1 (regex/keywords): rapida, gratis, cobre ~80% das mensagens
 * comuns. Definida aqui.
 *
 * Camada 2 (LLM intent.classifier): fallback quando regex falha. Captura
 * variantes coloquiais que nao caberiam em regex razoavel.
 */

export enum Intencao {
  // Intencoes em IDLE
  SAUDACAO = 'SAUDACAO',
  MENU = 'MENU',
  CRIAR_BOLAO = 'CRIAR_BOLAO',
  ENTRAR_BOLAO = 'ENTRAR_BOLAO',
  MEUS_BOLOES = 'MEUS_BOLOES',
  RANKING = 'RANKING',
  MEUS_PONTOS = 'MEUS_PONTOS',
  JOGOS_HOJE = 'JOGOS_HOJE',
  PROXIMOS_JOGOS = 'PROXIMOS_JOGOS', // jogos que ainda nao rolaram + status de palpite
  MAIS_JOGOS = 'MAIS_JOGOS',         // proximo lote de 10 jogos (paginacao de PROXIMOS_JOGOS)
  PROGRESSO_PALPITES = 'PROGRESSO_PALPITES', // v3.8.0 — quem ja palpitou / quem falta no bolao (visivel pra todos)
  CUTUCAR_PENDENTES = 'CUTUCAR_PENDENTES',   // v3.8.0 — admin manda DM pra quem ainda nao palpitou
  DICAS_PALPITE = 'DICAS_PALPITE',           // v3.9.0 — "tem dicas?", "como monto palpite", "qual placar comum"
  ACOLHIMENTO_NOVATO = 'ACOLHIMENTO_NOVATO', // v3.9.0 — "nao entendo de futebol", "to perdida", "primeira vez"
  PLACAR_JOGO = 'PLACAR_JOGO',               // v3.15.0 — "qual o placar?", "quem ganhou?" (Copa rolando — banco TEM os placares)
  PONTOS_DETALHE = 'PONTOS_DETALHE',         // v3.15.0 — "quantos pontos fiz ontem?" (breakdown por jogo)
  ESTATISTICA_PONTOS = 'ESTATISTICA_PONTOS', // v3.38.0 — "quantas cravadas fiz?", "estatística dos meus pontos" (quebra por faixa 10/7/5/3/0)
  JOGOS_POR_FAIXA = 'JOGOS_POR_FAIXA',       // v3.39.0 — "quais jogos eu cravei?", "quais fiz 7 pontos" (lista os jogos de uma faixa)
  STATUS_RODADA = 'STATUS_RODADA',           // v3.15.0 — "quando atualiza o ranking?", "quando sai o resultado?"
  DESABAFO_RANKING = 'DESABAFO_RANKING',     // v3.15.0 — "tô em último", "fui mal demais" (acolhimento)
  RECLAMACAO_BUG = 'RECLAMACAO_BUG',         // v3.15.0 — "meus pontos estão errados", "tá bugado" (loga + acolhe)
  PALPITE_OUTROS = 'PALPITE_OUTROS',         // v3.17.0 — "quem acertou X?", "vai mostrar palpites dos outros?" (privacidade clara)
  MEU_PALPITE = 'MEU_PALPITE',
  ABRIR_RODADA = 'ABRIR_RODADA',     // admin querendo abrir/iniciar rodada
  COMO_CONVIDAR = 'COMO_CONVIDAR',   // como compartilhar bolao com convidados
  SAIR_BOLAO = 'SAIR_BOLAO',         // sair de um bolao
  QUEM_PARTICIPA = 'QUEM_PARTICIPA', // listar participantes
  REGRAS = 'REGRAS',                 // ver regras de pontuacao/funcionamento
  PALPITES_AMBIGUO = 'PALPITES_AMBIGUO', // user digitou so "palpites" — bot pergunta o que ele quis
  INFO_SENHA = 'INFO_SENHA',         // user perguntou sobre senha do bolao (ISSUE-005)
  EXCLUIR_BOLAO = 'EXCLUIR_BOLAO',   // admin quer excluir bolao (ISSUE-006)

  // Sprint 2 — handlers de pergunta frequente (ISSUE-009, 010, 017, 018)
  INFO_PRODUTO = 'INFO_PRODUTO',     // "o que e isso", "pra que serve", "como funciona o bot"
  INFO_PRECO = 'INFO_PRECO',         // "quanto custa", "eh gratis", "tem que pagar"
  COMO_PALPITAR = 'COMO_PALPITAR',   // "como dou palpite", "como palpitar", "como faco palpite"
  QUANDO_COMECA = 'QUANDO_COMECA',   // "quando comeca", "quando termina", "quando abre rodada"

  // Sprint 2 — fluxo de palpite (ISSUE-011, 012)
  EDITAR_PALPITE = 'EDITAR_PALPITE', // "corrigir Brasil 3x1", "mudar palpite", "alterar palpite"
  APAGAR_PALPITE = 'APAGAR_PALPITE', // "apagar meu palpite", "desfazer palpite", "remover palpite"

  // Sprint 2 — bolao padrao (ISSUE-016)
  DEFINIR_BOLAO_PADRAO = 'DEFINIR_BOLAO_PADRAO', // "definir bolao padrao", "meu bolao principal"

  // Sprint 2 — admin actions (ISSUE-020, 021)
  RENOMEAR_BOLAO = 'RENOMEAR_BOLAO',           // "renomear bolao", "mudar nome do bolao"
  REMOVER_PARTICIPANTE = 'REMOVER_PARTICIPANTE', // "remover Fulano", "tirar Fulano do bolao"

  // Sprint 2 — pontuacao cruzada (ISSUE-023)
  RESUMO_BOLOES = 'RESUMO_BOLOES',   // "como to indo nos boloes", "meu desempenho geral"

  // Mata-mata (Copa 2026) — dúvidas frequentes (regex-first, custo zero).
  INFO_PRORROGACAO = 'INFO_PRORROGACAO',           // "prorrogação conta?", "vale a prorrogação?"
  INFO_PENALTI = 'INFO_PENALTI',                   // "pênalti conta?", "vale pênalti?"
  INFO_EMPATE_MATAMATA = 'INFO_EMPATE_MATAMATA',   // "e se empatar?", "como palpito empate?"
  INFO_PONTOS_MATAMATA = 'INFO_PONTOS_MATAMATA',   // "os pontos aumentaram?", "quanto vale a final?"
  INFO_BONUS_CLASSIFICADO = 'INFO_BONUS_CLASSIFICADO', // "o que é o bônus?", "ponto de quem passa?"
  INFO_CRAVA_EMPATE = 'INFO_CRAVA_EMPATE',         // "se errar quem passa perco a crava?"
  INFO_RANKING_CONTINUA = 'INFO_RANKING_CONTINUA', // "o ranking zera?", "meus pontos dos grupos contam?"
  INFO_O_QUE_MUDA = 'INFO_O_QUE_MUDA',             // "o que muda agora?", "o que mudou no mata-mata?"
  ADVERSARIO_TIME = 'ADVERSARIO_TIME',             // "quem o Brasil enfrenta?", "adversário do Brasil"
  HORARIO_JOGO = 'HORARIO_JOGO',                   // "que horas joga o Brasil?", "horário do jogo de X"
  VER_CHAVE = 'VER_CHAVE',                         // "ver a chave", "mostra o bracket", "como tá o chaveamento"

  AJUDA = 'AJUDA',
  CANCELAR = 'CANCELAR',

  // Sprint 3 — handlers de cordialidade
  AGRADECIMENTO = 'AGRADECIMENTO',          // "obrigada", "valeu", "vlw", "brigado", "thx"
  DESPEDIDA = 'DESPEDIDA',                  // "tchau", "flw", "abraço", "fui"
  CUMPRIMENTO_CASUAL = 'CUMPRIMENTO_CASUAL', // "tudo bem?", "blz?", "como vai"
  CONCORDANCIA_CASUAL = 'CONCORDANCIA_CASUAL', // "ok", "beleza" (em IDLE — em CONFIRMANDO_* vira SIM)
  RISADA = 'RISADA',                         // "kkkk", "rsrs", "hahaha"
  // Sprint 4 — perguntas gerais de futebol (nao sobre o bolao do user)
  PERGUNTA_GERAL_FUTEBOL = 'PERGUNTA_GERAL_FUTEBOL', // "quais jogos da Inglaterra?", "qual canal passa o Brasil?", "quem ganhou copa de 94?"

  // Intencoes de admin
  APROVAR = 'APROVAR',
  RECUSAR = 'RECUSAR',
  PENDENTES = 'PENDENTES',

  // Fora da FSM
  PALPITE_INLINE = 'PALPITE_INLINE',
  TEXTO_LIVRE = 'TEXTO_LIVRE',
}

export interface ParsedMessage {
  intencao: Intencao;
  raw: string;
  args: string[];
  palpite?: PalpiteInline;
}

export interface PalpiteInline {
  timeCasa: string;
  golsCasa: number;
  golsVisitante: number;
  timeVisitante: string;
  /**
   * Mata-mata: lado que o usuário JÁ indicou como classificado na MESMA
   * mensagem do palpite (ex.: "Brasil 1x1 Japão e o Brasil passa"). Só é
   * preenchido em EMPATE (placar decisivo infere o vencedor). Quando vem
   * preenchido, o fluxo registra direto e NÃO pergunta quem passa.
   */
  classificado?: 'CASA' | 'VISITANTE';
}

// Mata-mata — sinais de que o trecho fala de QUEM AVANÇA (não do placar).
// "vai" entra porque é comum ("vai o Brasil"), e a resolução exige que um
// dos dois times apareça no trecho — então "vai dar zebra" não vira nada.
const AVANCO_CLASSIFICADO_RE =
  /\b(passa\w*|classific\w*|avan[cç]\w*|segue\w*|seguir|vai)\b/i;

/**
 * Separa de uma linha de palpite um eventual "rabicho" de classificado
 * ("..., Brasil passa" / "...e o Japão avança" / "...(Brasil)"). Devolve a
 * parte limpa (só o placar, pra parsear sem poluir o nome do time) e o texto
 * do rabicho (pra resolver o lado depois, já com os nomes parseados).
 * Conservador: só corta quando há sinal de avanço OU parêntese final curto.
 */
function separarClassificadoInline(linha: string): { semClassificado: string; tail: string | null } {
  // 1) Parêntese final: "Brasil 1x1 Japão (Brasil)".
  const paren = linha.match(/^(.*\d.*?)\s*\(([^)]{2,40})\)\s*$/);
  if (paren) return { semClassificado: paren[1].trim(), tail: paren[2].trim() };

  // 2) Rabicho após delimitador (vírgula/;) ou conector (e/mas/com/porém),
  //    contendo sinal de avanço. Âncora no 1º delimitador/conector que tem
  //    sinal de avanço até o fim — preserva o placar à esquerda.
  const m = linha.match(
    /^(.*\d.*?)(?:\s*[,;]\s*|\s+(?:e|mas|com|por[ée]m)\s+)(.+)$/i,
  );
  if (m && AVANCO_CLASSIFICADO_RE.test(m[2])) {
    return { semClassificado: m[1].trim(), tail: m[2].trim() };
  }
  return { semClassificado: linha, tail: null };
}

// Intents informativas do mata-mata que CEDEM pra um palpite real na mesma
// mensagem (evita perder palpite quando a frase menciona pênaltis/empate/etc).
const INTENTS_INFO_MATAMATA_PERDEM_PRA_PALPITE = new Set<Intencao>([
  Intencao.INFO_PRORROGACAO,
  Intencao.INFO_PENALTI,
  Intencao.INFO_EMPATE_MATAMATA,
  Intencao.INFO_PONTOS_MATAMATA,
  Intencao.INFO_BONUS_CLASSIFICADO,
  Intencao.INFO_CRAVA_EMPATE,
  Intencao.INFO_RANKING_CONTINUA,
  Intencao.INFO_O_QUE_MUDA,
]);

// Palavras que um nome de TIME nunca tem — sinal de que o "palpite" parseado é
// na verdade uma pergunta ("se eu fizer 2x1 ganho quanto?") e NÃO deve
// sobrescrever a intent informativa.
const NAO_E_NOME_DE_TIME = new Set<string>([
  'que', 'quanto', 'quantos', 'quantas', 'ganho', 'ganha', 'ganhar', 'fizer',
  'fizermos', 'fizer', 'vale', 'valem', 'se', 'eu', 'perco', 'perde', 'faco',
  'quero', 'acho', 'sera', 'vou', 'pra', 'pro',
]);

/** Heurística: o nome parseado parece um time real (não um pedaço de pergunta)? */
function pareceTimeLimpo(nome: string): boolean {
  if (/\d/.test(nome)) return false;
  const palavras = normalize(nome).split(/\s+/).filter(Boolean);
  if (palavras.length === 0 || palavras.length > 3) return false;
  return !palavras.some((w) => NAO_E_NOME_DE_TIME.has(w));
}

/** Resolve o rabicho ("o Brasil passa") pra CASA/VISITANTE pelos nomes parseados. */
function resolverLadoClassificado(
  tail: string,
  timeCasa: string,
  timeVisitante: string,
): 'CASA' | 'VISITANTE' | null {
  const nt = normalize(tail);
  const nc = normalize(timeCasa);
  const nv = normalize(timeVisitante);
  const casaIn = nc.length >= 3 && nt.includes(nc);
  const visIn = nv.length >= 3 && nt.includes(nv);
  if (casaIn && !visIn) return 'CASA';
  if (visIn && !casaIn) return 'VISITANTE';
  return null; // ambíguo (os dois ou nenhum) → fluxo pergunta normalmente
}

// Aceita varios separadores entre os placares: x/X, " a ", " - ", " por ".
// "x"/"X"/"-" podem vir colados ou com espacos; "a"/"por" exigem espacos
// em volta pra nao casar com palavras (tipo "Acre"). Suporta:
//   "Brasil 2x1 Marrocos"
//   "Brasil 2 X 1 Marrocos"
//   "Brasil 2-1 Marrocos"
//   "Brasil 2 a 1 Marrocos"
//   "Brasil 2 por 1 Marrocos"
// v3.37.0 — separadores de placar: x/X, × (U+00D7 do teclado de celular),
// hífen, e "a"/"por"/"c"/"C" entre espaços ("2 a 1", "2 c 2" = typo de x,
// teclas vizinhas). × e "c" eram gaps reais (caso "Holanda 2 × 2 Japão" /
// "2 c 2" caíam em "não entendi").
const PALPITE_REGEX = /^(.+?)\s+(\d+)\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*(\d+)\s+(.+)$/;

// v3.10.0 — formato INVERTIDO: "NxN Time1 x Time2" (placar antes dos
// times). Caso real Valéria 22/05: ela mandou 10 linhas nesse formato
// e o parser canônico falhou em todas, caindo em smart-fallback que
// inventou "Seus palpites foram registrados". Exemplos:
//   "1x1 México x África do Sul"
//   "2-1 Brasil x Marrocos"
//   "1 a 0 BRA x ARG"
// O separador entre os 2 times pode ser " x ", " X ", " vs ", " - ", " contra ".
const PALPITE_INVERTIDO_REGEX = /^(\d+)\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*(\d+)\s+(.+?)\s+(?:[xX×]|vs|contra|-)\s+(.+)$/;

// v3.19.0 — formato GOLS SEPARADOS: "N Time1 X N Time2" (gols colados
// em cada time, separador "x"/"X" no meio). Caso real Natane 11/06:
// "1 México X 2 África do Sul" / "3 brasil x 1 Marrocos". Antes esses
// caíam em tentarPalpiteLivreViaLLM (que registrava sem confirmação —
// bug crítico v3.19.0). Agora detecta direto, vai pro pipeline canônico
// de PREVIEW + sim/não.
//
// Diferenças dos outros formatos:
//   - PALPITE_REGEX (canônico):     "Time1 NxN Time2"   — placar grudado
//   - PALPITE_INVERTIDO_REGEX:      "NxN Time1 x Time2" — placar grudado no início
//   - PALPITE_GOLS_SEPARADOS_REGEX: "N Time1 X N Time2" — gols separados nos times
//
// PRECEDÊNCIA importante: este regex é mais GENÉRICO que os outros (não
// exige placar grudado), então só tentar DEPOIS dos canônico/invertido
// falharem. Ordem em `tentarParsearPalpiteInline`.
const PALPITE_GOLS_SEPARADOS_REGEX = /^(\d+)\s+(.+?)\s+[xX×]\s+(\d+)\s+(.+)$/;

// v3.50.0 — formato GOLS DEPOIS DO TIME: "Time1 N x Time2 N" (o gol vem
// LOGO APÓS o nome de cada time, com o separador entre os dois lados). Caso
// real 29/06: usuário mandou "Alemanha 2 x Paraguai 3" — o bot NÃO entendeu
// (caía em TEXTO_LIVRE), e o "Sim" seguinte virou conversa fiada ("🙌
// Combinado!"), dando a falsa impressão de palpite registrado. É um jeito
// MUITO natural de escrever, então passou a ser suportado.
//
//   - PALPITE_REGEX (canônico):     "Time1 NxN Time2"   — placar grudado, no meio
//   - PALPITE_INVERTIDO_REGEX:      "NxN Time1 x Time2" — placar grudado no início
//   - PALPITE_GOLS_SEPARADOS_REGEX: "N Time1 X N Time2" — gol ANTES de cada time
//   - PALPITE_GOLS_POS_TIME_REGEX:  "Time1 N x Time2 N" — gol DEPOIS de cada time
//
// É o mais genérico de todos (qualquer "palavra N x palavra N" casa), então só
// roda por ÚLTIMO, com os mesmos guards anti-lixo do gols-separados. Exige
// ESPAÇO em volta do separador pra não roubar o canônico "Time 2x1 Time".
const PALPITE_GOLS_POS_TIME_REGEX = /^(.+?)\s+(\d+)\s+[xX×]\s+(.+?)\s+(\d+)$/;

// v3.10.0 — detecta um "âncora" de placar (NxN) dentro de uma linha.
// Usado pra: (1) tokenizar linhas com vários palpites concatenados sem
// quebra de linha, (2) validar que um time parseado não tem placar
// embutido (sinal de match ruim do regex canônico).
const PLACAR_ANCHOR_REGEX = /(\d+)\s*(?:[xX×-]|\s+(?:a|por|c|C)\s+)\s*(\d+)/g;

// Mapa de numeros por extenso → digito. So 0-10 — placar maior que 10 eh
// raro o suficiente pra forcar o usuario a digitar.
const NUMEROS_EXTENSO: Record<string, string> = {
  zero: '0',
  um: '1', uma: '1',
  dois: '2', duas: '2',
  tres: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  sete: '7',
  oito: '8',
  nove: '9',
  dez: '10',
};

/**
 * Substitui numeros por extenso por digitos. So toca palavras inteiras
 * (\b...\b). Aplicado no texto NORMALIZADO (sem acento), entao trata
 * "três" e "tres" igual.
 */
function substituirNumerosExtenso(textoNormalizado: string): string {
  let resultado = textoNormalizado;
  for (const [palavra, digito] of Object.entries(NUMEROS_EXTENSO)) {
    const re = new RegExp(`\\b${palavra}\\b`, 'g');
    resultado = resultado.replace(re, digito);
  }
  return resultado;
}

const SAUDACOES = new Set([
  'oi', 'ola', 'hey', 'e ai', 'eai', 'bom dia', 'boa tarde', 'boa noite',
  'salve', 'fala', 'eaee', 'eae', 'iae', 'iaee', 'opa', 'oiee', 'oie',
]);
const MENU_WORDS = new Set([
  'menu', 'inicio', 'home', 'comecar', 'voltar', 'principal', 'start',
]);
const AJUDA_WORDS = new Set([
  'ajuda', 'help', '?', 'comandos', 'duvida', 'duvidas',
]);
const CANCELAR_WORDS = new Set([
  'cancelar', 'cancela', 'sair', 'parar', 'esquece', 'deixa', 'deixa pra la',
  'pode parar', 'chega', 'desiste',
]);

/**
 * Padroes de linguagem natural por intencao. Cada padrao eh testado no
 * texto NORMALIZADO (lowercase + sem acentos). Idea: absorver o maximo
 * de variantes naturais sem precisar do LLM no caminho comum. Ordem
 * importa: matches mais especificos primeiro.
 */
type IntentRules = { intencao: Intencao; padroes: RegExp[] };

// "Meus palpites / quais palpitei / o que palpitei"
const MEU_PALPITE_PATTERNS: RegExp[] = [
  /^meus? palpites?\b/,
  /\bquais (?:sao )?(?:os )?meus palpites?\b/,
  /\b(?:o )?que (?:eu )?(?:palpitei|chutei|apostei)\b/,
  /\bmeus chutes?\b/,
  /\bpalpites? que (?:eu )?(?:dei|fiz|registrei)\b/,
  /\bver meus palpites?\b/,
  // v3.40.0 — alias de autocorretor de celular (caso real 2× "Meus olhares"
  // → "meus palpites"). Baixo risco: "olhares" não aparece em nenhum outro
  // intent, então roteia uma frase rara pra "meus palpites".
  /\bmeus? olhares?\b/,
];

// "Proximos jogos / quais jogos faltam / o que ainda nao palpitei"
// Cobre tambem inversao "jogos proximos", variantes com "qual/quais",
// e AÇÃO de palpitar ("quero dar palpites", "vou fazer um palpite", etc).
//
// BUG VPS 18/05: "Quais próximos jogos da Inglaterra?" matchava o padrao
// genérico `\bproximos? jogos?\b` e ia pra handleProximosJogos (que lista
// jogos do BOLAO do user, nao da Inglaterra). Agora os padroes genericos
// usam negative lookahead pra NAO matchar quando seguido por preposicao
// + entidade (da/do/de + palavra), que indica pergunta sobre time/pais
// especifico. Esses casos caem em PERGUNTA_GERAL_FUTEBOL ou no LLM.
const PROXIMOS_JOGOS_PATTERNS: RegExp[] = [
  // Bare "proximos jogos" — apenas se NAO seguido de preposicao + entidade
  // v3.28.0 — além de bloquear "...da Inglaterra" (time específico), bloqueia
  // também "...quando/onde/que dia?" (pergunta de horário/local → QUANDO_COMECA
  // ou LLM, não a lista do bolão).
  /\bproximos? jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)(?!\s+(?:quando|onde|que dia|qual dia|a que horas?|que horas?)\b)/,
  /\bjogos? proximos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)(?!\s+(?:quando|onde|que dia|qual dia|a que horas?|que horas?)\b)/, // ordem invertida — Bug 4
  /\bquais (?:os )?proximos? jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)(?!\s+(?:quando|onde|que dia|qual dia|a que horas?|que horas?)\b)/,
  /\bquais (?:os )?jogos? proximos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)(?!\s+(?:quando|onde|que dia|qual dia|a que horas?|que horas?)\b)/,
  /\bjogos? que (?:ainda )?(?:nao palpitei|faltam|tem)\b/,
  /\bo que (?:ainda )?(?:nao palpitei|falta palpitar)\b/,
  /\bquais (?:eu )?(?:ainda )?(?:nao palpitei|preciso palpitar)\b/,
  /\bjogos? pendentes?\b/,
  /\bfaltam quais? jogos?\b/,
  // Acao de palpitar (substantivo): "quero dar palpites", "vou fazer
  // um palpite", "bora dar uns palpites", "preciso registrar palpites".
  // Bug feedback 14/05: "quero dar palpites" estava caindo em MEU_PALPITE.
  /\b(?:quero|bora|vou|vamos|preciso) (?:eu )?(?:dar|fazer|registrar) (?:um |uns |meus |novos |o |os )?palpites?\b/,
  // Acao de palpitar (verbo): cobre "quero palpitar", "vou palpitar",
  // "vamos palpitar", "bora palpitar" numa unica regex.
  /\b(?:quero|bora|vou|vamos) palpitar\b/,
  /\bdeixa eu (?:dar|fazer|registrar|palpitar)\b/,
  /\bpalpitar (?:nos? |em |nesses? )?jogos?\b/,
  /\blista (?:de )?jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)/,
  /\bme mostra os jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)/,
  /\bmostra(?:r)? os jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)/,
  /\bver os jogos?\b(?!\s+(?:d[aoe]|contra|com|sobre|na|no|em)\s+\w)/,
];

// v3.5.0 — "mais jogos" pagina o próximo lote de 10 jogos. Disparado
// depois que o user já viu uma lista de PROXIMOS_JOGOS e quer continuar.
// Mantemos separado de PROXIMOS_JOGOS pra o handler saber se reseta
// offset (próximos jogos = topo) ou avança (mais jogos = lote seguinte).
const MAIS_JOGOS_PATTERNS: RegExp[] = [
  /\bmais (?:uns? )?jogos?\b/,
  /\bmais (?:uns? )?palpites?\b/,
  /\bproximos? 10 jogos?\b/,
  /\bproximos? dez jogos?\b/,
  /\boutros? jogos?\b/,
  /\btem mais jogos?\b/,
  /\bquero (?:ver )?mais\b/,
  /\bmostra(?:r)? mais\b/,
  /\bcontinuar palpitando\b/,
  /\bcontinua(?:r)?(?: a)? palpitar\b/,
  /\bver os proximos\b/,
  /\bver mais\b/,
];

// Sprint 4 (Bug VPS 18/05) — "Pergunta geral sobre futebol".
// Quando o usuario pergunta sobre time/pais/canal/jogo especifico que
// nao eh o bolao dele, queremos passar pra LLM responder naturalmente —
// nao forcar em comando do bot. Padroes captam claramente:
//   - "qual canal" (transmissão TV)
//   - "onde assistir" (transmissão)
//   - "quem joga" / "joga contra" / "vai jogar" (sobre time especifico)
//   - "que dia/hora joga X" (data de jogo especifico)
//   - "quem ganhou" / "resultado" (sobre jogo passado)
//   - perguntas com "?" + nome de time/pais (regex de entidades comuns)
const PERGUNTA_GERAL_FUTEBOL_PATTERNS: RegExp[] = [
  // Canal / transmissão / onde assistir
  /\bqual (?:o )?canal\b/,
  /\bque canal\b/,
  /\bem que canal\b/,
  /\bonde (?:vou |posso |consigo |da pra |eu )?(?:assist[ie]r|ver|passa|transmite)\b/,
  /\baonde (?:vou |posso |consigo |da pra |eu )?(?:assist[ie]r|ver|passa|transmite)\b/,
  /\bvai passar\b/,
  // Dia / hora de jogo especifico. NAO inclui "comeca/começa" sozinho —
  // isso eh QUANDO_COMECA (sobre rodada do bolao). PERGUNTA_GERAL_FUTEBOL
  // exige indicacao explicita de jogo/time externo.
  /\bque (?:dia|hora|horas) (?:joga|passa|tem jogo)\b/,
  /\bquando (?:joga|passa)\s+(?:o |a |os |as )?\w+/, // exige objeto: "quando joga o brasil"
  /\bque horas (?:eh|é|sera|será) o jogo\b/,
  // Quem joga / vai jogar (sobre time externo)
  /\bquem joga\b/,
  /\bquem jogou\b/,
  /\bquem ganhou\b/,
  /\bquem venceu\b/,
  /\bquem (?:fez|marcou) gol\b/,
  /\bvai jogar\b.*\?/,
  /\bjogou contra\b/,
  // Resultado / placar de jogo especifico (mas nao "meu palpite")
  /\bresultado (?:do |de |da )?jogo\b/,
  /\bplacar (?:do |de )(?:jogo|brasil|argentina|copa)\b/,
  /\bcomo (?:foi|terminou) o jogo\b/,
  /\bqual (?:foi )?o placar\b/,
  // Grupos / sorteio / fase de copa
  /\bgrupo (?:do|da)\b/,
  /\bem que grupo\b/,
  /\bsorteio\b/,
  /\bfase de grupos\b/,
  /\boitavas|quartas|semifinal|final da copa\b/,
  // "jogos da/do [time]" / "jogo contra X" — captura "quais proximos jogos
  // da Inglaterra?" e variantes que NAO sao sobre o bolao do user. O
  // lookahead exclui temporais ("jogos de hoje/amanha/ontem" → JOGOS_HOJE,
  // não pergunta geral sobre um time).
  /\bjogos?\s+(?:d[aoe]|contra|na\s|no\s|em\s|sobre)\s+(?!hoje\b|amanha\b|amanhã\b|ontem\b|agora\b|hj\b)\w/,
  /\b(?:proxim[oa]|ultim[oa])\s+jogo\s+(?:d[aoe]|contra|na|no|em)\s+\w/,
  // Pergunta com nome de pais/time depois de "joga/jogou":
  // "Inglaterra joga hoje?", "Brasil jogou contra X" — quando comeca com
  // letra maiuscula seguida de verbo.
  /\b(?:joga|jogou|jogara)\b.*\b(?:contra|com|hoje|amanha|domingo|segunda|terca|quarta|quinta|sexta|sabado)\b/,
];

// "Jogos hoje / agenda"
const JOGOS_HOJE_PATTERNS: RegExp[] = [
  /\bjogos? (?:de )?hoje\b/,
  /\btem jogo (?:hoje|agora)\b/,
  /\bagenda\b/,
  // v3.32.0 (caso Humberto 11/06): inclui "estao/esta" — "quais jogos
  // estao rolando?" não casava (só vao|tao|tem) e caía na LLM.
  /\bquais jogos? (?:vao|tao|tem|est[aã]o?|esta) (?:hoje|rolando|acontecendo)\b/,
  /\bo que tem hoje\b/,
];

// v3.15.0 — PLACAR_JOGO: pergunta sobre placar/resultado de jogo
// RECENTE (Copa rolando — o banco TEM os placares via fetch-results a
// cada 5min). Antes caía em PERGUNTA_GERAL_FUTEBOL → LLM respondia
// "não tenho placar, checa na FIFA" mesmo com o dado no banco.
// PRECEDÊNCIA: deve vir ANTES de PERGUNTA_GERAL_FUTEBOL no INTENT_RULES.
// O handler delega de volta pra PERGUNTA_GERAL_FUTEBOL se a pergunta
// for fora de escopo (copa antiga, clube).
const PLACAR_JOGO_PATTERNS: RegExp[] = [
  /\bqual (?:e |eh |é )?o placar\b/,
  /\bquanto (?:ta|tá|esta|está|ficou|deu) o jogo\b/,
  /\bquanto (?:foi|terminou) o jogo\b/,
  /\bque placar (?:e|eh|é|foi|deu)\b/,
  /\bcomo (?:ficou|terminou|acabou|ta|tá) o jogo\b/,
  /\bquem ganhou\b/,
  /\bquem venceu\b/,
  /\bresultado (?:do |de |da )?(?:jogo|ontem|hoje|agora)\b/,
  /\bplacar (?:do |de |da )?(?:jogo|ontem|hoje|agora)\b/,
  /\bdeu quanto\b/,
  /\bja (?:acabou|terminou) o jogo\b/,
  /\bsaiu (?:o )?(?:placar|resultado)\b/,
  // v3.27.0 (caso real 11/06) — "qual foi placar de México e África?" e
  // "quais jogos já finalizaram?" caíam na LLM ("checa no site da FIFA")
  // mesmo com o placar no banco. Cobre pergunta por jogo específico e
  // por lista de finalizados.
  /\bqual foi (?:o )?(?:placar|resultado)\b/,
  /\bquais? (?:os |foram os )?jogos? (?:ja |j[áa] )?(?:finalizaram|finalizados|acabaram|terminaram|encerraram|encerrados|rolaram)\b/,
  /\bjogos? (?:finalizados?|encerrados?|conclu[íi]dos?)\b/,
  /\bjogos? que (?:ja|j[áa]) (?:rolaram|acabaram|terminaram|finalizaram|aconteceram)\b/,
  // Plural apenas: "jogo de ontem" (singular) aparece em frases de outros
  // intents ("quem pontuou no jogo de ontem?" → PALPITE_OUTROS).
  /\bjogos de ontem\b/,
  /\bresultados? de (?:hoje|ontem)\b/,
  /\bo que (?:ja|j[áa]) rolou\b/,
  /\bquem (?:esta|est[áa]|ta|t[áa]) ganhando\b/,
  // v3.32.0 (caso Humberto 11/06 23:49) — "quais jogos estão rolando?"
  // caía na LLM ("não sei") com o jogo AO VIVO no banco. Variações de
  // "rolando/acontecendo/ao vivo agora" → PLACAR_JOGO (mostra 🔴 + placar).
  // Precedência: PLACAR_JOGO vem antes de JOGOS_HOJE nas INTENT_RULES.
  /\b(?:quais?|que|qual) jogos? (?:est[aã]o?|esta|t[aã]o?|ta) (?:rolando|acontecendo|passando|em andamento)\b/,
  /\bjogos? (?:rolando|em andamento|ao vivo)\b/,
  /\btem (?:algum )?jogo (?:rolando|acontecendo|ao vivo|em andamento|agora)\b/,
  /\balgum jogo (?:rolando|acontecendo|agora|ao vivo)\b/,
  /\bo que (?:ta|t[aá]|esta|est[aá]) (?:rolando|acontecendo|passando)(?: agora)?\b/,
  /\bquais? jogos? (?:de )?agora\b/,
  // "placar do México", "placar de México e África" — placar de time
  // específico. Lookahead exclui "dos demais/outros/participantes/galera"
  // (esses são pedido de PALPITE dos outros → PALPITE_OUTROS).
  /\bplacar(?:es)? d[eoa]s? (?!demais|outr|participant|galera|pessoal|grupo|cada|quem|todos)\w/,
  // v3.21.0 (caso Bruna 11/06 16:39) — termos curtos/ambíguos que NÃO
  // mencionam jogo nem time. Bot trata como pergunta ambígua: mostra
  // placares dos jogos + sugere `ranking` pro bolão.
  /^placar(es)?\??$/, // "placar" / "placares" / "placar?" sozinho
  /^placar(es)?\s+de\s+todos\b/, // "placares de todos"
  /^mostrar (?:o |os )?placar/, // "mostrar placar" / "mostrar os placares"
  /\bme mostra (?:o |os )?placar/, // "me mostra o placar"
  /^resultados?\??$/, // "resultados" sozinho (não casa "resultados foram bons")
  /\bcomo (?:estao|estão|tao|tão|ta|tá) (?:o |os )?placar/, // "como tao os placares"
  /^como (?:foram|estao|estão) os jogos\??$/, // "como foram os jogos"
];

// v3.15.0 — PONTOS_DETALHE: breakdown de pontos por jogo recente.
// Distinto de MEUS_PONTOS (total geral): aqui o user quer saber o que
// ganhou em jogo/dia ESPECÍFICO. PRECEDÊNCIA: antes de MEUS_PONTOS.
const PONTOS_DETALHE_PATTERNS: RegExp[] = [
  /\bquantos? pontos? (?:eu )?(?:fiz|ganhei|pontuei|peguei) (?:ontem|hoje|nesse|neste|nessa|nesta|no jogo|com)/,
  /\bpontos? (?:de|do) (?:ontem|hoje)\b/,
  /\bpontuei (?:ontem|hoje|quanto ontem|quanto hoje|no jogo)/,
  /\bquanto (?:eu )?(?:fiz|pontuei|ganhei) (?:ontem|hoje|no jogo|nesse jogo)/,
  /\bacertei (?:o |meu |algum )?palpite/,
  /\bganhei pontos?\b/,
  /\bfiz pontos?\b/,
  /\bmeus pontos? (?:de|do) (?:ontem|hoje|cada jogo)/,
  /\bdetalhe[s]? (?:da |de )?(?:minha )?pontua/,
  /\bpontos? por jogo\b/,
  // Pontos de um JOGO específico ("pontuação em Brasil x Japão", "pontos no
  // jogo do Brasil"). Requer dois times (separador x/×) ou a palavra "jogo" —
  // assim "pontuação no mata-mata" NÃO cai aqui (vai pra INFO_PONTOS_MATAMATA).
  /\bpontua[cç][ãa]o (?:em|no|na|do|da) .+\s*[x×]\s*.+/i,
  /\bquantos? pontos? .*(?:no|na|em) (?:jogo )?(?:d[oae] )?.+\s*[x×]\s*.+/i,
  /\bpontos? (?:no|do|da) jogo (?:d[oae] )?\w+/i,
  /\bquantos? pontos? .*\bjogo (?:d[oae] )?\w+/i,
  /\bpontua[cç][ãa]o (?:em|no|na|do|da) (?:o )?jogo\b/i,
];

// v3.38.0 — ESTATISTICA_PONTOS: quebra dos pontos do user por FAIXA
// (quantas cravadas/10, quantos de 7/5/3, quantos zerou). Distinto de:
//   - PONTOS_DETALHE (breakdown por JOGO das últimas 48h)
//   - MEUS_PONTOS (só o total geral)
// Caso real Humberto 22/06: "Quantos jogos eu fiz 10ponto?" e "de todos
// meus palpites, quantos acertei o placar exato?" caíam em PONTOS_DETALHE
// (lista 48h), que não CONTA por faixa nem cobre o histórico todo.
//
// PRECEDÊNCIA: deve vir ANTES de PONTOS_DETALHE e MEUS_PONTOS nas
// INTENT_RULES. Os patterns EXIGEM menção a faixa/estatística pra NÃO
// roubar "quantos pontos fiz ontem" (→ PONTOS_DETALHE) nem "meus pontos"
// (→ MEUS_PONTOS). Read-only — handler nunca registra palpite.
const ESTATISTICA_PONTOS_PATTERNS: RegExp[] = [
  // Faixa específica por nº de pontos: "quantos fiz 10 pontos?", "quantos
  // jogos eu fiz 10ponto", "quantos de 7", "quantas vezes tirei 5 pontos".
  // Aceita número grudado em "ponto" ("10ponto") e singular ("ponto").
  /\bquant[oa]s?\b.*\b(?:fiz|tirei|peguei|acertei|cravei|ganhei|pontuei|de)\b.*\b(?:10|dez|7|sete|5|cinco|3|tres)\s*pontos?\b/,
  /\bquant[oa]s?\b.*\b(?:10|dez|7|sete|5|cinco|3|tres)\s*pontos?\b.*\b(?:fiz|tirei|peguei|acertei|cravei|ganhei|pontuei)\b/,
  // Cravadas / placar exato / em cheio.
  /\bquant[oa]s?\b.*\bcravad/,
  /\bquant[oa]s?\b.*\bplacar(?:es)? exato/,
  /\bacertei em cheio\b/,
  /\bquant[oa]s? (?:vezes )?(?:eu )?cravei\b/,
  /\bacertei (?:o )?placar exato\b/,
  /\bcravei (?:o )?placar\b/,
  // Zerados / errou tudo.
  /\bquant[oa]s?\b.*\b(?:zerei|errei tudo|fiz 0|fiz zero|tirei 0|tirei zero)\b/,
  // Resumo/estatística geral dos pontos.
  /\bestatistica.*pont/,
  /\bresumo\b.*\bpont/,
  /\bquebra\b.*\bpont/,
  /\bdetalhamento\b.*\bpont/,
  /\bcomo (?:eu )?(?:cheguei|fiz|formei|montei|somei) .*\btotal\b/,
  /\bde onde (?:vem|sai|saem|saiu|vieram|sairam) .*pontos?\b/,
  /\bmeu aproveitamento\b/,
  /\bminha m[ée]dia de pontos?\b/,
];

// v3.39.0 — JOGOS_POR_FAIXA: drill-down da estatística. Diferente de
// ESTATISTICA_PONTOS (que CONTA: "quantas cravadas"), aqui o user quer a
// LISTA dos jogos de uma faixa ("quais jogos eu cravei?", "quais fiz 7
// pontos?"). Caso Humberto 22/06: "Quais jogos eu cravei?" caía no handler
// genérico de pontuação.
//
// Todos os patterns EXIGEM um gatilho de LISTAGEM (quais/que jogos/me
// mostra/ver/lista/em quais) + uma faixa. Como ESTATISTICA exige "quantos/
// quantas", os dois não colidem. PRECEDÊNCIA: JOGOS_POR_FAIXA vem ANTES de
// ESTATISTICA_PONTOS nas INTENT_RULES (pra "quais ... cravei o placar"
// LISTAR, não cair no "acertei o placar"→contagem da ESTATISTICA).
const _GATILHO_LISTA = '(?:quais?|que|me mostra|mostra|mostrar|ver|listar?|liste|quero ver|em quais)';
const JOGOS_POR_FAIXA_PATTERNS: RegExp[] = [
  // Cravadas / placar exato / em cheio (faixa 10)
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\bcravei\\b`),
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\bcravad`),
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\bplacar(?:es)? exato`),
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\bacertei (?:o )?placar`),
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\bem cheio\\b`),
  // Por nº de pontos (10/7/5/3)
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\b(?:10|dez|7|sete|5|cinco|3|tres)\\s*pontos?\\b`),
  /\bquais?\b.*\b(?:fiz|tirei|peguei|deu|deram|valeu|valeram|foram?)\b.*\b(?:10|dez|7|sete|5|cinco|3|tres)\b/,
  // Zerados / errou tudo (faixa 0)
  new RegExp(`\\b${_GATILHO_LISTA}\\b.*\\b(?:zerei|errei tudo|nao pontuei|fiz 0|fiz zero|tirei 0|tirei zero)\\b`),
];

// v3.15.0 — STATUS_RODADA: quando atualiza ranking/pontos/resultado.
const STATUS_RODADA_PATTERNS: RegExp[] = [
  /\bquando (?:atualiza|sai|calcula|computa) (?:o |a |os |as )?(?:ranking|resultado|ponto|pontua)/,
  /\bquando (?:os |meus )?pontos? (?:sao|s[ãa]o|serao|ser[ãa]o|vao ser|v[ãa]o ser) (?:calculad|atualizad|computad)/,
  /\branking (?:ja |j[áa] )?(?:atualizou|atualiza|foi atualizado)\b/,
  /\bpontos? (?:ja |j[áa] )?(?:atualizaram|sairam|sa[íi]ram|cairam|ca[íi]ram|entraram)\b/,
  /\bdemora (?:quanto|muito) (?:pra|para) (?:atualizar|calcular|sair)/,
  /\bcadê (?:meus |os )?pontos?\b/,
  /\bcade (?:meus |os )?pontos?\b/,
];

// v3.15.0 — DESABAFO_RANKING: user lamentando desempenho ruim.
// Acolhimento, não menu frio. Inspirado no ACOLHIMENTO_NOVATO (v3.9.0).
const DESABAFO_RANKING_PATTERNS: RegExp[] = [
  /\b(?:to|tou|estou|t[ôo]) (?:em |na )?[úu]ltim[oa]\b/,
  /\b(?:to|tou|estou|t[ôo]) perdendo\b/,
  /\bfui (?:muito |super |mega )?mal\b/,
  /\b(?:to|tou|estou|t[ôo]) (?:muito |bem )?mal no (?:bol[ãa]o|ranking)/,
  /\bnunca acerto\b/,
  /\bs[óo] erro\b/,
  /\bque vergonha (?:d[oe]s? meus?|minha)? ?(?:palpites?|pontua)?/,
  /\bn[ãa]o ganho (?:nunca|nada)\b/,
  /\bdesisto\b/,
];

// v3.15.0 — RECLAMACAO_BUG: user reportando erro no bot/pontuação.
// v3.17.0 — PALPITE_OUTROS: usuário perguntando se vai ver palpite/
// performance dos OUTROS. Caso real Camila 11/06 (print 1): respostas
// defensivas "não" em sequência confundiam — agora explicamos o
// público (ranking total) vs privado (placar individual) e oferecemos
// alternativa útil (*pontos de ontem* mostra acertos por jogo do user).
// PRECEDÊNCIA: antes de PROGRESSO_PALPITES (que mostra X/Y palpites
// agregados) e antes de MEU_PALPITE (que é sobre o próprio user).
const PALPITE_OUTROS_PATTERNS: RegExp[] = [
  // "palpites do fulano / dos outros / da galera / do grupo"
  /\bpalpites? (?:d[oa]s? )?(?:outr[oa]s?|fulan[oa]|amig[oa]s?|galera|grupo|pessoal|participantes?)/,
  /\bpalpites? d[ea] (?:quem|cada um|todo mundo)\b/,
  /\bpalpites? individua/,
  // "quem acertou / pontuou / fez pontos no jogo X"
  /\bquem (?:ja )?(?:acertou|pontuou|fez pontos?|fez tantos?|tirou) /,
  // "vai me mostrar / falar palpite/quem dos outros"
  /\b(?:vai |vc vai |voc[êe] vai )?(?:me )?(?:mostrar|falar|dizer|contar) (?:quem|os? palpites? d|o que cada)/,
  // "como vejo o palpite do fulano / como sei o que o fulano palpitou"
  /\bcomo (?:vejo|sei|descubro|consigo ver) (?:o )?palpite/,
  /\bcomo sei o que (?:o |a )?(?:fulan|outr|amig|partic|jog)/,
  // "ver palpites dos participantes / lista de palpites"
  /\bver palpites? (?:d[oa]s? )?(?:outr|partic|amig|galer|jogador|fulan)/,
  /\blista de palpites?\b/,
  // "o que o fulano palpitou"
  /\bo que (?:o |a )?(?:fulan|outr|cada um|cada pessoa)/,
  // v3.24.0 — pedido direto de ver os palpites de todos / do jogo (revelação
  // pós-kickoff). "palpites de todos", "palpites do jogo", "ver os palpites
  // do jogo". (Não colide com MEU_PALPITE: exige "de todos"/"do jogo".)
  /\bpalpites? de todos?\b/,
  /\bpalpites? d[oe] jogo\b/,
  /\b(?:ver|mostra(?:r)?|quero ver|me mostra) (?:os |o )?palpites? d[oe] (?:jogo|todos)/,
  // v3.27.0 (caso real 11/06) — user pediu "os placares dos demais
  // participantes no jogo X" (jogo já finalizado) e caiu na LLM, que
  // respondeu errado ("só depois que o jogo começa"). "placar dos
  // demais/outros/participantes" = palpite dos outros, não placar oficial.
  /\bplacar(?:es)? d[oa]s? (?:demais|outr[oa]s|participantes?|galera|grupo|pessoal|colegas?|amig[oa]s?)\b/,
  /\bpalpites? d[oa]s? demais\b/,
  /\bo que (?:os outros|a galera|o pessoal|cada um|todo mundo|os demais) (?:cravou|cravaram|apostou|apostaram|palpitou|palpitaram|botou|botaram|colocou|colocaram|chutou|chutaram)\b/,
  /\bquem (?:cravou|apostou|botou|chutou) o qu[eê]\b/,
];

// PRECEDÊNCIA: antes de MEUS_PONTOS ("meus pontos estão errados").
// Handler loga pra revisão offline + acolhe + explica recálculo.
const RECLAMACAO_BUG_PATTERNS: RegExp[] = [
  /\b(?:meus? |a |minha )?pont(?:os?|ua[cç][ãa]o) (?:esta|est[ãa]o|ta|t[ãa]o|t[áa]) errad[oa]s?\b/,
  /\b(?:ta|t[áa]|esta|est[áa]|isso (?:ta|t[áa]|esta|est[áa])) bugado\b/,
  /\bbot (?:ta|t[áa]|esta|est[áa]) (?:errado|bugado|doido|maluco|com problema)\b/,
  /\bcalculou errado\b/,
  /\bcontou errado\b/,
  /\bn[ãa]o (?:bateu|bate) (?:a |minha )?pontua/,
  /\bvoce (?:ta|t[áa]|esta|est[áa]) errado\b/,
  /\bvc (?:ta|t[áa]|esta|est[áa]) errado\b/,
  /\btem (?:um )?erro (?:na|no|aqui|nos)\b/,
  /\bachei (?:um )?erro\b/,
  /\bdeveria ter (?:mais|ganhado) pontos?\b/,
  /\bfaltou pontos?\b/,
  /\bmeu ponto sumiu\b/,
  /\bpontos? sumiram\b/,
  // "meus pontos do Brasil x Japão estão errados" (palavras entre pontos↔errado)
  /\bpont(?:os?|ua[cç][ãa]o)\b[^.!?]{0,40}\berrad[oa]s?\b/,
  /\bfaltando ponto/,
];

// "Meus pontos / quanto fiz / pontuacao"
const MEUS_PONTOS_PATTERNS: RegExp[] = [
  /^meus? pontos?\b/,
  /^pontos?$/,                       // "pontos" / "ponto" sozinho
  /^pontua[cç][aã]o$/,               // "pontuação" / "pontuacao" sozinho (Bug Humberto 18/05)
  /^minha pontua[cç][aã]o\b/,
  /^score\b/,
  /^meu score\b/,
  /\bquantos? ponto/,
  /\bquanto (?:eu )?fiz\b/,
  /\bquanto (?:eu )?pontuei\b/,
  /\bminha pontuacao\b/,
  /\bmeu placar\b/,
  /\bestou (?:em )?qual (?:posicao|lugar)\b/,
  /\bem que (?:posicao|lugar) (?:eu )?(?:estou|to)\b/,
];

// "Meus boloes / onde participo"
const MEUS_BOLOES_PATTERNS: RegExp[] = [
  /^meus? bol(?:o|a)es\b/,
  /\bquais (?:sao )?(?:os )?meus bol(?:o|a)es\b/,
  /\bquais bol(?:o|a)es\b/,
  /\bonde (?:eu )?(?:participo|jogo|to)\b/,
  /\bbol(?:o|a)es que (?:eu )?(?:participo|to)\b/,
];

// "Criar bolao / abrir / montar / fazer novo"
const CRIAR_BOLAO_PATTERNS: RegExp[] = [
  /^criar (?:um )?bol(?:a|o)o\b/,
  /^criar$/,
  /\b(?:quero|bora|vamos|gostaria de) (?:criar|abrir|montar|fazer)(?: um)? bol(?:a|o)o\b/,
  /\b(?:abrir|montar|fazer)(?: um)? bol(?:a|o)o (?:novo|new)\b/,
  /\bnovo bol(?:a|o)o\b/,
  // v3.40.0 — pergunta com verbo de CRIAÇÃO (caso real "como posso fazer um
  // bolao da minha familia?"). Os patterns acima exigiam imperativo no início
  // (quero/bora/...), então perguntas caíam no LLM→DESCONHECIDO. Seguro:
  // REGRAS/COMO_PALPITAR/INFO_PRODUTO vêm ANTES nas INTENT_RULES, então
  // "como funciona o bolão" (sem verbo de criação) continua INFO/AJUDA.
  /\bcomo (?:eu )?(?:posso |faco pra |se )?(?:criar|crio|fazer|faco|abrir|abro|montar|monto|come[cç]ar)\b.*\bbol(?:a|o)o/,
  // Imperativo 3ª pessoa: "cria um bolão", "faz um bolão pra família".
  /\b(?:cria|faz|monta|abre)(?: um| o)? bol(?:a|o)o\b/,
];

// "Entrar em bolao / participar"
const ENTRAR_BOLAO_PATTERNS: RegExp[] = [
  /^entrar(?: em| no)?(?: bol(?:a|o)o)?$/,
  /\b(?:quero|gostaria de|posso) entrar (?:em|no)?\s*bol/,
  /\bentrar (?:em|num|no) bol(?:a|o)o\b/,
  /\bme add (?:em|num|no) bol/,
  /\bquero participar\b/,
  /\bjuntar (?:no|num|em) bol/,
  /\bquero jogar\b/,
];

// "Ranking / classificacao"
const RANKING_PATTERNS: RegExp[] = [
  /^ranking\b/,
  /^tabela$/, // "tabela" sozinha = ranking do bolão (grupo/copa caem antes em PERGUNTA_GERAL)
  /\bclassificacao\b/,
  /\bquem (?:ta|esta) na frente\b/,
  /\bquem (?:ta|esta) ganhando\b/,
  /\btabela do bol/,
  // Bug Jeni 17/05: "Quero ver o ranking" — trigger no fim, nao so no comeco
  /\b(?:quero|queria|preciso|gostaria de|gostava de)(?: eu)?(?: ver| saber| consultar| conferir)? (?:o |a )?(?:ranking|tabela|classificacao)\b/,
  /\b(?:me )?(?:mostra|mostrar|manda|passa|envia|abre|abrir|exibe|exibir)(?: o| a)?(?: bolao)? (?:ranking|tabela|classificacao)\b/,
  /\b(?:ver|conferir|consultar|saber)(?: o| a)? (?:ranking|tabela|classificacao)\b/,
  /\bqual (?:o |a |eh o |eh a |esta o |esta a )?(?:ranking|tabela|classificacao)\b/,
];

// "Obrigado / valeu / brigado" — cordialidade, nao saudacao.
//
// v3.18.0 (caso Lucas 11/06 — loop com auto-reply do WhatsApp Business):
// patterns ENDURECIDOS pra exigir final de mensagem ou pontuação após
// a palavra, evitando casar frases como "Agradeço seu contato, respondo
// em breve" (auto-reply tipica). A defesa principal contra auto-reply
// é `auto-reply.detector.ts` (camada 1); este endurecimento é a
// camada 2 (defesa em profundidade) — se a heurística falhar, ainda
// assim o pattern aqui não casa frase longa.
//
// Mensagens MAIORES que 30 chars NÃO casam AGRADECIMENTO (validação no
// caller `matchIntent`). "Obrigado" puro casa; "Obrigado pelo contato,
// retorno em breve" (40+ chars) não casa.
const AGRADECIMENTO_PATTERNS: RegExp[] = [
  /^(?:muito |mt )?obrigad[ao](?:[!.\s]*(?:mesmo|demais|demaaais|muito|mt|vc|voc[êe]|tio|cara|men|mano|mana|amig[ao]))?[!.\s]*$/,
  /^(?:muito |mt )?brigad[ao](?:[!.\s]*(?:mesmo|demais|muito|mt|vc|voc[êe]|cara|men|mano))?[!.\s]*$/,
  /^obrigadao[!.\s]*$/,
  /^brigadao[!.\s]*$/,
  /^valeu(?:[!.\s]*(?:mesmo|demais|muito|cara|men|mano|amig[ao]|tio))?[!.\s]*$/,
  /^vlw+[!.\s]*$/,
  /^thx[!.\s]*$/,
  /^thanks?[!.\s]*$/,
  /^tmj[!.\s]*$/,
  /^tamo junto[!.\s]*$/,
  /^agradecid[ao][!.\s]*$/,
  // "Agradeço" / "Agradeço!" / "Agradeço você" / "Agradeço mesmo".
  // NÃO casa "Agradeço seu contato, respondo em breve" (auto-reply).
  /^agrade[cç]o(?:[!.\s]*(?:vc|voc[êe]|mesmo|demais|muito|mt))?[!.\s]*$/,
];

// "Tchau / até / flw" — usuario encerrando a conversa
const DESPEDIDA_PATTERNS: RegExp[] = [
  /^tchau\b/,
  /^xau(zinho)?\b/,
  /^at[eé] (?:logo|mais|amanh[aã]|breve|depois|j[aá]|qualquer)\b/,
  /^at[eé]\s*\+\s*$/,
  /^falou(?: men| brother| veio| irmao)?\b/,
  /^fal[ou]w\b/,
  /^flw+\b/,
  // "fui" = tchau em gíria, MAS "fui mal" = lamento de desempenho
  // (v3.15.0: DESABAFO_RANKING). Negative lookahead evita roubo.
  /^fui\b(?!\s+(?:muito\s+|super\s+|mega\s+)?mal)/,
  /^abra[cç]os?\b/,
  /^abs\b/,
  /^bjs?\b/,
  /^beijos?\b/,
  /^bjao\b/,
  /^bjs gente\b/,
  /^se cuida\b/,
  /^boa noite$/, // saudacao de despedida (so quando isolada — SAUDACOES set ja pega isso, mas explicito)
];

// "Tudo bem? / blz? / suave?" — small talk
// IMPORTANTE: padroes com `?` no final exigem o caractere de interrogacao
// pra disambiguar "blz" (concordancia, sem ?) vs "blz?" (pergunta social).
// Formas afirmativas sao tratadas em CONCORDANCIA_CASUAL_PATTERNS.
const CUMPRIMENTO_CASUAL_PATTERNS: RegExp[] = [
  /\btudo (?:bem|bom|certo|tranquilo|jo[ií]a|joia)\b/,
  /\bt[aá] (?:tudo|tranquilo|de boa)\b/,
  // "como vai/ta/esta/anda" — mas NAO "como ta a chave/bracket/chaveamento/
  // mata-mata" (essas sao VER_CHAVE; o lookahead evita roubar a pergunta e
  // bloquear o fallback de classificacao).
  /\bcomo (?:voc[eê] )?(?:vai|ta|esta|anda|vai indo)\b(?!.*\b(?:chave|bracket|chaveamento|mata[\s-]?mata)\b)/,
  /^blz\?$/,
  /^belezinha\?$/,
  /^td certo\?$/,
  /^td bem\?$/,
  /^suave\?$/,
  /^firmeza\?$/,
  /^de boa\?$/,
];

// "Ok / beleza / show / massa" — concordancia/acknowledgement casual em IDLE.
// IMPORTANTE: em CONFIRMANDO_* states, o FSM dispatcher pega antes e interpreta
// via `interpretarSimNao` (bolao.matcher.ts) — entao "ok" dentro de CONFIRMANDO_SAIR_BOLAO
// continua sendo SIM. Esta intent so dispara em IDLE (apos FSM passar).
//
// Patterns SAO RESTRITIVOS (^...$) pra nao pegar palavras incidentais em frases longas.
const CONCORDANCIA_CASUAL_PATTERNS: RegExp[] = [
  /^ok+\b\s*[.!]?\s*$/,
  /^okay\b\s*[.!]?\s*$/,
  /^beleza\b\s*[.!]?\s*$/,
  /^blz\b\s*[.!]?\s*$/,
  /^show( de bola)?\b\s*[.!]?\s*$/,
  /^massa\b\s*[.!]?\s*$/,
  /^maneiro\b\s*[.!]?\s*$/,
  /^legal\b\s*[.!]?\s*$/,
  /^fechou\b\s*[.!]?\s*$/,
  /^fech[oô]u?\b\s*[.!]?\s*$/,
  /^combinado\b\s*[.!]?\s*$/,
  /^tranquilo\b\s*[.!]?\s*$/,
  /^tranq\b\s*[.!]?\s*$/,
  /^perfeito\b\s*[.!]?\s*$/,
  /^top( demais)?\b\s*[.!]?\s*$/,
  /^d[aá] certo\b\s*[.!]?\s*$/,
  /^entendi(?: po| sim| beleza)?\b\s*[.!]?\s*$/,
  /^saquei\b\s*[.!]?\s*$/,
  /^boa\b\s*[.!]?\s*$/, // como elogio curto: "boa!"
];

// "kkkk / rsrs / hahaha" — risada isolada
const RISADA_PATTERNS: RegExp[] = [
  /^k{2,}$/,
  /^(?:rs){2,}$/,
  /^rsrs+$/,
  /^(?:ha){2,}h?$/,
  /^(?:he){2,}h?$/,
  /^(?:hue){2,}$/,
  /^k{1,3}(?:\s+k{1,3}){1,}$/, // "kk kk" e variantes
  /^😂{1,}\s*😂*$/u,
  /^🤣{1,}\s*🤣*$/u,
  /^😆{1,}\s*😆*$/u,
];

// "Abrir rodada / iniciar / começar bolao"
const ABRIR_RODADA_PATTERNS: RegExp[] = [
  /\babrir rodada\b/,
  /\biniciar rodada\b/,
  /\bcomec[aá]r rodada\b/,
  /\bcomec[aá]r o bol(?:a|o)o\b/,
  /\babre (?:os )?palpites?\b/,
  /\babrir (?:os )?palpites?\b/,
  /\biniciar (?:os )?palpites?\b/,
  /\bcomo (?:eu )?(?:abro|inicio|comeco)( a)? rodada\b/,
];

// "Como convidar / compartilhar / chamar gente"
const COMO_CONVIDAR_PATTERNS: RegExp[] = [
  /\bcomo (?:eu )?(?:convido|compartilho|chamo)\b/,
  /\bcomo (?:fac[oç]o pra )?(?:convidar|chamar)\b/,
  /\bmandar (?:o )?convite\b/,
  /\bpegar (?:o )?(?:convite|link|id)( do bol)?/,
  /\bconvidar (?:pessoas?|gente|amigos?|galera)\b/,
  /\bcomo (?:eu )?(?:adiciono|add) (?:gente|amigos?|pessoas?)\b/,
  /\bquero (?:convidar|chamar) (?:gente|amigos?|pessoas?|galera)\b/,
  /\bmensagem de convite\b/,
];

// "Sair do bolao / quero sair"
const SAIR_BOLAO_PATTERNS: RegExp[] = [
  /\bsair (?:de|do)? bol(?:a|o)o\b/,
  /\bquero sair\b/,
  /\bme (?:tira|remove)\b/,
  /\bnao quero mais (?:jogar|participar)\b/,
  /\bdesistir do bol(?:a|o)o\b/,
];

// "Quem participa / quem esta no bolao / lista do bolao"
const QUEM_PARTICIPA_PATTERNS: RegExp[] = [
  /\bquem (?:ta|esta) no bol(?:a|o)o\b/,
  /\bquem participa\b/,
  /\bquem (?:joga|esta jogando) no bol/,
  /\blista (?:de )?(?:participantes?|gente|jogadores?)\b/,
  /\bparticipantes do bol/,
];

// "Regras do bolao / como pontua / pontuacao"
// IMPORTANTE: nao pode bater "como funciona" generico (que vira AJUDA).
const REGRAS_PATTERNS: RegExp[] = [
  /^regras?\b/,
  /\bregras (?:do |de )?bol/,
  /\bcomo (?:eu )?(?:pontuo|pontua)\b/,
  /\bcomo (?:eu )?ganho ponto/,
  /\bcomo (?:eh|funciona) (?:a )?pontuacao\b/,
  /\bpontuacao do bol/,
  /\bcriterio de pontuacao\b/,
  /\bquantos? pontos? (?:eu )?(?:ganho|faco|pego) (?:por|quando)/,
  /\bvalor (?:dos )?palpites?\b/,
];

// "Senha do bolao / qual a senha" — ISSUE-005. Bolao agora usa ID, nao
// senha (decisao de produto). Handler explica isso sem custo de LLM.
const INFO_SENHA_PATTERNS: RegExp[] = [
  /\bqual (?:a |e a )?senha\b/,
  /\bsenha (?:do |de )?bol(?:a|o)o\b/,
  /\besqueci (?:a )?senha\b/,
  /\bnao (?:sei|lembro) (?:a )?senha\b/,
  /\bme (?:passa|fala|manda|envia) (?:a )?senha\b/,
  /\bpreciso (?:da |de uma )?senha\b/,
  /\bcomo (?:eu )?(?:pego|consigo|descubro) (?:a )?senha\b/,
];

// "Excluir/deletar/apagar bolao" (admin) — ISSUE-006
const EXCLUIR_BOLAO_PATTERNS: RegExp[] = [
  /\bexcluir (?:o |um |meu |esse )?bol(?:a|o)o\b/,
  /\bdeletar (?:o |um |meu |esse )?bol(?:a|o)o\b/,
  /\bencerrar (?:o |um |meu |esse )?bol(?:a|o)o\b/,
  /\bfinalizar (?:o |meu |esse )?bol(?:a|o)o\b/,
  /\bapagar (?:o |um |meu |esse )?bol(?:a|o)o\b/,
  /\bquero (?:excluir|deletar|encerrar|apagar|fechar)(?: o)? bol(?:a|o)o\b/,
  /\b(?:fechar|terminar) (?:o |meu )?bol(?:a|o)o\b/,
];

// Sprint 2 — handlers de pergunta frequente

// ISSUE-009: "o que e isso", "pra que serve", "como funciona o bot"
// Especifico: NAO bater quando frase eh "como funciona a pontuacao" (REGRAS) ou
// "como dou palpite" (COMO_PALPITAR — vem depois).
const INFO_PRODUTO_PATTERNS: RegExp[] = [
  /\bo que (?:e|eh) (?:esse |o |essa )?(?:bot|var|app|sistema|servic[oa]|aplicativo|var do bol)/,
  /\bpra (?:que |q )serve\b/,
  /\bpara (?:que |q )serve\b/,
  /\bcomo (?:isso |esse bot |o bot )?funciona\??$/,
  /\bque(?: que)? (?:e|eh) (?:isso|esse bot|o var)/,
  /\bsobre (?:o |esse )?(?:bot|var)/,
];

// ISSUE-010: "quanto custa", "eh gratis", "tem que pagar"
const INFO_PRECO_PATTERNS: RegExp[] = [
  /\bquanto custa\b/,
  /\bcobra (?:algum )?(?:valor|dinheiro)\b/,
  /\b(?:eh|e) (?:de )?(?:gratis|gratuito|free|de gra[cç]a)\b/,
  /\b(?:tem|paga|pago) (?:que )?pagar\b/,
  /\bvalor (?:do bol(?:a|o)o|pra (?:criar|entrar))\b/,
  /\bpre[cç]o (?:do bol(?:a|o)o|pra (?:criar|entrar))\b/,
  /\bcusta (?:quanto|algum)/,
  /\bcobra (?:alguma )?taxa\b/,
];

// v3.9.0 — DICAS_PALPITE: usuario quer ESTRATEGIA pra montar palpite.
// Distinto de COMO_PALPITAR (formato/sintaxe) e de INFO_PRODUTO (pitch).
// Caso real Valeria 22/05: "voce tem dicas de como montar os palpites?"
// caiu em INFO_PRODUTO porque "como" + "palpites" matchou heuristica errada.
//
// Resposta determinística: pontuação resumida + placares comuns em Copa +
// 4 dicas práticas (palpita em tudo, foca em vencedor, vai no coração se
// não souber, dá pra editar). NÃO dá dica de aposta (só de uso do bolão).
const DICAS_PALPITE_PATTERNS: RegExp[] = [
  /\btem (?:alguma )?dicas?\b/,
  /\bdicas? (?:de |pra |para )?palpit(?:ar|e)/,
  /\bdicas? (?:de |pra |para )?(?:montar|fazer|dar) palpite/,
  /\b(?:tem |alguma )?dicas? (?:boas? )?pra (?:eu )?palpitar/,
  /\bdica (?:de |para |pra )?bol[ãa]o/,
  /\bcomo (?:eu )?(?:monto|montar) (?:um |o |os |meus? )?palpites?/,
  /\bcomo (?:eu )?decid(?:o|ir) (?:o |um |meu )?(?:palpite|placar)/,
  /\bcomo (?:eu )?escolh(?:o|er) (?:o |um |meu )?(?:palpite|placar|time)/,
  /\bqual (?:o |eh o )?melhor (?:palpite|placar|chute)/,
  /\bqual (?:o |eh o )?palpite (?:bom|melhor|certo|ideal)/,
  /\bqual placar (?:eh |e )?(?:mais )?(?:comum|provavel|prov[áa]vel)/,
  /\b(?:tem |existe |alguma )?estrat[eé]gia\b/,
  /\b(?:tem |existe |algum )?segredo (?:de |pra |para )?palpit/,
  /\bme ensina (?:a |como )?palpitar/,
  /\bme d[áa] uma (?:dica|luz)/,
];

// v3.9.0 — ACOLHIMENTO_NOVATO: usuario expressa inseguranca/vulnerabilidade
// ("nao entendo de futebol", "to perdida", "primeira vez", "vou errar
// tudo"). Caso real Valeria 22/05: "nao entendo de futebol" caiu em
// fallback genérico, perdendo oportunidade de engajamento.
//
// Resposta acolhedora: "relaxa, não precisa entender nada" + validação
// (gente palpita no coração e ganha) + 3 passos básicos + CTAs leves.
const ACOLHIMENTO_NOVATO_PATTERNS: RegExp[] = [
  /\b(?:nao|n[ãa]o) (?:entendo|sei|manjo|saco) (?:nada |muito |bem )?(?:de |sobre )?futebol/,
  /\b(?:nao|n[ãa]o) (?:conheco|conheço) (?:nada |muito )?(?:de |sobre )?futebol/,
  /\b(?:nao|n[ãa]o) sou (?:muito )?(?:de |fa de |f[ãa] de )futebol/,
  /\bfutebol (?:nao|n[ãa]o) (?:eh |e )?(?:meu |minha )?(?:forte|coisa|praia)/,
  /\b(?:to|tou|estou) (?:meio |bem |totalmente )?perdid[ao]\b/,
  /\b(?:eh|e|sou) (?:a |minha |meu |novo |nova )?(?:primeira vez|novat[oa])\b/,
  /\bprimeira vez (?:que |aqui )?(?:palpit|jog|fa[cç]o|no bol)/,
  /\bnunca (?:palpitei|joguei|fiz )(?:bol[ãa]o|isso)?/,
  /\bnunca (?:fiz |participei )(?:de )?bol[ãa]o/,
  /\b(?:to|tou|estou) (?:com )?medo de errar/,
  /\b(?:vou|posso) errar tudo\b/,
  /\b(?:nao|n[ãa]o) sei (?:qual|que) time/,
  /\b(?:nao|n[ãa]o) sei (?:nem )?quem (?:joga|vai jogar|ta jogando)/,
  /\bsou (?:leiga|leigo|iniciante|novata?o?) (?:em |de )?(?:futebol|bol[ãa]o)/,
  /\b(?:nao|n[ãa]o) sei (?:nada )?(?:do |sobre )?(?:bol[ãa]o|isso)\b/,
];

// ISSUE-017: "como dou palpite", "como palpitar", "como faco palpite"
// Distinto de PROXIMOS_JOGOS ("quero palpitar"): aqui o user quer SABER COMO,
// nao iniciar o ato. PROXIMOS_JOGOS usa verbo de acao + obj; este usa "como" + verbo.
const COMO_PALPITAR_PATTERNS: RegExp[] = [
  /\bcomo (?:eu )?(?:dou|faco|mando|registro|fa[cç]o|envio) (?:um |o |meu |novo |os )?palpites?\b/,
  /\bcomo (?:se )?(?:palpita|palpitar|da palpite)\b/,
  /\bcomo (?:eu )?da(?:r|ria) (?:um )?palpites?\b/,
  /\bcomo (?:funciona|eh) (?:dar |de dar )?palpite\b/,
  /\bjeito (?:de |pra )?palpitar\b/,
  /\bformato (?:do |de )?palpite\b/,
  /\bnao sei (?:como )?palpitar\b/,
];

// ISSUE-018: "quando comeca", "quando termina", "quando abre rodada"
const QUANDO_COMECA_PATTERNS: RegExp[] = [
  /\bquando (?:comeca|come[cç]a|inicia)\b/,
  /\bquando (?:termina|acaba|encerra|finaliza)\b/,
  /\bquando (?:abre|fecha) (?:a )?(?:rodada|partida|jogo)\b/,
  /\b(?:qual|que) (?:dia|data|hora) (?:comeca|come[cç]a|inicia|termina|fecha|abre)\b/,
  /\bquando (?:eh|e) (?:a |o )?(?:proxim[oa] )?(?:rodada|jogo|partida)\b/,
  /\bdata (?:da|do) (?:proxim[oa] )?(?:rodada|jogo|partida)\b/,
  // Mata-mata: "quando começa o mata-mata", "quando são os 16-avos/oitavas"
  /\bquando (?:comeca[m]?|come[cç]a[m]?|sao|s[ãa]o|eh|e|inicia[m]?) (?:os |as |o |a )?(?:16[\s-]?avos|dezesseis avos|mata[\s-]?mata|matamata|oitavas|quartas|semi|final)/,
  // "que horas/dia é a final/semi/oitavas" — fase sem time → trata como agenda da fase.
  /\b(?:que|qual) (?:horas?|dia|data) (?:e|eh|é|s[ãa]o|comeca[m]?) (?:a |o |as |os )?(?:final|semi(?:final)?|quartas|oitavas|16[\s-]?avos|mata[\s-]?mata)\b/,
];

// ============================================================
// Mata-mata (Copa 2026) — dúvidas frequentes. Regex-first, resposta fixa.
// Vêm ANTES de REGRAS/PERGUNTA_GERAL_FUTEBOL nas INTENT_RULES.
// ============================================================
const INFO_PRORROGACAO_PATTERNS: RegExp[] = [
  /\bprorroga[çc][ãa]o\b/,
  /\btempo extra\b/,
  /\bvai pr[ao] (?:tempo )?extra\b/,
];
const INFO_PENALTI_PATTERNS: RegExp[] = [
  /\bp[êe]naltis?\b.*\b(conta[m]?|vale[m]?|entra[m]?|n[ãa]o)\b/,
  /\b(conta[m]?|vale[m]?|entra[m]?|e os?|e as|tem)\b.*\bp[êe]naltis?\b/,
  /\bdisputa de p[êe]naltis?\b/,
  /\bnos p[êe]naltis?\b.*\b(conta|vale|placar)\b/,
];
const INFO_EMPATE_MATAMATA_PATTERNS: RegExp[] = [
  /\b(e )?se (der )?empat(ar|e|ou)\b/,
  /\bcomo (?:eu )?palpit(?:o|ar) (?:um |o )?empate\b/,
  /\bempate no mata[\s-]?mata\b/,
  /\bdeu empate\b.*\b(e agora|quem passa|o que)\b/,
  // "como faço se achar que vai dar empate" — sem placar (não é palpite).
  /\bdar empate\b/,
  /\bvai (?:dar|ser) (?:um )?empate\b/,
];
const INFO_PONTOS_MATAMATA_PATTERNS: RegExp[] = [
  /\bos? pontos? (?:aumenta|subir|sobe|muda|cresce|subiram|cresceram)/,
  /\bquanto (?:vale|valem)\b.*\b(agora|mata[\s-]?mata|final|semi|quartas|oitavas|16[\s-]?avos)\b/,
  /\bquanto (?:vale|valem) (?:a |o )?(?:final|semi|semifinal|quartas|oitavas)\b/,
  /\bos pontos (?:do mata[\s-]?mata|aumentaram)\b/,
  // "por que fiz mais de 10 pontos?" / "como fiz 13 pontos?" — explica que no
  // mata-mata o placar sobe por fase + tem bônus (passar de 10 num jogo é normal).
  /\b(?:por ?que|porque|pq|como) (?:eu )?(?:fiz|ganhei|tirei|consegui|peguei|fui) (?:mais de 10|acima de 10|1[1-9]|2[0-9]) pontos?\b/,
  /\bfiz (?:1[1-9]|2[0-9]) pontos?\b/,
  /\b(?:mais de|acima de) 10 pontos?\b/,
  /\bagora vale[m]? mais pontos?\b/,
  // "como é a pontuação do mata-mata?" (quando REGRAS não pega)
  /\bpontua[cç][ãa]o\b[^?]*\bmata[\s-]?mata\b/,
];
const INFO_BONUS_CLASSIFICADO_PATTERNS: RegExp[] = [
  /\bo que (?:e|eh|é) o b[ôo]nus\b/,
  /\bcomo (?:eu )?ganho o b[ôo]nus\b/,
  /\bponto de quem passa\b/,
  /\bb[ôo]nus (?:de |do )?(?:classificad|quem passa)/,
  /\btem b[ôo]nus\b/,
  /\bb[ôo]nus por acertar\b/,
  /\bponto extra\b/,
];
const INFO_CRAVA_EMPATE_PATTERNS: RegExp[] = [
  /\berrar quem passa\b/,
  /\b(perco|perde|perdi) a crava\b/,
  /\berr(?:ei|ar|o) o classificad/,
  // "errei/errar quem passa/passou + (perco) placar/crava/pontos" — cobre
  // conjugações e plural ("perco meus pontos", "cravar", "passou").
  /\berr(?:ei|ar|o|ou) quem (?:passa|passou|passar|classifica|classificou)\b.*\b(placar|crava|ponto)/,
  /\bcravar? (?:o )?empate\b.*\b(perco|perde|perd|bonus|b[ôo]nus|ponto)/,
];
const INFO_RANKING_CONTINUA_PATTERNS: RegExp[] = [
  /\b(?:o )?ranking (?:vai |j[áa] )?zer(?:a|ou|ar|o)/,
  /\bcome[çc]a do zero\b/,
  /\b(?:meus )?pontos (?:dos |da )?grupos? (?:contam|valem|continuam)/,
  // "meus pontos da fase de grupos contam ainda?" — termos podem ter
  // palavras no meio ("da fase de grupos").
  /\bpontos\b.*\bgrupos?\b.*\b(conta[m]?|vale[m]?|continua[m]?)/,
  /\bzer(?:a|ou) (?:tudo|os pontos|o ranking)\b/,
  /\bperco (?:meus )?pontos (?:dos|da fase de) grupos\b/,
  /\branking continua\b/,
  /\bcontinua ou zera\b/,
];
const INFO_O_QUE_MUDA_PATTERNS: RegExp[] = [
  /\bo que (?:muda|mudou) (?:agora|no mata[\s-]?mata|na copa|pra frente)/,
  /\bo que (?:muda|mudou) (?:com o|no) (?:mata[\s-]?mata|eliminat)/,
  /\bmudou alguma coisa (?:no|com o) mata[\s-]?mata\b/,
  // "como funciona o mata-mata", "mata-mata" sozinho, "mata-mata é diferente?"
  // — abrem o resumo do que muda (placar+empate+pontos por fase).
  /\bcomo funciona o mata[\s-]?mata\b/,
  /^mata[\s-]?mata$/,
  /\bmata[\s-]?mata (?:e|eh|é) (?:mt |muito |bem )?diferente\b/,
];
const VER_CHAVE_PATTERNS: RegExp[] = [
  /\bver (?:a )?chave\b/,
  /\bcomo (?:t[áa]|esta|está) (?:o )?chaveamento\b/,
  /\bmostr(?:a|ar) (?:o )?(?:bracket|chaveamento|chave)\b/,
  /\bchave do mata[\s-]?mata\b/,
  /\bcomo (?:ficou|t[áa]|esta|está) (?:o |a )?(?:chave|bracket|chaveamento)\b/,
  // Status de classificação → mostra a chave, que diz honestamente quem
  // avançou (o handler lê o bracket; nunca inventa). Regex cobre só as formas
  // INEQUÍVOCAS; "o Brasil passou?" (ambíguo com "o prazo passou") fica pro
  // classificador LLM, que desambígua pelo contexto.
  /\b(?:se )?classificou\b.*\bmata[\s-]?mata\b/,
  /\bquem (?:j[áa] )?(?:se classificou|classificou|avan[çc]ou|foi eliminad[oa])\b/,
  /\bt[áa] (?:classificad[oa]|eliminad[oa]|nas oitavas|nas quartas|na semi|na final)\b/,
];
// ADVERSARIO_TIME e HORARIO_JOGO precisam resolver um TIME. Os patterns
// capturam o nome no grupo 1 (lido pelo handler via re-exec).
const ADVERSARIO_TIME_PATTERNS: RegExp[] = [
  /\bquem (?:o |a )?(.+?) (?:enfrenta|pega|joga contra|encara|vai pegar|vai enfrentar)\b/,
  /\badvers[áa]rio (?:d[oae] )?(.+)$/,
  /\bpr[óo]xim[oa] (?:advers[áa]rio|jogo) (?:d[oae] )?(.+)$/,
  /\b(.+?) (?:joga|enfrenta|pega) (?:contra |com )?quem\b/,
  /\bcontra quem (?:o |a )?(.+?) joga\b/,
  /\bcontra quem (?:joga|enfrenta|pega) (?:o |a )?(.+)$/,
  /\b(?:o |a )?(.+?) pega quem\b/,
  /\bquem (?:o |a )?(.+?) (?:vai )?(?:pegar|enfrentar|joga|pega) (?:depois|agora|de novo|n[oa]s? (?:pr[óo]xim[oa]|oitavas|quartas|semi|final|16[\s-]?avos))/,
];
const HORARIO_JOGO_PATTERNS: RegExp[] = [
  /\bque horas? (?:joga|e o jogo d[oae]|joga[m]?) (?:o |a )?(.+)$/,
  /\bquando (?:e|eh|é) o jogo d[oae] (.+)$/,
  /\bhor[áa]rio do jogo (?:d[oae] )?(.+)$/,
  /\bque horas? (?:o |a )?(.+?) joga\b/,
  /\bque dia (?:joga|e o jogo d[oae]|joga[m]?) (?:o |a )?(.+)$/,
  /\bquando (?:o |a )?(.+?) joga (?:de novo|denovo|na pr[óo]xima|nas oitavas|nas quartas|na semi|na final)\b/,
  /\b(?:o |a )?(.+?) joga quando\b/,
];

// v3.8.0 — PROGRESSO_PALPITES: visibilidade pra qualquer participante do
// estado dos palpites na rodada atual ("quem palpitou", "quem falta",
// "progresso", "mais gente registrou"). Antes esses casos caíam no
// smart-fallback, que recusava (knowledge da v3.6.0 corretamente disse
// "não sei" porque o produto não tinha essa feature). Agora tem.
const PROGRESSO_PALPITES_PATTERNS: RegExp[] = [
  /\bquem (?:ja )?palpitou\b/,
  /\bquem (?:ainda )?(?:nao|n[ãa]o) (?:palpitou|palpit[ae]i|registrou)\b/,
  /\bquem (?:registrou|fez|deu) (?:o )?palpite/,
  /\bquem (?:ja )?(?:fechou|terminou) (?:os )?palpites?/,
  /\bquem (?:ta|est[áa]) atrasad[oa]/,
  /\bquem (?:ta|est[áa]) (?:em dia|fechado)/,
  /\b(?:mais )?gente (?:ja )?(?:registrou|palpitou|fez) palpites?/,
  /\bquantos? palpit(?:aram|ou)\b/,
  /\bprogresso (?:do |dos )?(?:bol[ãa]o|palpites|participantes)/,
  /\bstatus (?:do |dos )?(?:bol[ãa]o|palpites|participantes)/,
  /\bpalpites? (?:do |dos )?participantes\b/,
  /\bpalpites? (?:do |de cada um|por participante)\b/,
  /\bquanto cada (?:um|pessoa) (?:ja )?palpitou\b/,
  /\bver se (?:as |os )?(?:pessoas|participantes|amig[oa]s|gente).{0,40}(?:registr|palpit)/,
  /\bver quem (?:ja )?(?:ta participando|engajou|entrou no bolao)/,
];

// v3.8.0 — CUTUCAR_PENDENTES: admin manda DM pra todo mundo que ainda
// não palpitou no bolão dele. Reaproveita a lógica de send-reminders mas
// sob demanda (sem esperar cron). Identifica o admin no texto da DM.
const CUTUCAR_PENDENTES_PATTERNS: RegExp[] = [
  /\bcutucar pendentes?\b/,
  /\bcutucar (?:quem|os) (?:nao|n[ãa]o) palpitou\b/,
  /\bcutucar (?:os )?atrasad[oa]s\b/,
  /\blembrar pendentes?\b/,
  /\blembrar (?:quem|os) (?:nao|n[ãa]o) palpitou\b/,
  /\bcobrar (?:os )?palpites?\b/,
  /\bchamar pendentes?\b/,
  /\bpingar pendentes?\b/,
  /\bavisar (?:quem|os) (?:nao|n[ãa]o) palpitou\b/,
];

// ISSUE-011: EDITAR_PALPITE — "corrigir", "mudar", "alterar" palpite
// v3.7.0: aceita placar inline: "corrigir Brasil 3x1 Marrocos", "mudar pra
// Brasil 2x1 Marrocos", "atualizar Brasil 3 a 1". Quando vem placar junto,
// o handler `handleEditarPalpite` extrai e aplica direto (atalho de 1 passo).
const EDITAR_PALPITE_PATTERNS: RegExp[] = [
  // v3.40.0 — "refazer"/"refaz" SOZINHO (caso real). Dentro dos estados
  // CONFIRMANDO_* o FSM já intercepta "refazer"; este pattern cobre o IDLE,
  // onde antes caía em "não entendi". O handler de editar (sem placar) já
  // pergunta qual bolão/jogo, igual a "corrigir palpite".
  /^(?:refazer|refaz)\b\s*[.!]?\s*$/,
  // Forma clássica: "corrigir palpite", "mudar palpite", etc
  /^(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer) (?:meu )?palpite/,
  /\b(?:quero|preciso|vou) (?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer) (?:meu |o |um )?palpite/,
  /\bcorrigir (?:o )?placar\b/,
  /^errei (?:o |meu )?palpite/,
  /\bpalpite errado\b/,
  // v3.7.0: verbo de edição + placar embutido. Aceita "x", "×", " a ", " por ", "-".
  // Exige número-separador-número pra evitar falsos positivos ("mudar de bolão").
  /^(?:corrigir|mudar|alterar|atualizar|refazer)\s+(?:pra\s+|para\s+|p\/\s+|o\s+|meu\s+)?\S.*\d+\s*(?:[x×]|a|por|-)\s*\d+/i,
];

// ISSUE-012: APAGAR_PALPITE — "apagar", "remover", "desfazer" palpite
const APAGAR_PALPITE_PATTERNS: RegExp[] = [
  /^(?:apagar|deletar|remover|desfazer|cancelar|excluir) (?:meu |o |um |esse )?palpite/,
  /\b(?:quero|preciso|vou) (?:apagar|deletar|remover|desfazer|cancelar|excluir) (?:meu |o |um )?palpite/,
  /^desfaz (?:meu |o )?palpite/,
];

// ISSUE-016: DEFINIR_BOLAO_PADRAO
const DEFINIR_BOLAO_PADRAO_PATTERNS: RegExp[] = [
  /\bdefinir (?:meu |o )?bol(?:a|o)o (?:padr[aã]o|principal|default)\b/,
  /\b(?:meu |o )?bol(?:a|o)o (?:padr[aã]o|principal|default)\b/,
  /\b(?:setar|colocar|escolher) (?:meu )?bol(?:a|o)o (?:padr[aã]o|principal)\b/,
  /\bbol(?:a|o)o (?:padr[aã]o|principal|default)\b/,
];

// ISSUE-020: RENOMEAR_BOLAO (admin)
const RENOMEAR_BOLAO_PATTERNS: RegExp[] = [
  /\brenomear (?:o |meu |esse )?bol(?:a|o)o\b/,
  /\bmudar (?:o )?nome (?:do |de |desse )?bol(?:a|o)o\b/,
  /\btrocar (?:o )?nome (?:do |de )?bol(?:a|o)o\b/,
  /\balterar (?:o )?nome (?:do |de )?bol(?:a|o)o\b/,
];

// ISSUE-021: REMOVER_PARTICIPANTE (admin)
const REMOVER_PARTICIPANTE_PATTERNS: RegExp[] = [
  /^remover (?:o |a |um |uma )?(?:fulano|participante|membro|pessoa)\b/,
  /^tirar (?:o |a |um |uma )?(?:fulano|participante|membro|pessoa)\b/,
  /^expulsar (?:o |a |um |uma )?(?:fulano|participante|membro|pessoa)\b/,
  /\bremover (?:do |o |a) bol(?:a|o)o (?:o |a )?\w+\b/,
  /\btirar (\w+) do bol(?:a|o)o\b/,
  /\b(?:quero |preciso )?remover participante\b/,
  /\bexpulsar (?:do )?bol(?:a|o)o\b/,
];

// ISSUE-023: RESUMO_BOLOES — "como to indo nos boloes", "meu desempenho geral"
const RESUMO_BOLOES_PATTERNS: RegExp[] = [
  /\bcomo (?:to|estou|ando) (?:indo )?(?:em |nos |em todos os )?(?:meus )?bol(?:o|a)es\b/,
  /\bem quantos bol(?:o|a)es (?:eu )?(?:to|estou) (?:em )?(?:primeiro|liderando|ganhando)\b/,
  /\bresumo (?:dos |de |em )?(?:meus )?bol(?:o|a)es\b/,
  /\bmeu desempenho (?:geral|em (?:todos|cada))\b/,
  /\b(?:qual|que) (?:eh |e )?(?:o )?meu desempenho\b/,
  /\bcomparar (?:meus )?bol(?:o|a)es\b/,
  /\bquanto (?:eu )?(?:to|estou|fa[cç]o) em cada bol(?:a|o)o\b/,
];

// "palpites" sozinho — ambiguo entre "meus palpites" e "fazer palpites".
// Tambem cobre "palpite" sem contexto adicional.
// Pre-filtro pra evitar capturar quando vem "meus palpites", "palpites do
// joao", etc — essas frases ja casam outros padroes mais especificos.
const PALPITES_AMBIGUO_PATTERNS: RegExp[] = [
  /^palpites?\??!?$/,
  /^palpite[!.]?$/,
];

// "Pendentes / tem solicitacao / tem pedido pra aprovar"
// (admin perguntando sobre solicitacoes pendentes — mais permissivo
// pra nao cair em APROVAR_NOMEADO com nome=\"tem pedido\")
const PENDENTES_PATTERNS: RegExp[] = [
  /\btem (?:algum |alguma )?(?:pedido|solicita[cç][aã]o|aprova[cç][aã]o|gente|pessoa) (?:pra|para) aprovar\b/,
  /\btem (?:algum |alguma )?(?:pedido|solicita[cç][aã]o)s? pendentes?\b/,
  /\b(?:quais )?aprovac[oõ]es pendentes\b/,
  /\b(?:quais )?pedidos? pendentes?\b/,
  /\bquem (?:esta|ta) (?:esperando|aguardando) (?:aprova[cç][aã]o|pra entrar)\b/,
  /\balguem (?:querendo|pedindo)(?: (?:pra|para))? entrar\b/,
];

const INTENT_RULES: IntentRules[] = [
  // Cordialidade no topo — super especificos, evitam que mensagens sociais
  // curtas (obrigada/tchau/tudo bem?/ok/kkk) caiam no fallback LLM e
  // sejam classificadas como SAUDACAO (reabrindo menu).
  // Bug Jeni 17/05 + expansao Sprint 3.
  { intencao: Intencao.AGRADECIMENTO, padroes: AGRADECIMENTO_PATTERNS },
  { intencao: Intencao.DESPEDIDA, padroes: DESPEDIDA_PATTERNS },
  // CUMPRIMENTO_CASUAL antes de SAUDACAO porque "oi tudo bem?" precisa
  // virar CUMPRIMENTO (não SAUDACAO solta). Trabalha junto com stripSaudacao.
  { intencao: Intencao.CUMPRIMENTO_CASUAL, padroes: CUMPRIMENTO_CASUAL_PATTERNS },
  // CONCORDANCIA_CASUAL: pattern restrito (^...$) pra não pegar palavras
  // em frases longas. Em CONFIRMANDO_* states o FSM dispatcher pega antes.
  { intencao: Intencao.CONCORDANCIA_CASUAL, padroes: CONCORDANCIA_CASUAL_PATTERNS },
  { intencao: Intencao.RISADA, padroes: RISADA_PATTERNS },
  // v3.15.0 — PLACAR_JOGO ANTES de PERGUNTA_GERAL_FUTEBOL: perguntas de
  // placar/resultado RECENTE devem responder com dados do BANCO (que tem
  // placar atualizado a cada 5min via fetch-results), não com a LLM que
  // recusava ("checa na FIFA"). Handler delega de volta pra
  // PERGUNTA_GERAL_FUTEBOL quando a pergunta é fora de escopo (copa
  // antiga, clube etc).
  { intencao: Intencao.PLACAR_JOGO, padroes: PLACAR_JOGO_PATTERNS },
  // v3.17.0 — PALPITE_OUTROS antes de PERGUNTA_GERAL_FUTEBOL (que tem
  // "jogos de ontem") e antes de PROGRESSO_PALPITES/MEU_PALPITE.
  // "quem acertou X?" / "quem pontuou no jogo Y?" pede explicação de
  // privacidade (público vs privado), não info externa nem contagem
  // agregada.
  { intencao: Intencao.PALPITE_OUTROS, padroes: PALPITE_OUTROS_PATTERNS },
  // v3.15.0 — RECLAMACAO_BUG antes de MEUS_PONTOS ("meus pontos estão
  // errados" contém "meus pontos"). STATUS_RODADA antes de QUANDO_COMECA.
  { intencao: Intencao.RECLAMACAO_BUG, padroes: RECLAMACAO_BUG_PATTERNS },
  { intencao: Intencao.STATUS_RODADA, padroes: STATUS_RODADA_PATTERNS },
  // v3.39.0 — JOGOS_POR_FAIXA ANTES de ESTATISTICA_PONTOS: "quais jogos eu
  // cravei?" (listar) tem que ganhar dos patterns standalone de contagem
  // ("acertei o placar"/"cravei o placar"). Os patterns de JOGOS exigem
  // gatilho de listagem (quais/me mostra/ver), então "quantas cravadas"
  // (contagem) continua caindo em ESTATISTICA_PONTOS.
  { intencao: Intencao.JOGOS_POR_FAIXA, padroes: JOGOS_POR_FAIXA_PATTERNS },
  // v3.38.0 — ESTATISTICA_PONTOS ANTES de PONTOS_DETALHE e MEUS_PONTOS:
  // "quantas cravadas fiz?" / "estatística dos meus pontos" pedem a quebra
  // por faixa, não a lista 48h (PONTOS_DETALHE) nem o total (MEUS_PONTOS).
  // Os patterns exigem faixa/estatística, então "quantos pontos fiz ontem"
  // (→ PONTOS_DETALHE) e "meus pontos" (→ MEUS_PONTOS) seguem intactos.
  { intencao: Intencao.ESTATISTICA_PONTOS, padroes: ESTATISTICA_PONTOS_PATTERNS },
  { intencao: Intencao.PONTOS_DETALHE, padroes: PONTOS_DETALHE_PATTERNS },
  { intencao: Intencao.DESABAFO_RANKING, padroes: DESABAFO_RANKING_PATTERNS },
  // Mata-mata (Copa 2026) — dúvidas frequentes ANTES de REGRAS e de
  // PERGUNTA_GERAL_FUTEBOL (respostas fixas, custo zero). Mais específicas
  // primeiro: CRAVA_EMPATE (errar classificado) antes de EMPATE_MATAMATA.
  { intencao: Intencao.INFO_PRORROGACAO, padroes: INFO_PRORROGACAO_PATTERNS },
  { intencao: Intencao.INFO_PENALTI, padroes: INFO_PENALTI_PATTERNS },
  { intencao: Intencao.INFO_CRAVA_EMPATE, padroes: INFO_CRAVA_EMPATE_PATTERNS },
  { intencao: Intencao.INFO_BONUS_CLASSIFICADO, padroes: INFO_BONUS_CLASSIFICADO_PATTERNS },
  { intencao: Intencao.INFO_PONTOS_MATAMATA, padroes: INFO_PONTOS_MATAMATA_PATTERNS },
  { intencao: Intencao.INFO_RANKING_CONTINUA, padroes: INFO_RANKING_CONTINUA_PATTERNS },
  { intencao: Intencao.INFO_O_QUE_MUDA, padroes: INFO_O_QUE_MUDA_PATTERNS },
  { intencao: Intencao.INFO_EMPATE_MATAMATA, padroes: INFO_EMPATE_MATAMATA_PATTERNS },
  { intencao: Intencao.VER_CHAVE, padroes: VER_CHAVE_PATTERNS },
  // ADVERSARIO_TIME / HORARIO_JOGO leem o bracket; vêm antes de
  // PERGUNTA_GERAL_FUTEBOL pra "quem o Brasil enfrenta" ir pro handler da chave.
  { intencao: Intencao.ADVERSARIO_TIME, padroes: ADVERSARIO_TIME_PATTERNS },
  { intencao: Intencao.HORARIO_JOGO, padroes: HORARIO_JOGO_PATTERNS },
  // Sprint 4 — PERGUNTA_GERAL_FUTEBOL antes de PROXIMOS_JOGOS/JOGOS_HOJE/
  // RANKING porque perguntas sobre time/canal/jogo especifico tem
  // palavras-chave em comum mas devem cair em LLM conversacional, nao
  // em handler de comando. Bug VPS 18/05 ("Quais proximos jogos da
  // Inglaterra?" virava handleProximosJogos do bolao do user).
  { intencao: Intencao.PERGUNTA_GERAL_FUTEBOL, padroes: PERGUNTA_GERAL_FUTEBOL_PATTERNS },
  // Ordem: mais especificos antes. REGRAS antes de AJUDA pq "como funciona
  // pontuacao" vs "como funciona" sao bem proximos.
  { intencao: Intencao.REGRAS, padroes: REGRAS_PATTERNS },
  // INFO_SENHA antes de ENTRAR_BOLAO porque "qual a senha do bolao" tem
  // "bolao" e poderia bater ENTRAR_BOLAO. INFO_SENHA tambem antes de
  // EXCLUIR_BOLAO porque ambos contem "bolao". (ISSUE-005)
  { intencao: Intencao.INFO_SENHA, padroes: INFO_SENHA_PATTERNS },
  // EXCLUIR_BOLAO antes de SAIR_BOLAO/CRIAR_BOLAO (todos tem "bolao"). (ISSUE-006)
  { intencao: Intencao.EXCLUIR_BOLAO, padroes: EXCLUIR_BOLAO_PATTERNS },
  // Sprint 2: RENOMEAR_BOLAO antes de CRIAR_BOLAO ("mudar nome do bolao") — ISSUE-020
  { intencao: Intencao.RENOMEAR_BOLAO, padroes: RENOMEAR_BOLAO_PATTERNS },
  // Sprint 2: DEFINIR_BOLAO_PADRAO antes de CRIAR/ENTRAR ("meu bolao padrao") — ISSUE-016
  { intencao: Intencao.DEFINIR_BOLAO_PADRAO, padroes: DEFINIR_BOLAO_PADRAO_PATTERNS },
  // Sprint 2: REMOVER_PARTICIPANTE antes de RECUSAR/CANCELAR — ISSUE-021
  { intencao: Intencao.REMOVER_PARTICIPANTE, padroes: REMOVER_PARTICIPANTE_PATTERNS },
  // Sprint 2: APAGAR_PALPITE antes de EDITAR_PALPITE (mais especifico) — ISSUE-012
  { intencao: Intencao.APAGAR_PALPITE, padroes: APAGAR_PALPITE_PATTERNS },
  // Sprint 2: EDITAR_PALPITE antes de MEU_PALPITE/PALPITE_INLINE — ISSUE-011
  { intencao: Intencao.EDITAR_PALPITE, padroes: EDITAR_PALPITE_PATTERNS },
  // v3.9.0: DICAS_PALPITE e ACOLHIMENTO_NOVATO ANTES de COMO_PALPITAR e
  // INFO_PRODUTO — são mais específicos. Bug Valéria 22/05: "tem dicas
  // de como montar palpites" virava INFO_PRODUTO; "nao entendo de
  // futebol" virava fallback. Agora têm intent dedicada acolhedora.
  { intencao: Intencao.DICAS_PALPITE, padroes: DICAS_PALPITE_PATTERNS },
  { intencao: Intencao.ACOLHIMENTO_NOVATO, padroes: ACOLHIMENTO_NOVATO_PATTERNS },
  // Sprint 2: COMO_PALPITAR antes de MEU_PALPITE/PROXIMOS_JOGOS — ISSUE-017
  { intencao: Intencao.COMO_PALPITAR, padroes: COMO_PALPITAR_PATTERNS },
  // Sprint 2: INFO_PRODUTO antes de AJUDA (fallback) — ISSUE-009
  { intencao: Intencao.INFO_PRODUTO, padroes: INFO_PRODUTO_PATTERNS },
  // Sprint 2: INFO_PRECO — ISSUE-010
  { intencao: Intencao.INFO_PRECO, padroes: INFO_PRECO_PATTERNS },
  // Sprint 2: QUANDO_COMECA antes de ABRIR_RODADA — ISSUE-018
  { intencao: Intencao.QUANDO_COMECA, padroes: QUANDO_COMECA_PATTERNS },
  // Sprint 2: RESUMO_BOLOES antes de MEUS_BOLOES/MEUS_PONTOS — ISSUE-023
  { intencao: Intencao.RESUMO_BOLOES, padroes: RESUMO_BOLOES_PATTERNS },
  { intencao: Intencao.PENDENTES, padroes: PENDENTES_PATTERNS },
  { intencao: Intencao.COMO_CONVIDAR, padroes: COMO_CONVIDAR_PATTERNS },
  { intencao: Intencao.ABRIR_RODADA, padroes: ABRIR_RODADA_PATTERNS },
  { intencao: Intencao.SAIR_BOLAO, padroes: SAIR_BOLAO_PATTERNS },
  { intencao: Intencao.QUEM_PARTICIPA, padroes: QUEM_PARTICIPA_PATTERNS },
  // v3.8.0: CUTUCAR_PENDENTES e PROGRESSO_PALPITES antes de MEU_PALPITE
  // — "quem palpitou" não pode virar MEU_PALPITE (que é "MEUS palpites")
  { intencao: Intencao.CUTUCAR_PENDENTES, padroes: CUTUCAR_PENDENTES_PATTERNS },
  { intencao: Intencao.PROGRESSO_PALPITES, padroes: PROGRESSO_PALPITES_PATTERNS },
  // MEU_PALPITE (mais especifico) antes do PALPITES_AMBIGUO
  { intencao: Intencao.MEU_PALPITE, padroes: MEU_PALPITE_PATTERNS },
  // PALPITES_AMBIGUO so casa "palpites" sozinho — quando nada acima bateu
  { intencao: Intencao.PALPITES_AMBIGUO, padroes: PALPITES_AMBIGUO_PATTERNS },
  // MAIS_JOGOS antes de PROXIMOS_JOGOS — "mais jogos" é mais específico
  // (paginação). "próximos jogos" cai em PROXIMOS_JOGOS e reseta offset.
  { intencao: Intencao.MAIS_JOGOS, padroes: MAIS_JOGOS_PATTERNS },
  { intencao: Intencao.PROXIMOS_JOGOS, padroes: PROXIMOS_JOGOS_PATTERNS },
  { intencao: Intencao.MEUS_PONTOS, padroes: MEUS_PONTOS_PATTERNS },
  { intencao: Intencao.MEUS_BOLOES, padroes: MEUS_BOLOES_PATTERNS },
  { intencao: Intencao.JOGOS_HOJE, padroes: JOGOS_HOJE_PATTERNS },
  { intencao: Intencao.CRIAR_BOLAO, padroes: CRIAR_BOLAO_PATTERNS },
  { intencao: Intencao.ENTRAR_BOLAO, padroes: ENTRAR_BOLAO_PATTERNS },
  { intencao: Intencao.RANKING, padroes: RANKING_PATTERNS },
];

function normalize(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * v3.35.0 — Intents de LEITURA/navegação que perdem pra um lote de palpites.
 * Se o usuário manda "Meus palpites:\n<lista>" (rotulando a submissão), a
 * presença de 2+ palpites parseáveis faz a mensagem virar PALPITE_INLINE.
 * NÃO inclui EDITAR/APAGAR/PLACAR/ações — só intents puramente de visualizar.
 */
const INTENTS_LEITURA_SOBRESCRITAS_POR_LOTE = new Set<Intencao>([
  Intencao.MEU_PALPITE,
  Intencao.MEUS_PONTOS,
  Intencao.PALPITES_AMBIGUO,
  Intencao.RANKING,
  Intencao.MEUS_BOLOES,
  Intencao.PROXIMOS_JOGOS,
  Intencao.JOGOS_HOJE,
  Intencao.MAIS_JOGOS,
  Intencao.MENU,
  Intencao.AJUDA,
  Intencao.SAUDACAO,
  Intencao.STATUS_RODADA,
  Intencao.QUANDO_COMECA,
  Intencao.RESUMO_BOLOES,
  Intencao.CUMPRIMENTO_CASUAL,
  Intencao.PROGRESSO_PALPITES,
]);

function matchIntent(norm: string): Intencao | null {
  for (const { intencao, padroes } of INTENT_RULES) {
    if (padroes.some((p) => p.test(norm))) {
      // v3.18.0 — AGRADECIMENTO em msg longa (>30 chars) é quase sempre
      // auto-reply ("Agradeço seu contato, respondo em breve"). Mesmo
      // com pattern endurecido pra exigir final-de-msg, esta verificação
      // serve de cinto-e-suspensório. Mensagens curtas ("obrigado",
      // "valeu", "vlw") continuam casando normal.
      if (intencao === Intencao.AGRADECIMENTO && norm.length > 30) {
        continue;
      }
      return intencao;
    }
  }
  return null;
}

/**
 * Remove saudações no início da mensagem ("oi bot, quais os próximos jogos?")
 * pra desbloquear o matching das intents reais. Idempotente, não destrutivo:
 * se após o strip sobrar string vazia, devolve o original.
 */
function stripSaudacao(textoNormalizado: string): string {
  const SAUDACAO_PREFIX_REGEX =
    /^(?:oi+e?\b|ola\b|hey\b|opa+\b|salve\b|fala\b|eaee?\b|bom dia\b|boa tarde\b|boa noite\b|iae?\b|opa bol(?:a|o)o\b|opa bot\b)\b[\s,!.;:]*/;
  let resultado = textoNormalizado;
  // pode ter encadeado: "oi, opa, fala" — aplica ate 3x
  for (let i = 0; i < 3; i++) {
    const novo = resultado.replace(SAUDACAO_PREFIX_REGEX, '').trim();
    if (novo === resultado) break;
    resultado = novo;
  }
  return resultado.length > 0 ? resultado : textoNormalizado;
}

export function parseIntencao(text: string): ParsedMessage {
  const raw = text.trim();
  const lower = raw.toLowerCase();
  const norm = normalize(raw);

  // Saudacao "sozinha" — matching exato
  if (SAUDACOES.has(norm)) {
    return { intencao: Intencao.SAUDACAO, raw, args: [] };
  }

  // Saudacao SEGUIDA de outra intent ("oi, ranking", "opa bolao quais
  // proximos jogos"): faz strip da saudacao e tenta matchIntent no resto.
  const semSaudacao = stripSaudacao(norm);
  if (semSaudacao !== norm && semSaudacao.length >= 3) {
    const intentEmbutida = matchIntent(semSaudacao);
    if (intentEmbutida) {
      return { intencao: intentEmbutida, raw, args: [] };
    }
    // Se o resto nao casou intent conhecida, considera SAUDACAO pura
    // pra manter UX amigavel (o classifier LLM ainda pode pegar depois
    // se a frase for natural complexa).
    if (norm.length <= semSaudacao.length + 10) {
      // saudacao curta + texto curto sem match → SAUDACAO + texto pro user
      return { intencao: Intencao.SAUDACAO, raw, args: [] };
    }
  }
  if (MENU_WORDS.has(norm)) {
    return { intencao: Intencao.MENU, raw, args: [] };
  }
  // "como funciona" generico vira AJUDA — mas "como funciona a pontuacao"
  // eh REGRAS, entao excluimos esse caso aqui pra que o INTENT_RULES capture.
  const ehComoFuncionaGenerico =
    norm.startsWith('como funciona') &&
    !/^como (?:eh|funciona) (?:a )?pontuacao\b/.test(norm) &&
    !/mata[\s-]?mata/.test(norm); // "como funciona o mata-mata" → INFO_O_QUE_MUDA
  if (AJUDA_WORDS.has(norm) || norm === '!ajuda' || ehComoFuncionaGenerico || norm.startsWith('o que (?:vc|voce) faz')) {
    return { intencao: Intencao.AJUDA, raw, args: [] };
  }
  if (CANCELAR_WORDS.has(norm)) {
    return { intencao: Intencao.CANCELAR, raw, args: [] };
  }

  // Comandos explicitos de admin
  if (norm.startsWith('!aprovar ')) {
    return {
      intencao: Intencao.APROVAR,
      raw,
      args: [raw.slice('!aprovar'.length).trim()],
    };
  }
  if (norm.startsWith('!recusar ')) {
    return {
      intencao: Intencao.RECUSAR,
      raw,
      args: [raw.slice('!recusar'.length).trim()],
    };
  }
  if (norm === '!pendentes' || norm === 'pendentes') {
    return { intencao: Intencao.PENDENTES, raw, args: [] };
  }

  // Padroes de linguagem natural (intent rules) — cobre maioria das
  // variantes coloquiais. Roda antes do palpite-inline pra que "quero
  // palpitar" nao caia em PALPITE_INLINE.
  const intentPorPadrao = matchIntent(norm);
  // v3.35.0 — se o usuário ROTULOU uma submissão de palpites com uma frase
  // de "ver/navegar" (ex: "Meus palpites:\n<10 jogos com placar>"), a intent
  // de LEITURA não pode sequestrar. Quando há um LOTE (2+ palpites
  // parseáveis), é submissão → PALPITE_INLINE (caso +5531 12/06: a lista de
  // 10 palpites virava MEU_PALPITE e era ignorada). Só sobrescreve intents
  // de leitura/navegação — EDITAR/APAGAR/PLACAR/ações ficam intactas.
  if (intentPorPadrao && INTENTS_LEITURA_SOBRESCRITAS_POR_LOTE.has(intentPorPadrao)) {
    const lote = parseMultiplePalpites(raw);
    if (lote.length >= 2) {
      return { intencao: Intencao.PALPITE_INLINE, raw, args: [], palpite: lote[0] };
    }
  }
  // Mata-mata: um palpite REAL não pode ser sequestrado por uma intent de
  // DÚVIDA. "Brasil 1x1 Japão e o Brasil se classifica nos penaltis" casava
  // INFO_PENALTI ("...e o ... penaltis") e PERDIA o palpite. Se a mensagem
  // parseia como palpite com nomes que parecem times, o palpite vence.
  if (intentPorPadrao && INTENTS_INFO_MATAMATA_PERDEM_PRA_PALPITE.has(intentPorPadrao)) {
    const pk = tentarParsearPalpiteInline(raw);
    if (pk && pareceTimeLimpo(pk.timeCasa) && pareceTimeLimpo(pk.timeVisitante)) {
      return { intencao: Intencao.PALPITE_INLINE, raw, args: [], palpite: pk };
    }
  }
  if (intentPorPadrao) {
    // Pra ranking, extrai possivel argumento ("ranking firma fc")
    if (intentPorPadrao === Intencao.RANKING) {
      const rest = raw.replace(/^ranking\s*/i, '').trim();
      return {
        intencao: Intencao.RANKING,
        raw,
        args: rest ? [rest] : [],
      };
    }
    // Pra MEUS_PONTOS, extrai possivel argumento ("meus pontos firma fc")
    if (intentPorPadrao === Intencao.MEUS_PONTOS && /^meus? pontos?/.test(norm)) {
      const rest = raw.replace(/^meus? pontos?\s*/i, '').trim();
      return {
        intencao: Intencao.MEUS_PONTOS,
        raw,
        args: rest ? [rest] : [],
      };
    }
    // Pra MEU_PALPITE, extrai possivel argumento ("meus palpites firma fc")
    if (intentPorPadrao === Intencao.MEU_PALPITE && /^meus? palpites?/.test(norm)) {
      const rest = raw.replace(/^meu palpite|^meus palpites/i, '').trim();
      return {
        intencao: Intencao.MEU_PALPITE,
        raw,
        args: rest ? [rest] : [],
      };
    }
    return { intencao: intentPorPadrao, raw, args: [] };
  }

  // Palpite inline — "Flamengo 2x1 Palmeiras", "Brasil 2 a 1 Marrocos",
  // "Brasil dois a um Marrocos", etc.
  // (depois das intent rules, pra "quero palpitar" nao virar palpite_inline)
  //
  // Tenta 1) string toda; 2) se houver multiplas linhas, primeira linha
  // que casa palpite (pra cobrir multi-palpite em IDLE — handler depois
  // re-parseia com parseMultiplePalpites).
  let palpite = tentarParsearPalpiteInline(raw);
  // v3.34.0 — multi-palpite separado por \n, VÍRGULA ou ; (antes só \n →
  // "A 1x1 B, C 0x2 D, E 1x0 F" virava TEXTO_LIVRE e o palpite se perdia,
  // caso Felipe 11/06). Se qualquer segmento casar, é PALPITE_INLINE e o
  // handler re-parseia o lote inteiro com parseMultiplePalpites.
  if (!palpite && /[\n,;]/.test(raw)) {
    for (const linha of raw.split(/[\n,;]+/).map((l) => l.trim()).filter(Boolean)) {
      const p = tentarParsearPalpiteInline(linha);
      if (p) {
        palpite = p;
        break;
      }
    }
  }
  if (palpite) {
    return {
      intencao: Intencao.PALPITE_INLINE,
      raw,
      args: [],
      palpite,
    };
  }

  // unused helper kept available in API surface
  void lower;

  return { intencao: Intencao.TEXTO_LIVRE, raw, args: [] };
}

/**
 * Tenta extrair palpite inline de uma linha. Estrategia:
 *   1. Aplica regex no texto bruto (formato digitos).
 *   2. Se falhar, pre-processa numeros por extenso ("dois a um" → "2 a 1")
 *      e tenta de novo.
 *
 * Retorna `null` se nada bateu.
 */
/**
 * v3.35.0 — Tira prefixo de data/hora/bullet de uma linha de palpite
 * (formato que o bot exibe e o usuário copia de volta). Conservador:
 * data exige "/" e hora exige ":"/"h", então NÃO confunde com o placar
 * "1x1" do formato invertido.
 */
function stripPrefixoDataHora(linha: string): string {
  return linha
    .replace(
      /^[\s•\-–—✅⚪🔴📅*_]*(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)?[\s,]*(?:\d{1,2}[:h]\d{2})?\s*[–—\-•|]*\s*/,
      '',
    )
    .trim();
}

function tentarParsearPalpiteInline(linhaRaw: string): PalpiteInline | null {
  // v3.35.0 — remove prefixo de DATA/HORA/bullet que o usuário copia do
  // formato do PRÓPRIO bot ("11/06, 23:00 — Coreia do Sul 0x2 Tcheca",
  // "✅ 13/06 19:00 — Brasil 2x1 Marrocos"). Sem isso o "23:00 —" grudava
  // no nome do time e o match ficava sujo (caso +5531 12/06). NÃO mexe em
  // "1x1 México x África" (inverte): data exige "/", hora exige ":".
  const linhaSemData = stripPrefixoDataHora(linhaRaw);
  // Mata-mata: corta um eventual rabicho de classificado ("...e o Brasil
  // passa") ANTES de parsear o placar — senão o nome do visitante fica
  // poluído. O lado é resolvido após o parse (só em empate).
  const { semClassificado: linha, tail: classTail } = separarClassificadoInline(linhaSemData);
  const finalize = (p: PalpiteInline): PalpiteInline => {
    if (classTail && p.golsCasa === p.golsVisitante) {
      const lado = resolverLadoClassificado(classTail, p.timeCasa, p.timeVisitante);
      if (lado) p.classificado = lado;
    }
    return p;
  };
  // v3.10.0: validador anti-match-ruim. Se um time parseado contém placar
  // embutido (ex: "1x1 México x África do Sul" sequestrado como timeCasa),
  // descarta — sinal de regex pegando lixo de palpites concatenados.
  const validar = (timeCasa: string, timeVisitante: string): boolean => {
    PLACAR_ANCHOR_REGEX.lastIndex = 0;
    if (PLACAR_ANCHOR_REGEX.test(timeCasa)) return false;
    PLACAR_ANCHOR_REGEX.lastIndex = 0;
    if (PLACAR_ANCHOR_REGEX.test(timeVisitante)) return false;
    // Times absurdamente longos (>40 chars sem placar) são raros e
    // geralmente sinal de match colando 2+ palpites
    if (timeCasa.length > 40 || timeVisitante.length > 40) return false;
    return true;
  };

  // 1) Canônico: "Time1 NxN Time2"
  const direto = linha.match(PALPITE_REGEX);
  if (direto) {
    const tc = direto[1].trim();
    const tv = direto[4].trim();
    if (validar(tc, tv)) {
      return finalize({
        timeCasa: tc,
        golsCasa: parseInt(direto[2], 10),
        golsVisitante: parseInt(direto[3], 10),
        timeVisitante: tv,
      });
    }
  }

  // 2) v3.10.0 — INVERTIDO: "NxN Time1 x Time2" (caso real Valéria 22/05)
  const invertido = linha.match(PALPITE_INVERTIDO_REGEX);
  if (invertido) {
    const tc = invertido[3].trim();
    const tv = invertido[4].trim();
    if (validar(tc, tv)) {
      return finalize({
        timeCasa: tc,
        golsCasa: parseInt(invertido[1], 10),
        golsVisitante: parseInt(invertido[2], 10),
        timeVisitante: tv,
      });
    }
  }

  // 3) Extenso ("dois a um") — tenta canônico + invertido com substituição
  const comDigitos = linha.replace(
    /\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/gi,
    (m) => NUMEROS_EXTENSO[m.toLowerCase()] ?? m,
  );
  if (comDigitos !== linha) {
    const seg = comDigitos.match(PALPITE_REGEX);
    if (seg) {
      const tc = seg[1].trim();
      const tv = seg[4].trim();
      if (validar(tc, tv)) {
        return finalize({
          timeCasa: tc,
          golsCasa: parseInt(seg[2], 10),
          golsVisitante: parseInt(seg[3], 10),
          timeVisitante: tv,
        });
      }
    }
    const segInv = comDigitos.match(PALPITE_INVERTIDO_REGEX);
    if (segInv) {
      const tc = segInv[3].trim();
      const tv = segInv[4].trim();
      if (validar(tc, tv)) {
        return finalize({
          timeCasa: tc,
          golsCasa: parseInt(segInv[1], 10),
          golsVisitante: parseInt(segInv[2], 10),
          timeVisitante: tv,
        });
      }
    }
  }

  // 4) v3.19.0 — GOLS SEPARADOS: "N Time1 X N Time2" (caso real Natane
  // 11/06). DEPOIS dos outros pra não roubar matches mais específicos.
  // Anti-lixo agressivo (regex é genérico — qualquer "N palavra X N
  // palavra" casa). Bloqueia palavras semânticas comuns que NUNCA são
  // nomes de time: "anos x derrotas", "jogos x vezes", etc.
  const separados = linha.match(PALPITE_GOLS_SEPARADOS_REGEX);
  if (separados) {
    const tc = separados[2].trim();
    const tv = separados[4].trim();
    if (
      !timeComecaComDigito(tc) &&
      !timeComecaComDigito(tv) &&
      !timeEhStopwordSemantica(tc) &&
      !timeEhStopwordSemantica(tv) &&
      validar(tc, tv)
    ) {
      return finalize({
        timeCasa: tc,
        golsCasa: parseInt(separados[1], 10),
        golsVisitante: parseInt(separados[3], 10),
        timeVisitante: tv,
      });
    }
  }

  // 5) v3.50.0 — GOLS DEPOIS DO TIME: "Time1 N x Time2 N" (caso real 29/06,
  // "Alemanha 2 x Paraguai 3"). O MAIS genérico — roda por último, com os
  // mesmos guards anti-lixo do gols-separados (time não começa com dígito,
  // não é stopword semântica, sem placar embutido).
  const posTime = linha.match(PALPITE_GOLS_POS_TIME_REGEX);
  if (posTime) {
    const tc = posTime[1].trim();
    const tv = posTime[3].trim();
    if (
      !timeComecaComDigito(tc) &&
      !timeComecaComDigito(tv) &&
      !timeEhStopwordSemantica(tc) &&
      !timeEhStopwordSemantica(tv) &&
      validar(tc, tv)
    ) {
      return finalize({
        timeCasa: tc,
        golsCasa: parseInt(posTime[2], 10),
        golsVisitante: parseInt(posTime[4], 10),
        timeVisitante: tv,
      });
    }
  }

  return null;
}

function timeComecaComDigito(nome: string): boolean {
  return /^\d/.test(nome);
}

/**
 * v3.19.0 — palavras semânticas que NUNCA são nomes de time. Usadas pra
 * filtrar falsos positivos no PALPITE_GOLS_SEPARADOS_REGEX (que casa
 * coisas tipo "12 anos x 2 vitorias", "3 jogos x 5 derrotas").
 *
 * Match em qualquer palavra do "time" parseado (acento-insensitive).
 * Se acertar, descarta o palpite — não é palpite real.
 */
const TIME_STOPWORDS_SEMANTICAS = new Set([
  // tempo
  'anos', 'ano', 'mes', 'meses', 'semana', 'semanas', 'dia', 'dias',
  'hora', 'horas', 'minuto', 'minutos', 'segundo', 'segundos',
  'vez', 'vezes',
  // futebol generico (sem ser time)
  'jogos', 'jogo', 'partida', 'partidas', 'rodada', 'rodadas',
  'vitoria', 'vitorias', 'derrota', 'derrotas', 'empate', 'empates',
  'ponto', 'pontos', 'gol', 'gols', 'goleada',
  // outros
  'pessoa', 'pessoas', 'gente',
]);

function timeEhStopwordSemantica(nome: string): boolean {
  const palavras = nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/);
  return palavras.some((p) => TIME_STOPWORDS_SEMANTICAS.has(p));
}

/**
 * v3.10.0 — Tokenizer: separa palpites concatenados sem quebra de linha.
 * Caso real Valéria 22/05 (11:20): mandou 10 palpites no formato invertido
 * separados só por espaços. PALPITE_REGEX casou o primeiro como
 * `(time1="1x1 México x África do Sul", 1, 0, time2="Coreia do Sul x ...
 *  Japão")` — sequestrando 9 outros palpites como "timeVisitante".
 *
 * Algoritmo: encontra TODOS os âncoras `NxN` na linha. Pra cada âncora,
 * o trecho ANTES (até a âncora anterior ou início) é time1, e o trecho
 * DEPOIS (até a próxima âncora ou fim) é... bom, é palpite-time2 +
 * possivelmente próximo palpite-time1.
 *
 * Heurística adotada: se há 2+ âncoras, assume formato INVERTIDO
 * (`N1xN1 T1a x T1b N2xN2 T2a x T2b ...`) — placar antes dos times.
 * Caso da Valéria. O formato canônico com 2+ palpites em uma linha só
 * (`T1a N1xN1 T1b T2a N2xN2 T2b`) é praticamente impossível porque
 * times terminam grudados no próximo time sem separador claro.
 */
export function tokenizarPalpitesEmUmaLinha(linha: string): PalpiteInline[] {
  const matches = [...linha.matchAll(PLACAR_ANCHOR_REGEX)];
  if (matches.length < 2) return [];

  const resultados: PalpiteInline[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const golsCasa = parseInt(m[1], 10);
    const golsVisitante = parseInt(m[2], 10);
    const inicioPlacar = m.index ?? 0;
    const fimPlacar = inicioPlacar + m[0].length;
    // Texto entre fim deste placar e início do próximo placar (ou fim
    // da linha) = "Time1 x Time2" deste palpite
    const fimTimes = i + 1 < matches.length ? (matches[i + 1].index ?? linha.length) : linha.length;
    const blocoTimes = linha.slice(fimPlacar, fimTimes).trim();
    // Separa "Time1 x Time2" pelo conector
    const conector = blocoTimes.match(/^(.+?)\s+(?:[xX]|vs|contra|-)\s+(.+)$/);
    if (!conector) continue;
    const timeCasa = conector[1].trim();
    const timeVisitante = conector[2].trim();
    if (!timeCasa || !timeVisitante) continue;
    // Anti-lixo: time não pode conter placar embutido
    PLACAR_ANCHOR_REGEX.lastIndex = 0;
    if (PLACAR_ANCHOR_REGEX.test(timeCasa)) continue;
    PLACAR_ANCHOR_REGEX.lastIndex = 0;
    if (PLACAR_ANCHOR_REGEX.test(timeVisitante)) continue;
    if (timeCasa.length > 40 || timeVisitante.length > 40) continue;
    resultados.push({ timeCasa, golsCasa, timeVisitante, golsVisitante });
  }
  return resultados;
}

/**
 * Parseia mensagens com varias linhas de palpite (ex: 5 palpites de uma rodada).
 * Ignora linhas invalidas. Versao DEPRECATED — preferir parseMultiplePalpitesDetalhado.
 */
export function parseMultiplePalpites(text: string): PalpiteInline[] {
  return parseMultiplePalpitesDetalhado(text).ok;
}

/**
 * Variante que devolve tambem as linhas que NAO casaram nenhum regex —
 * usada pelo fluxo de palpite inline em IDLE pra reportar ao usuario o
 * que o bot nao entendeu (ou passar pro LLM como fallback).
 *
 * Ignora linhas vazias e linhas curtas demais (<5 chars).
 */
export function parseMultiplePalpitesDetalhado(text: string): {
  ok: PalpiteInline[];
  descartadas: string[];
} {
  // v3.34.0 — separadores de palpites: quebra de linha, VÍRGULA e ponto-e-
  // vírgula. BUG GRAVE (caso Felipe 11/06 20:44): o bot anuncia "vários
  // palpites separados por vírgula", mas o parser só dividia por \n — então
  // "Coreia 1x1 Tcheca, Canadá 0x2 Bósnia, EUA 1x0 Paraguai" (1 linha, com
  // vírgulas) extraía 0 palpites e o usuário perdia tudo. Nomes de seleção
  // não têm vírgula, então split é seguro.
  const MAX_LINHAS = 80;
  const lines = text
    .split(/[\n,;]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINHAS);

  const ok: PalpiteInline[] = [];
  const descartadas: string[] = [];
  let ultimo: PalpiteInline | null = null; // último palpite OK (pra anexar classificado)
  for (const line of lines) {
    // v3.10.0 — primeiro tenta linha como UM palpite (canônico/invertido).
    const p = tentarParsearPalpiteInline(line);
    if (p) {
      ok.push(p);
      ultimo = p;
      continue;
    }
    // Mata-mata: o split por vírgula pode ter isolado um rabicho de
    // classificado ("Brasil 1x1 Japão, Brasil passa"). Se a linha tem sinal
    // de avanço e cita um dos times do último empate, anexa o lado a ele.
    if (
      ultimo &&
      ultimo.golsCasa === ultimo.golsVisitante &&
      !ultimo.classificado &&
      AVANCO_CLASSIFICADO_RE.test(line)
    ) {
      const lado = resolverLadoClassificado(line, ultimo.timeCasa, ultimo.timeVisitante);
      if (lado) {
        ultimo.classificado = lado;
        continue;
      }
    }
    // Se falhou E a linha tem 2+ âncoras NxN, é provável "palpites
    // concatenados sem newline" (caso Valéria 11:20). Tokeniza.
    PLACAR_ANCHOR_REGEX.lastIndex = 0;
    const totalAnchors = (line.match(PLACAR_ANCHOR_REGEX) ?? []).length;
    if (totalAnchors >= 2) {
      const tokens = tokenizarPalpitesEmUmaLinha(line);
      if (tokens.length > 0) {
        ok.push(...tokens);
        continue;
      }
    }
    if (line.length >= 5) {
      descartadas.push(line);
    }
  }
  if (descartadas.length > 0) {
    console.log(`[multi-palpite] ok=${ok.length} descartadas=${descartadas.length}`);
  }
  // Limita o array de descartadas guardado/retornado (o display já corta em 3).
  return { ok, descartadas: descartadas.slice(0, 10) };
}

// Suprime "imports usados apenas pelo regex"
void substituirNumerosExtenso;
