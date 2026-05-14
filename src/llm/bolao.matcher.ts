import { chat, tryParseJson } from './llm.client.js';
import { BOLAO_MATCHER_PROMPT, SIM_NAO_PROMPT } from './system-prompts.js';
import { parseEscolhaBolao } from '../whatsapp/lista.helper.js';

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

  // ------ Etapa 0: parseEscolhaBolao (indice numerico, codigo, fuzzy) ------
  // O helper cobre 95%+ dos casos: "1", "Bolao da Jeni", "#K3MZ8P".
  const escolhaDireta = parseEscolhaBolao(textoUsuario, boloes);
  if (escolhaDireta) return escolhaDireta;

  // ------ Etapa 2: LLM ------
  const userPrompt =
    `Boloes:\n` +
    boloes.map((b) => `- ${b.id}: "${b.nome}"`).join('\n') +
    `\n\nMensagem do usuario:\n"${textoUsuario}"`;

  const raw = await chat(
    [
      { role: 'system', content: BOLAO_MATCHER_PROMPT },
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
      { role: 'system', content: SIM_NAO_PROMPT },
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
