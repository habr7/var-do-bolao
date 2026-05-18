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

  AJUDA = 'AJUDA',
  CANCELAR = 'CANCELAR',

  // Sprint 3 — handlers de cordialidade
  AGRADECIMENTO = 'AGRADECIMENTO',          // "obrigada", "valeu", "vlw", "brigado", "thx"
  DESPEDIDA = 'DESPEDIDA',                  // "tchau", "flw", "abraço", "fui"
  CUMPRIMENTO_CASUAL = 'CUMPRIMENTO_CASUAL', // "tudo bem?", "blz?", "como vai"
  CONCORDANCIA_CASUAL = 'CONCORDANCIA_CASUAL', // "ok", "beleza" (em IDLE — em CONFIRMANDO_* vira SIM)
  RISADA = 'RISADA',                         // "kkkk", "rsrs", "hahaha"

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
}

// Aceita varios separadores entre os placares: x/X, " a ", " - ", " por ".
// "x"/"X"/"-" podem vir colados ou com espacos; "a"/"por" exigem espacos
// em volta pra nao casar com palavras (tipo "Acre"). Suporta:
//   "Brasil 2x1 Marrocos"
//   "Brasil 2 X 1 Marrocos"
//   "Brasil 2-1 Marrocos"
//   "Brasil 2 a 1 Marrocos"
//   "Brasil 2 por 1 Marrocos"
const PALPITE_REGEX = /^(.+?)\s+(\d+)\s*(?:[xX-]|\s+(?:a|por)\s+)\s*(\d+)\s+(.+)$/;

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
];

// "Proximos jogos / quais jogos faltam / o que ainda nao palpitei"
// Cobre tambem inversao "jogos proximos", variantes com "qual/quais",
// e AÇÃO de palpitar ("quero dar palpites", "vou fazer um palpite", etc).
const PROXIMOS_JOGOS_PATTERNS: RegExp[] = [
  /\bproximos? jogos?\b/,
  /\bjogos? proximos?\b/, // ordem invertida — Bug 4
  /\bquais (?:os )?proximos? jogos?\b/,
  /\bquais (?:os )?jogos? proximos?\b/,
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
  /\blista (?:de )?jogos?\b/,
  /\bme mostra os jogos?\b/,
  /\bmostra(?:r)? os jogos?\b/,
  /\bver os jogos?\b/,
];

// "Jogos hoje / agenda"
const JOGOS_HOJE_PATTERNS: RegExp[] = [
  /\bjogos? (?:de )?hoje\b/,
  /\btem jogo (?:hoje|agora)\b/,
  /\bagenda\b/,
  /\bquais jogos? (?:vao|tao|tem) (?:hoje|rolando|acontecendo)\b/,
  /\bo que tem hoje\b/,
];

// "Meus pontos / quanto fiz"
const MEUS_PONTOS_PATTERNS: RegExp[] = [
  /^meus? pontos?\b/,
  /\bquantos? ponto/,
  /\bquanto (?:eu )?fiz\b/,
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

// "Obrigado / valeu / brigado" — cordialidade, nao saudacao
const AGRADECIMENTO_PATTERNS: RegExp[] = [
  /^(?:muito )?obrigad[ao]( mesmo)?\b/,
  /^(?:muito )?brigad[ao]( mesmo)?\b/,
  /^obrigadao\b/,
  /^brigadao\b/,
  /^valeu( mesmo)?\b/,
  /^vlw+\b/,
  /^vlww+\b/,
  /^vlwww+\b/,
  /^thx\b/,
  /^thanks?\b/,
  /^tmj\b/,
  /^tamo junto\b/,
  /^agradecid[ao]\b/,
  /^agrade[cç]o\b/,
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
  /^fui\b/,
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
  /\bcomo (?:voc[eê] )?(?:vai|ta|esta|anda|vai indo)\b/,
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
];

// ISSUE-011: EDITAR_PALPITE — "corrigir", "mudar", "alterar" palpite
// Pode vir com placar: "corrigir Brasil 3x1". Capturamos o resto da frase em args.
const EDITAR_PALPITE_PATTERNS: RegExp[] = [
  /^(?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer) (?:meu )?palpite/,
  /\b(?:quero|preciso|vou) (?:corrigir|mudar|alterar|trocar|atualizar|editar|refazer) (?:meu |o |um )?palpite/,
  /\bcorrigir (?:o )?placar\b/,
  /^errei (?:o |meu )?palpite/,
  /\bpalpite errado\b/,
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
  // MEU_PALPITE (mais especifico) antes do PALPITES_AMBIGUO
  { intencao: Intencao.MEU_PALPITE, padroes: MEU_PALPITE_PATTERNS },
  // PALPITES_AMBIGUO so casa "palpites" sozinho — quando nada acima bateu
  { intencao: Intencao.PALPITES_AMBIGUO, padroes: PALPITES_AMBIGUO_PATTERNS },
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

function matchIntent(norm: string): Intencao | null {
  for (const { intencao, padroes } of INTENT_RULES) {
    if (padroes.some((p) => p.test(norm))) {
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
    !/^como (?:eh|funciona) (?:a )?pontuacao\b/.test(norm);
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
  if (!palpite && raw.includes('\n')) {
    for (const linha of raw.split('\n').map((l) => l.trim()).filter(Boolean)) {
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
function tentarParsearPalpiteInline(linha: string): PalpiteInline | null {
  const direto = linha.match(PALPITE_REGEX);
  if (direto) {
    return {
      timeCasa: direto[1].trim(),
      golsCasa: parseInt(direto[2], 10),
      golsVisitante: parseInt(direto[3], 10),
      timeVisitante: direto[4].trim(),
    };
  }

  // Substitui extenso no texto original (preserva case dos times)
  // mas operando palavra a palavra de forma case-insensitive
  const comDigitos = linha.replace(
    /\b(zero|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\b/gi,
    (m) => NUMEROS_EXTENSO[m.toLowerCase()] ?? m,
  );
  if (comDigitos !== linha) {
    const segunda = comDigitos.match(PALPITE_REGEX);
    if (segunda) {
      return {
        timeCasa: segunda[1].trim(),
        golsCasa: parseInt(segunda[2], 10),
        golsVisitante: parseInt(segunda[3], 10),
        timeVisitante: segunda[4].trim(),
      };
    }
  }

  return null;
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
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const ok: PalpiteInline[] = [];
  const descartadas: string[] = [];
  for (const line of lines) {
    const p = tentarParsearPalpiteInline(line);
    if (p) {
      ok.push(p);
    } else if (line.length >= 5) {
      descartadas.push(line);
    }
  }
  if (descartadas.length > 0) {
    console.log(`[multi-palpite] ok=${ok.length} descartadas=${descartadas.length}`);
  }
  return { ok, descartadas };
}

// Suprime "imports usados apenas pelo regex"
void substituirNumerosExtenso;
