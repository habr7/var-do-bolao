import { chat } from './llm.client.js';
import { BASE_CONTEXT } from './system-prompts.js';

/**
 * Smart fallback final: quando o regex parser E o intent classifier
 * falharam em classificar a mensagem em uma das intencoes conhecidas,
 * em vez de devolver "nao entendi" cru, pede ao LLM uma resposta curta
 * e direcionada.
 *
 * O system prompt instrui o modelo:
 *   - PT-BR coloquial, conciso (max 4-5 linhas)
 *   - NUNCA inventar dados especificos (palpites, datas, bolaes)
 *   - Quando o user fizer pergunta sobre dados, direcionar pro comando
 *     correto ("manda *próximos jogos* pra ver", "manda *ranking*")
 *   - Quando o user falar algo offtopic (futebol em geral, etc), respondem
 *     casualmente mas curtos
 *   - Em ultimo caso, sugerir o menu/ajuda
 *
 * Retorna `string | null`. Caller decide o fallback (geralmente o "nao
 * entendi" textual + menu).
 */

const RESPONDER_PROMPT = `${BASE_CONTEXT}

TAREFA: o usuario mandou uma mensagem que o parser/classifier NAO conseguiu mapear em nenhuma intent conhecida. Voce responde como o bot, em portugues brasileiro casual, em ate 4-5 linhas.

COMANDOS DISPONIVEIS (use pra redirecionar):
- *próximos jogos* — ver jogos abertos pra palpitar
- *meus palpites* — ver palpites ja dados
- *meus pontos* — pontuacao do usuario
- *ranking* — quem ta na frente
- *regras* — regras de pontuacao
- *como convido* — pegar mensagem de convite (admin)
- *quem participa* — lista de quem ta no bolao
- *criar bolão* / *entrar em bolão* — fluxos basicos

DIRETRIZES:
1. NUNCA invente: numero de palpite, nome de bolao, codigo (#XXX), placar, nome de usuario, data, ranking. Voce nao tem acesso ao banco.
2. Se a pergunta exige dado especifico, sugere o comando correto ("manda *meus pontos* que te mostro").
3. Se a mensagem for casual/social ("e ai?", "blz", "tudo bem"), responde curto e casual e oferece ajuda.
4. Se for pergunta de futebol generica que voce sabe responder (regras do esporte, copa, etc), responde curto sem inventar dados.
5. Se for completamente ininteligivel ou ofensiva, diga gentilmente que nao entendeu e mostre 3 opcoes principais.
6. NUNCA prometa funcionalidade que nao existe (placar ao vivo, transmissao, audio, etc).

FORMATO DE OUTPUT: APENAS o texto da resposta, sem JSON, sem markdown fences, sem "voce poderia dizer".`;

/**
 * Roda o LLM com o prompt de fallback conversacional. Devolve `null`
 * quando o LLM falha (LLM_ENABLED=false, timeout, etc).
 *
 * Latencia esperada: ~500ms (gemini-2.5-flash) ou ~2s (ollama).
 */
export async function responderConversacional(textoUsuario: string): Promise<string | null> {
  const raw = await chat(
    [
      { role: 'system', content: RESPONDER_PROMPT },
      { role: 'user', content: textoUsuario },
    ],
    { temperature: 0.4, maxTokens: 250 },
  );
  if (!raw) return null;
  // Garante que nao tenha JSON fences ou prefixos suspeitos
  const cleaned = raw
    .replace(/^```(?:json|text)?/i, '')
    .replace(/```$/i, '')
    .trim();
  // Limite duro: nao deixa o LLM mandar um texto absurdamente longo
  if (cleaned.length > 1200) return cleaned.slice(0, 1200) + '...';
  return cleaned;
}
