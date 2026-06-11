/**
 * Camada de "grounding" da Copa 2026. Roda ANTES da LLM nas perguntas
 * classificadas como PERGUNTA_GERAL_FUTEBOL. Extrai entidades da pergunta
 * do usuário, monta um bloco `[FATOS VERIFICADOS]` a partir do JSON
 * oficial (openfootball, em src/data/copa-2026/), e decide se a pergunta
 * está dentro do escopo do bot (só Copa 2026).
 *
 * Por que existe: gemini-2.5-flash-lite alucina datas/grupos/composição
 * quando responde de cabeça. Antes, dizia "Inglaterra está no grupo C
 * com EUA e Irã" — tudo errado. Com o bloco de fatos injetado, a LLM
 * passa a citar apenas o que verificamos.
 *
 * Não chama LLM. Tudo é regex/dicionário/lookup local — latência ~ms.
 */
import {
  type Jogo,
  type LetraGrupo,
  getComposicaoGrupo,
  getDataFinal,
  getDataInicio,
  getEstadio,
  getEstadios,
  getGrupoDoTime,
  getJogosDoGrupo,
  getJogosNaData,
  getMataMata,
  getProximosJogosDoTime,
  getSedes,
  getTimes,
  metadata,
  normalizarNomeTime,
  // v3.11.0 — convocações/squads
  getJogadoresDoTime,
  buscarJogador,
  getPosicaoLabel,
  type Jogador,
} from '../modules/copa-2026/index.js';

export type MotivoGround =
  | 'TIME'
  | 'GRUPO'
  | 'DATA'
  | 'ESTADIO_SEDE'
  | 'GERAL_COPA'
  | 'FORA_DE_COPA'
  | 'AMBIGUO'
  // v3.11.0 — pergunta sobre convocação/elenco/jogador
  | 'SQUAD';

export interface FatosCopa {
  dentroDoEscopo: boolean;
  motivo: MotivoGround;
  /** Bloco que vai junto do prompt do user (null se foraDeEscopo). */
  bloco: string | null;
  /** Termos detectados — útil pra debug/log. */
  detectado?: {
    times?: string[];
    grupos?: LetraGrupo[];
    datas?: string[];
    estadios?: string[];
    foraEscopo?: string;
  };
}

// ============================================================
// Detecção de "fora de escopo" — termos que indicam que a pergunta
// não é sobre Copa 2026. Casamos contra texto normalizado (sem acentos,
// lowercase, sem pontuação), com word boundaries simulados por padding.
// Ordem importa: testamos termos longos antes de curtos.
// ============================================================

const TERMOS_FORA_ESCOPO: { termo: string; rotulo: string }[] = [
  // Competições de clubes
  { termo: 'libertadores', rotulo: 'Libertadores' },
  { termo: 'sul americana', rotulo: 'Sul-Americana' },
  { termo: 'sulamericana', rotulo: 'Sul-Americana' },
  { termo: 'brasileirao', rotulo: 'Brasileirão' },
  { termo: 'brasileirao serie a', rotulo: 'Brasileirão' },
  { termo: 'serie a', rotulo: 'Série A' },
  { termo: 'serie b', rotulo: 'Série B' },
  { termo: 'copa do brasil', rotulo: 'Copa do Brasil' },
  { termo: 'champions league', rotulo: 'Champions League' },
  { termo: 'champions', rotulo: 'Champions League' },
  { termo: 'premier league', rotulo: 'Premier League' },
  { termo: 'la liga', rotulo: 'La Liga' },
  { termo: 'bundesliga', rotulo: 'Bundesliga' },
  { termo: 'liga dos campeoes', rotulo: 'Champions League' },
  { termo: 'mundial de clubes', rotulo: 'Mundial de Clubes' },
  { termo: 'recopa', rotulo: 'Recopa' },
  // Clubes brasileiros mais comuns
  { termo: 'flamengo', rotulo: 'Flamengo' },
  { termo: 'palmeiras', rotulo: 'Palmeiras' },
  { termo: 'corinthians', rotulo: 'Corinthians' },
  { termo: 'sao paulo', rotulo: 'São Paulo' },
  { termo: 'santos', rotulo: 'Santos' },
  { termo: 'fluminense', rotulo: 'Fluminense' },
  { termo: 'vasco', rotulo: 'Vasco' },
  { termo: 'botafogo', rotulo: 'Botafogo' },
  { termo: 'gremio', rotulo: 'Grêmio' },
  { termo: 'internacional', rotulo: 'Internacional' },
  { termo: 'atletico mineiro', rotulo: 'Atlético Mineiro' },
  { termo: 'cruzeiro', rotulo: 'Cruzeiro' },
  { termo: 'bahia', rotulo: 'Bahia' },
  // Clubes europeus comuns
  { termo: 'real madrid', rotulo: 'Real Madrid' },
  { termo: 'barcelona', rotulo: 'Barcelona' },
  { termo: 'manchester city', rotulo: 'Manchester City' },
  { termo: 'manchester united', rotulo: 'Manchester United' },
  { termo: 'liverpool', rotulo: 'Liverpool' },
  { termo: 'chelsea', rotulo: 'Chelsea' },
  { termo: 'arsenal', rotulo: 'Arsenal' },
  { termo: 'psg', rotulo: 'PSG' },
  { termo: 'bayern', rotulo: 'Bayern' },
  { termo: 'juventus', rotulo: 'Juventus' },
  { termo: 'milan', rotulo: 'Milan' },
  { termo: 'inter de milao', rotulo: 'Inter de Milão' },
  // Copas históricas
  { termo: 'copa de 94', rotulo: 'Copa de 1994' },
  { termo: 'copa de 1994', rotulo: 'Copa de 1994' },
  { termo: 'copa de 98', rotulo: 'Copa de 1998' },
  { termo: 'copa de 1998', rotulo: 'Copa de 1998' },
  { termo: 'copa de 2002', rotulo: 'Copa de 2002' },
  { termo: 'copa de 2006', rotulo: 'Copa de 2006' },
  { termo: 'copa de 2010', rotulo: 'Copa de 2010' },
  { termo: 'copa de 2014', rotulo: 'Copa de 2014' },
  { termo: 'copa de 2018', rotulo: 'Copa de 2018' },
  { termo: 'copa de 2022', rotulo: 'Copa de 2022' },
  { termo: 'copa do qatar', rotulo: 'Copa de 2022' },
  { termo: 'copa da russia', rotulo: 'Copa de 2018' },
  // Jogadores citados sem contexto (proxy: muito específicos)
  // Atenção: nomes que também são times (ex: "Inglaterra") não entram aqui
  { termo: 'vinicius jr', rotulo: 'jogador específico' },
  { termo: 'vini jr', rotulo: 'jogador específico' },
  { termo: 'neymar', rotulo: 'jogador específico' },
  { termo: 'messi', rotulo: 'jogador específico' },
  { termo: 'cristiano ronaldo', rotulo: 'jogador específico' },
  { termo: 'mbappe', rotulo: 'jogador específico' },
  { termo: 'haaland', rotulo: 'jogador específico' },
  { termo: 'endrick', rotulo: 'jogador específico' },
  { termo: 'rodrygo', rotulo: 'jogador específico' },
];

function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectarForaEscopo(textoNormalizado: string): string | null {
  // Padding com espaços pra simular word boundary
  const t = ` ${textoNormalizado} `;
  // Ordena por tamanho desc pra evitar match curto antes do longo
  const ordenados = [...TERMOS_FORA_ESCOPO].sort((a, b) => b.termo.length - a.termo.length);
  for (const { termo, rotulo } of ordenados) {
    if (t.includes(` ${termo} `)) return rotulo;
  }
  return null;
}

// ============================================================
// Detecção de entidades dentro de escopo
// ============================================================

function detectarTimes(textoOriginal: string): string[] {
  // normalizarNomeTime aceita o texto inteiro só se ele inteiro for alias;
  // pra cobrir "quais jogos da Inglaterra na próxima semana?" varremos
  // ngrams de até 4 palavras buscando match.
  const palavras = textoOriginal.split(/\s+/).filter(Boolean);
  const achados = new Set<string>();
  for (let n = 4; n >= 1; n--) {
    for (let i = 0; i + n <= palavras.length; i++) {
      const trecho = palavras.slice(i, i + n).join(' ');
      const t = normalizarNomeTime(trecho);
      if (t) achados.add(t);
    }
  }
  return [...achados];
}

function detectarGrupos(textoNormalizado: string): LetraGrupo[] {
  const achados = new Set<LetraGrupo>();
  // "grupo A", "grupo da inglaterra" será resolvido por detectarTimes.
  // Aqui só "grupo X" direto.
  const re = /\bgrupo\s+([a-l])\b/g;
  let m;
  while ((m = re.exec(textoNormalizado)) !== null) {
    achados.add(m[1].toUpperCase() as LetraGrupo);
  }
  return [...achados];
}

function detectarPedidoSede(textoNormalizado: string): boolean {
  return /\b(sede|sedes|estadio|estadios|paises|paises sede|cidade|cidades|locais|locais dos jogos)\b/.test(
    textoNormalizado,
  );
}

function detectarPedidoData(textoNormalizado: string): boolean {
  return /\b(quando|que dia|que horas|inicio|comeca|abertura|estreia|final|termina|encerramento)\b/.test(
    textoNormalizado,
  );
}

/**
 * v3.11.0 — detecta perguntas sobre convocação/elenco de uma seleção
 * da Copa 2026. Cobre "quem foi convocado pra X", "elenco da X",
 * "escalação", "squad", "convocados", "jogadores convocados", etc.
 */
function detectarPedidoSquad(textoNormalizado: string): boolean {
  return /\b(convoca|convocad[oa]s?|elenco|squad|escala[cç][ãa]o|jogadores|convoc)\b/.test(
    textoNormalizado,
  );
}

// ============================================================
// Formatação de bloco
// ============================================================

const TZ_BR = 'horário de Brasília';
const MESES_PT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
];

function formatarDataHoraBR(iso: string): string {
  // iso: "2026-06-13T16:00:00-03:00"
  const [datepart, timepart] = iso.split('T');
  const [y, m, d] = datepart.split('-');
  const hhmm = timepart.slice(0, 5);
  return `${d}/${MESES_PT[parseInt(m, 10) - 1]} ${hhmm}`;
}

function formatarJogo(j: Jogo): string {
  return `• ${formatarDataHoraBR(j.dataHora)} (${TZ_BR}) — ${j.timeCasa} x ${j.timeVisitante} @ ${j.estadio}`;
}

function blocoHeader(): string {
  const meta = metadata();
  return `[FATOS VERIFICADOS — Copa do Mundo FIFA 2026, fonte: ${meta.fonte}, atualizado em ${meta.atualizadoEm.slice(0, 10)}]`;
}

function blocoTime(nome: string): string {
  const grupo = getGrupoDoTime(nome);
  if (!grupo) return '';
  const adversarios = getComposicaoGrupo(grupo)
    .filter((t) => t.nome !== nome)
    .map((t) => t.nome);
  const proximos = getProximosJogosDoTime(nome, 3);
  const linhas = [
    `${nome} está no Grupo ${grupo}, com ${adversarios.join(', ')}.`,
  ];
  if (proximos.length > 0) {
    linhas.push(`Próximos jogos:`);
    proximos.forEach((j) => linhas.push(formatarJogo(j)));
  } else {
    // Sem jogos futuros no nosso JSON — pode ser que a fase de grupos
    // já tenha acabado ou time eliminado (ainda não sabemos).
    linhas.push(`Sem próximos jogos confirmados nos dados atuais.`);
  }
  return linhas.join('\n');
}

function blocoGrupo(letra: LetraGrupo): string {
  const times = getComposicaoGrupo(letra);
  const jogos = getJogosDoGrupo(letra);
  const linhas = [
    `Grupo ${letra}: ${times.map((t) => t.nome).join(', ')}.`,
    `Jogos da fase de grupos:`,
  ];
  jogos.forEach((j) => linhas.push(formatarJogo(j)));
  return linhas.join('\n');
}

function blocoSede(): string {
  const sedes = getSedes();
  const linhas = [`A Copa 2026 é sediada em Canadá, Estados Unidos e México (3 países, 16 cidades-sede, 16 estádios).`];
  for (const [pais, cidades] of Object.entries(sedes)) {
    linhas.push(`${pais}: ${cidades.join(', ')}.`);
  }
  return linhas.join('\n');
}

/**
 * v3.11.0 — bloco com convocados de uma seleção. Lista até 26 jogadores
 * agrupados por posição. Acompanha rótulo da fonte (mesmo cabeçalho que
 * o resto do grounding).
 */
function blocoJogadores(nome: string): string {
  const jogadores = getJogadoresDoTime(nome);
  if (!jogadores || jogadores.length === 0) {
    return `Convocação da seleção ${nome} ainda não disponível nos dados oficiais.`;
  }
  const grupos: Record<string, Jogador[]> = { GK: [], DF: [], MF: [], FW: [] };
  for (const j of jogadores) grupos[j.posicao].push(j);
  const linhas = [`Convocação de ${nome} (${jogadores.length} jogadores):`];
  for (const pos of ['GK', 'DF', 'MF', 'FW'] as const) {
    if (grupos[pos].length === 0) continue;
    const nomes = grupos[pos]
      .sort((a, b) => a.numero - b.numero)
      .map((j) => `#${j.numero} ${j.nome}`)
      .join(', ');
    linhas.push(`${getPosicaoLabel(pos)} (${pos}): ${nomes}.`);
  }
  return linhas.join('\n');
}

/**
 * v3.11.0 — bloco quando user pergunta sobre um jogador específico
 * ("Neymar foi convocado?", "tem o Vinicius?"). Confirma a presença
 * (ou ausência) E inclui seleção/número/posição.
 */
function blocoJogadorEspecifico(busca: string): string | null {
  const hit = buscarJogador(busca);
  if (!hit) return null;
  const { time, jogador } = hit;
  return `Jogador ${jogador.nome} (${getPosicaoLabel(jogador.posicao)}) foi convocado pela seleção ${time}, camisa #${jogador.numero}.`;
}

function blocoEstadio(nomeOuCidade: string): string {
  const e = getEstadio(nomeOuCidade);
  if (!e) return '';
  return `Estádio ${e.nome} fica em ${e.cidade} (${e.pais}), capacidade ${e.capacidade.toLocaleString('pt-BR')}, fuso ${e.fuso}.`;
}

function blocoDataMarco(): string {
  const inicio = getDataInicio();
  const fim = getDataFinal();
  const totalEstadios = getEstadios().length;
  return [
    `Início: ${formatarDataHoraBR(inicio)} (${TZ_BR}).`,
    `Final: ${formatarDataHoraBR(fim)} (${TZ_BR}).`,
    `Formato: 48 seleções em 12 grupos (A–L), 104 jogos no total, ${totalEstadios} estádios.`,
  ].join('\n');
}

function blocoJogosNaData(data: string): string {
  const jogos = getJogosNaData(data);
  if (jogos.length === 0) return `Sem jogos confirmados em ${data}.`;
  const linhas = [`Jogos em ${data}:`];
  jogos.forEach((j) => linhas.push(formatarJogo(j)));
  return linhas.join('\n');
}

function blocoVisaoGeralCopa(): string {
  const mataMata = getMataMata();
  const sedes = getSedes();
  const totalSedesPais = Object.values(sedes).reduce((s, arr) => s + arr.length, 0);
  return [
    `Copa do Mundo FIFA 2026: 48 seleções, 12 grupos (A–L), 104 jogos.`,
    `Sediada em Canadá, Estados Unidos e México (${totalSedesPais} cidades, ${getEstadios().length} estádios).`,
    `Início: ${formatarDataHoraBR(getDataInicio())}. Final: ${formatarDataHoraBR(getDataFinal())} (${TZ_BR}).`,
    `Fase de grupos: 72 jogos. Mata-mata: ${mataMata.length} jogos (32-avos, oitavas, quartas, semis, 3º lugar e final).`,
  ].join('\n');
}

// ============================================================
// Função principal
// ============================================================

/**
 * Recebe a mensagem do usuário (texto cru) e devolve:
 *   - `dentroDoEscopo`: se a pergunta é sobre Copa 2026 (true) ou sobre
 *     outro tema futebolístico que o bot não cobre (false).
 *   - `bloco`: string pronta pra prepender no prompt da LLM. Sempre
 *     contém o cabeçalho de fonte. `null` quando foraDeEscopo.
 *   - `motivo`: rótulo do que foi detectado, pra log/metric.
 */
export function construirFatosCopa2026(textoUsuario: string): FatosCopa {
  const original = textoUsuario ?? '';
  const norm = normalizarTexto(original);

  // 1) Detectar fora de escopo PRIMEIRO. Termos de clube/copa antiga
  //    sobrescrevem qualquer match de seleção (ex: "vai dar Real Madrid
  //    contra Brasil de novo?" — fora de escopo).
  const foraEscopo = detectarForaEscopo(norm);

  // 2) Detectar entidades dentro de escopo
  const times = detectarTimes(original);
  const grupos = detectarGrupos(norm);
  const pedeSede = detectarPedidoSede(norm);
  const pedeData = detectarPedidoData(norm);
  const pedeSquad = detectarPedidoSquad(norm);

  // v3.11.0 — SQUAD tem precedência sobre fora-de-escopo SE a pergunta
  // é claramente sobre convocação E identificamos algo. Os termos
  // "neymar"/"mbappe"/etc estavam em TERMOS_FORA_ESCOPO porque ANTES
  // o bot não tinha dados de jogadores. Agora tem — perguntas tipo
  // "Neymar foi convocado?" / "tem Mbappé na convocação da França?"
  // devem ser respondidas com fatos verificados, não recusadas.
  if (pedeSquad) {
    const partesSquad: string[] = [blocoHeader()];
    let teveAlgo = false;
    // 1) Time mencionado → lista a convocação
    for (const t of times) {
      partesSquad.push(blocoJogadores(t));
      teveAlgo = true;
    }
    // 2) Senão, tenta achar um jogador específico citado
    if (!teveAlgo) {
      // ngrams de 1-3 palavras buscando jogador convocado
      const palavras = original.split(/\s+/).filter(Boolean);
      const tentativas = new Set<string>();
      for (let n = 3; n >= 1; n--) {
        for (let i = 0; i + n <= palavras.length; i++) {
          tentativas.add(palavras.slice(i, i + n).join(' '));
        }
      }
      for (const cand of tentativas) {
        const b = blocoJogadorEspecifico(cand);
        if (b) {
          partesSquad.push(b);
          teveAlgo = true;
          break;
        }
      }
    }
    if (teveAlgo) {
      return {
        dentroDoEscopo: true,
        motivo: 'SQUAD',
        bloco: partesSquad.join('\n\n'),
        detectado: { times: times.length ? times : undefined },
      };
    }
    // Pediu squad mas não achamos nem time nem jogador → cai no fluxo
    // normal, que provavelmente vai pra fora-de-escopo ou ambíguo.
  }

  if (foraEscopo) {
    // Se ALÉM do termo fora de escopo a mensagem cita um time da Copa,
    // ainda assim respeitamos o sinal mais forte de fora de escopo:
    // "Brasil ganhou a Libertadores?" → fora de escopo.
    return {
      dentroDoEscopo: false,
      motivo: 'FORA_DE_COPA',
      bloco: null,
      detectado: { foraEscopo, times: times.length ? times : undefined },
    };
  }

  const partes: string[] = [blocoHeader()];

  // Time específico mencionado
  if (times.length > 0) {
    times.forEach((t) => {
      const b = blocoTime(t);
      if (b) partes.push(b);
    });
    return {
      dentroDoEscopo: true,
      motivo: 'TIME',
      bloco: partes.join('\n\n'),
      detectado: { times },
    };
  }

  // Grupo direto ("grupo C")
  if (grupos.length > 0) {
    grupos.forEach((g) => partes.push(blocoGrupo(g)));
    return {
      dentroDoEscopo: true,
      motivo: 'GRUPO',
      bloco: partes.join('\n\n'),
      detectado: { grupos },
    };
  }

  // Sede / estádio
  if (pedeSede) {
    partes.push(blocoSede());
    return {
      dentroDoEscopo: true,
      motivo: 'ESTADIO_SEDE',
      bloco: partes.join('\n\n'),
    };
  }

  // Pergunta de data sem time/grupo
  if (pedeData) {
    partes.push(blocoDataMarco());
    return {
      dentroDoEscopo: true,
      motivo: 'DATA',
      bloco: partes.join('\n\n'),
    };
  }

  // Genérico: pergunta sobre "a copa", "copa do mundo", etc.
  if (/\b(copa do mundo|copa 2026|mundial|world cup|copa)\b/.test(norm)) {
    partes.push(blocoVisaoGeralCopa());
    return {
      dentroDoEscopo: true,
      motivo: 'GERAL_COPA',
      bloco: partes.join('\n\n'),
    };
  }

  // Não conseguimos identificar nada — devolvemos visão geral mesmo,
  // pra LLM ter ALGO pra ancorar. Marcamos como AMBIGUO pra métrica.
  partes.push(blocoVisaoGeralCopa());
  return {
    dentroDoEscopo: true,
    motivo: 'AMBIGUO',
    bloco: partes.join('\n\n'),
  };
}

/**
 * Mensagem padrão de recusa quando a pergunta cai fora do escopo
 * (Brasileirão, Libertadores, jogos de clube, jogadores específicos,
 * copas antigas). Tom: cordial, redireciona pro bolão.
 */
export function respostaForaDeEscopo(): string {
  return (
    `Meu foco aqui é Copa do Mundo 2026 e o seu bolão — sobre outros campeonatos, jogadores ou copas antigas eu prefiro não chutar pra não te passar info errada. 🙏\n\n` +
    `Pra ver o que rola no SEU bolão, manda *meus bolões*, *ranking* ou *meus pontos*.\n` +
    `Sobre a Copa 2026 (grupos, próximos jogos, sedes) eu respondo numa boa.`
  );
}

/**
 * Estilização compacta pra log: "ground=TIME times=Inglaterra".
 */
export function descreverGround(f: FatosCopa): string {
  const partes = [`ground=${f.motivo}`];
  if (f.detectado?.times?.length) partes.push(`times=${f.detectado.times.join(',')}`);
  if (f.detectado?.grupos?.length) partes.push(`grupos=${f.detectado.grupos.join(',')}`);
  if (f.detectado?.foraEscopo) partes.push(`foraEscopo=${f.detectado.foraEscopo}`);
  return partes.join(' ');
}
