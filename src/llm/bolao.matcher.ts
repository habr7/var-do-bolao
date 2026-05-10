import { chat, tryParseJson } from './ollama.client.js';

/**
 * Tenta encontrar um bolao numa lista a partir do texto livre do usuario.
 * Estrategia em duas etapas:
 *   1. Match fuzzy local (substring case+acento-insensitivo) — rapido e
 *      cobre ~90% dos casos quando o usuario digita parte do nome.
 *   2. LLM (se nada bater): pergunta ao Ollama qual bolao da lista o
 *      usuario quis dizer, com confianca. Util quando o usuario diz
 *      "o da firma", "aquele com o pessoal do trampo", etc.
 *
 * Devolve null quando ambas as etapas falham.
 */

interface BolaoOption {
  id: string;
  nome: string;
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export async function escolherBolaoDaLista(
  textoUsuario: string,
  boloes: BolaoOption[],
): Promise<BolaoOption | null> {
  if (boloes.length === 0) return null;
  if (boloes.length === 1) return boloes[0]; // so tem um, retorna

  const alvo = normalize(textoUsuario);
  if (!alvo) return null;

  // ------ Etapa 1: match fuzzy local ------
  // Match exato primeiro
  const exato = boloes.find((b) => normalize(b.nome) === alvo);
  if (exato) return exato;

  // Substring (incluso ou inclui) — escolhe o mais especifico (nome mais
  // longo) entre os matches, pra "Bolão da Firma 2026" bater com o nome
  // completo se o usuario disser "firma 2026" e nao confundir com "Bolão da Firma".
  const matches = boloes.filter((b) => {
    const norm = normalize(b.nome);
    return norm.includes(alvo) || alvo.includes(norm);
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    // Match mais longo ganha (heuristica de especificidade)
    matches.sort((a, b) => b.nome.length - a.nome.length);
    return matches[0];
  }

  // ------ Etapa 2: LLM ------
  const SYSTEM_PROMPT = `Voce ajuda a identificar qual bolao o usuario quer, dada uma lista de boloes em que ele participa e uma mensagem dele em portugues coloquial.

Responda APENAS com JSON valido:
{"bolaoId": "ID_DO_BOLAO_OU_NONE", "confianca": 0.0-1.0}

Use confianca > 0.7 quando estiver razoavelmente certo. Se for ambiguo ou nao reconhecer, retorne {"bolaoId": "NONE", "confianca": 0}.`;

  const userPrompt =
    `Boloes:\n` +
    boloes.map((b) => `- ${b.id}: "${b.nome}"`).join('\n') +
    `\n\nMensagem do usuario:\n"${textoUsuario}"`;

  const raw = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { json: true, temperature: 0.1, maxTokens: 80 },
  );

  const parsed = tryParseJson<{ bolaoId: string; confianca: number }>(raw);
  if (!parsed) return null;
  if (typeof parsed.confianca !== 'number' || parsed.confianca < 0.7) return null;
  if (parsed.bolaoId === 'NONE') return null;

  return boloes.find((b) => b.id === parsed.bolaoId) ?? null;
}

/**
 * Interpreta uma resposta sim/nao do usuario via heuristica + LLM fallback.
 */
export async function interpretarSimNao(textoUsuario: string): Promise<'SIM' | 'NAO' | null> {
  const norm = normalize(textoUsuario);

  const sim = ['sim', 's', 'yes', 'y', 'claro', 'manda', 'manda ai', 'pode', 'pode mandar', 'quero', 'aham', 'beleza', 'ok', 'okay', 'ta', 'isso', 'positivo', 'manda ver', 'show'];
  const nao = ['nao', 'n', 'no', 'naum', 'deixa', 'deixa pra la', 'depois', 'depois nao', 'agora nao', 'negativo', 'nem', 'pula'];

  if (sim.some((w) => norm === w || norm.startsWith(w + ' '))) return 'SIM';
  if (nao.some((w) => norm === w || norm.startsWith(w + ' '))) return 'NAO';

  // LLM fallback
  const raw = await chat(
    [
      {
        role: 'system',
        content:
          'Classifique a mensagem do usuario em portugues como "SIM", "NAO" ou "AMBIGUO". Responda APENAS com JSON: {"resposta":"SIM|NAO|AMBIGUO","confianca":0-1}.',
      },
      { role: 'user', content: textoUsuario },
    ],
    { json: true, temperature: 0.1, maxTokens: 50 },
  );

  const parsed = tryParseJson<{ resposta: string; confianca: number }>(raw);
  if (!parsed || parsed.confianca < 0.7) return null;
  if (parsed.resposta === 'SIM') return 'SIM';
  if (parsed.resposta === 'NAO') return 'NAO';
  return null;
}
