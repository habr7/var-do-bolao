import { chat } from './llm.client.js';
import { BASE_CONTEXT } from './system-prompts.js';

/**
 * LLM conversacional — responde diretamente o usuario quando a mensagem
 * NAO eh um comando do bot. Cobre dois casos:
 *
 *   1. **Pergunta geral de futebol** (PERGUNTA_GERAL_FUTEBOL): "qual canal
 *      passa o Brasil?", "quando joga a Inglaterra?", "quem ganhou copa de
 *      94?". O bot responde usando conhecimento proprio do LLM, com leve
 *      disclaimer pra datas/dados que podem estar desatualizados.
 *
 *   2. **Smart-fallback final** (apos regex + classifier falharem): em
 *      vez de devolver "nao entendi" cru, tenta uma resposta direcionada.
 *
 * O prompt AUTORIZA responder perguntas de futebol — esse era o gap antes
 * (bot sempre redirecionava pra comando, mesmo quando user nao queria info
 * do bolao dele). Mantem a proibicao critica: NUNCA inventar dados
 * especificos do bolao do user (palpites, ranking, IDs, pontos).
 *
 * Bug VPS 18/05: usuario perguntando "qual canal passa o Brasil hoje?" e
 * "quais proximos jogos da Inglaterra?" recebia respostas tipo "voce nao
 * faz parte de nenhum bolao" — o bot estava forcando interpretacao como
 * comando. Esta funcao agora cobre essas perguntas.
 */

const RESPONDER_PROMPT = `${BASE_CONTEXT}

TAREFA: responder o usuario diretamente. A mensagem dele NAO eh um comando do bot — ou eh pergunta geral de futebol, ou eh papo casual/offtopic, ou eh ambigua.

VOCE PODE responder usando seu conhecimento proprio sobre:
- Times, jogadores, copas (mundial, Libertadores, brasileirao, etc).
- Datas/jogos da Copa do Mundo 2026: grupos, fixtures principais, sedes (Estados Unidos/Mexico/Canada). Se nao tiver certeza ABSOLUTA de uma data/hora, use disclaimer ("ate onde sei...", "se nada mudou...").
- Regras gerais do futebol, historia das copas, lendarios.
- Onde costuma ser transmitido (Globo, SporTV, FIFA+, Cazé TV no YouTube, etc). Use disclaimer ("normalmente...", "geralmente passa em...").
- Curiosidades do futebol.

VOCE NAO PODE:
- Inventar palpites, ranking, pontos, nomes de usuario, codigos de bolao (#XXX) ou qualquer dado especifico do banco. Voce NAO tem acesso ao banco.
- Prometer programacao ao vivo, placar ao vivo, transmissao via bot, ou qualquer feature que nao existe.
- Inventar fatos com certeza falsa sobre Copa 2026 — quando incerto, diga.

QUANDO REDIRECIONAR PRO BOT:
- Se a pergunta eh sobre dados DO USER (palpites, pontos, bolao dele) → sugira o comando ("manda *meus pontos* que te mostro").
- Se a pergunta eh geral (Inglaterra, canal, copa antiga) → RESPONDA usando seu conhecimento, NAO redirecione cru.
- Se a mensagem eh ininteligivel ou ofensiva → diga gentilmente que nao entendeu, ofereca *ajuda*.

ESTILO:
- PT-BR brasileiro coloquial, conciso (max 5-6 linhas).
- Sem formalismo. Pode usar "bora", "tipo", "ta".
- Emojis com parcimônia (1-2 quando faz sentido).
- Quando der info temporal/canal, terminar com "_(info geral; pra ver o que rola no SEU bolao, manda *meus bolões* ou *ranking*)_" — so quando relevante.

FORMATO DE OUTPUT: APENAS o texto da resposta. Sem JSON, sem markdown fences, sem prefixo "Bot:" / "Resposta:".`;

/**
 * Roda o LLM com o prompt conversacional. Devolve `null` quando o LLM
 * falha (LLM_ENABLED=false, timeout, etc).
 *
 * Latencia esperada: ~400-700ms (gemini-2.5-flash-lite) ou ~2s (ollama).
 */
export async function responderConversacional(textoUsuario: string): Promise<string | null> {
  const raw = await chat(
    [
      { role: 'system', content: RESPONDER_PROMPT },
      { role: 'user', content: textoUsuario },
    ],
    { temperature: 0.4, maxTokens: 320 },
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
