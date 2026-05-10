import type { PalpiteInline } from '../whatsapp/message.parser.js';
import { chat, tryParseJson } from './ollama.client.js';

/**
 * Extrai palpites de mensagens em linguagem natural.
 * Ex:
 *   "acho que o flamengo ganha de 2 a 1 do palmeiras"
 *   "brasil 3, argentina 1"
 *   "vai dar empate por 0 a 0 entre corinthians e sao paulo"
 *
 * So eh chamado quando o parser regex (parseMultiplePalpites) nao achou
 * nada — para nao chamar LLM atoa quando o usuario escreveu no formato
 * canonico "Time1 NxN Time2".
 *
 * Recebe a lista de jogos disponiveis na rodada para guiar a extracao.
 * Devolve [] se nao conseguiu extrair (caller faz fallback "nao entendi").
 */

interface JogoDisponivel {
  timeCasa: string;
  timeVisitante: string;
}

interface ExtractedPalpite {
  timeCasa: string;
  golsCasa: number;
  timeVisitante: string;
  golsVisitante: number;
}

interface ExtractionResult {
  palpites: ExtractedPalpite[];
}

const SYSTEM_PROMPT = `Voce eh um extrator de palpites de futebol em mensagens informais em portugues do Brasil.

Vai receber:
1. Uma lista de jogos disponiveis (cada jogo tem timeCasa e timeVisitante).
2. Uma mensagem de usuario que pode conter um ou mais palpites em linguagem natural.

Sua tarefa: identificar quais jogos o usuario palpitou e qual o placar de cada um.

Importante:
- Os times no palpite extraido DEVEM ser exatamente os mesmos da lista de jogos disponiveis (case e acentos iguais).
- Se a mensagem mencionar so um time (ambiguo), tenta inferir pelo contexto. Se nao der, ignora esse palpite.
- Numeros podem vir como digitos ("2x1"), por extenso ("dois a um") ou frase ("ganha de 3 a zero").
- Se nao tiver certeza, retorne palpites: [].
- Mensagem como "vai dar empate" sem placar especifico = ignora.

Responda APENAS com JSON valido neste formato:
{"palpites": [{"timeCasa": "X", "golsCasa": N, "timeVisitante": "Y", "golsVisitante": M}, ...]}

Se nao extrair nada, retorne {"palpites": []}.`;

export async function extrairPalpites(
  text: string,
  jogosDisponiveis: JogoDisponivel[],
): Promise<PalpiteInline[]> {
  if (jogosDisponiveis.length === 0) return [];

  const userPrompt =
    `Jogos disponiveis:\n` +
    jogosDisponiveis.map((j) => `- ${j.timeCasa} x ${j.timeVisitante}`).join('\n') +
    `\n\nMensagem do usuario:\n"${text}"`;

  const raw = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    { json: true, temperature: 0.1, maxTokens: 400 },
  );

  const parsed = tryParseJson<ExtractionResult>(raw);
  if (!parsed?.palpites) return [];

  return parsed.palpites
    .filter((p) =>
      typeof p.timeCasa === 'string' &&
      typeof p.timeVisitante === 'string' &&
      Number.isInteger(p.golsCasa) &&
      Number.isInteger(p.golsVisitante) &&
      p.golsCasa >= 0 &&
      p.golsVisitante >= 0,
    )
    .map((p) => ({
      timeCasa: p.timeCasa,
      timeVisitante: p.timeVisitante,
      golsCasa: p.golsCasa,
      golsVisitante: p.golsVisitante,
    }));
}
