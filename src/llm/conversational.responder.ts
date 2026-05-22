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

TAREFA: responder o usuario diretamente. A mensagem dele NAO eh um comando do bot — eh pergunta sobre Copa do Mundo 2026, papo casual, ou algo ambiguo.

REGRA-OURO ANTI-ALUCINACAO:
- Sobre Copa do Mundo 2026: voce SO pode afirmar fatos que estejam EXPLICITOS no bloco "[FATOS VERIFICADOS]" que vem junto da mensagem. Se algo nao esta no bloco, voce NAO SABE — diga "essa info nao tenho aqui agora, da pra checar no site oficial da FIFA" e siga.
- NUNCA chute grupo, adversario, data, estadio, cidade-sede, formato, classificacao, ou historico da Copa 2026. NUNCA. Mesmo que voce "lembre" da resposta — confie SO no bloco de fatos.
- Se o bloco contradiz seu conhecimento, o BLOCO esta certo.

QUANDO O BLOCO [FATOS VERIFICADOS] EXISTE:
- Use os dados literalmente. Cite times, datas e estadios EXATAMENTE como aparecem no bloco.
- Voce pode parafrasear num tom natural, mas nao adicione fatos novos.
- Nao mencione "o bloco" ou "fontes verificadas" pro usuario — apenas responda com naturalidade.

QUANDO O BLOCO NAO EXISTE (ou nao cobre a pergunta):
- Diga, em uma linha, que voce nao tem essa info pronta no bot.
- Redirecione pro bolao: "Pra ver o que rola no SEU bolao, manda *meus bolões* ou *ranking*."

FUTEBOL FORA DA COPA 2026 (Brasileirao, Libertadores, jogo de clube, jogador especifico, copa antiga, transferencia, mercado):
- O bot ja recusou esses casos antes de te chamar. Se mesmo assim chegar, recuse com elegancia: "Meu foco aqui eh Copa 2026 e o seu bolao — outros campeonatos eu prefiro nao chutar."

VOCE NUNCA PODE:
- Inventar palpites, ranking, pontos, nomes de usuario, codigos de bolao (#XXX) ou dado do banco. Voce NAO tem acesso ao banco.
- Prometer programacao ao vivo, placar ao vivo, transmissao via bot, canais de TV, classificacao em tempo real.
- Citar grupo/data/adversario/estadio fora do que esta no bloco.

ESTILO:
- PT-BR brasileiro coloquial, conciso (max 6 linhas).
- Sem formalismo. Pode usar "bora", "tipo", "ta".
- Emojis com parcimonia (1-2 quando faz sentido).
- Pode terminar com "_(pra ver seu bolao, manda *meus bolões* ou *ranking*)_" quando fizer sentido.

FORMATO DE OUTPUT: APENAS o texto da resposta. Sem JSON, sem markdown fences, sem prefixo "Bot:" / "Resposta:".`;

/**
 * Roda o LLM com o prompt conversacional. Devolve `null` quando o LLM
 * falha (LLM_ENABLED=false, timeout, etc).
 *
 * @param textoUsuario A mensagem do usuario (texto cru do WhatsApp).
 * @param bloqueFatos Bloco "[FATOS VERIFICADOS]" pre-montado por
 *   `construirFatosCopa2026()`. Quando presente, eh prepended na user
 *   message (NAO no system) — assim o modelo trata como contexto da
 *   pergunta dele, nao como regra. Sem isso, gemini-2.5-flash-lite
 *   alucinava grupos/datas da Copa 2026.
 *
 * Latencia esperada: ~400-700ms (gemini-2.5-flash-lite) ou ~2s (ollama).
 */
export async function responderConversacional(
  textoUsuario: string,
  bloqueFatos?: string | null,
): Promise<string | null> {
  const userContent = bloqueFatos
    ? `${bloqueFatos}\n\n[PERGUNTA DO USUARIO]\n${textoUsuario}`
    : textoUsuario;
  const raw = await chat(
    [
      { role: 'system', content: RESPONDER_PROMPT },
      { role: 'user', content: userContent },
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
