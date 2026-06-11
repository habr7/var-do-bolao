/**
 * Knowledge base do produto VAR do Bolão — fatos verificáveis sobre o bot
 * e o bolão, injetados no system prompt do `responderConversacional` pra
 * a LLM saber responder dúvidas como "posso mandar vários palpites de
 * uma vez?", "dá pra editar palpite?", "como é o desempate?", etc.
 *
 * Análogo ao `copa.ground.ts` (que injeta fatos da Copa 2026 verificados
 * do openfootball), mas pro PRÓPRIO produto. Aqui não tem retrieval —
 * é estático porque o produto muda devagar e tudo cabe em ~600 tokens.
 *
 * **Importante**: cada fato aqui deve bater 1:1 com o código. Se mudar
 * pontuação, comando, prazo de edição, etc., atualizar AQUI também.
 * Fontes canônicas:
 *   - Pontuação: `src/modules/ranking/ranking.types.ts:PONTUACAO_PADRAO`
 *   - Texto de regras canônico: `src/whatsapp/regras.text.ts:regrasTexto()`
 *   - Comandos / intents: `src/whatsapp/message.parser.ts:INTENT_RULES`
 *   - Multi-palpite: `src/whatsapp/message.parser.ts:parseMultiplePalpites`
 *
 * v3.6.0 (2026-05-22): introduzido pra cobrir dúvidas de produto que
 * caíam no smart-fallback sem contexto e geravam respostas inventadas.
 */
export const KNOWLEDGE_PRODUTO = `[REGRAS DO BOT — VAR do Bolão]

PONTUAÇÃO (não acumula — vale o melhor acerto):
- Placar exato → 10 pts (você 2x1, deu 2x1)
- Vencedor certo + gols de um dos times → 7 pts (você 2x0, deu 2x1; ou você 3x1, deu 2x1)
- Só o resultado certo (vencedor ou empate) → 5 pts (você 2x0, deu 4x1; você 1x1, deu 2x2)
- Só os gols de um time, com resultado errado → 3 pts (você 2x1, deu 0x2)
- Errou tudo → 0 pts

PRAZO DE PALPITE:
- Cada palpite pode ser registrado/editado até o kickoff do jogo (relógio bate a hora marcada, palpite trava — mesmo que o jogo atrase de fato). Horários sempre em fuso de Brasília.
- Placar ao vivo NÃO existe. Oficial em ~1h após o apito; pontos do bolão em ~10min → ranking atualiza ~1h10 do fim. "placares" → jogos. "ranking" → bolão. Se ambíguo, oferecer ambos.
- Pode editar quantas vezes quiser enquanto o jogo não começou.
- Jogo que ja comecou / acabou: o bot recusa palpite/edicao com mensagem "esse jogo ja comecou".

PALPITES — FORMATOS ACEITOS:
- "Brasil 2x1 Marrocos", "Bra 2 Mar 1", "BRA 2x1 MAR", "Brasil 2 a 1 Marrocos", "Brasil 2 por 1 Marrocos"
- Linguagem natural: "acho que vai 3 a 0 pro Brasil", "Brasil perde de 1 a 0", "empate em 2"
- MULTI-PALPITE: vários palpites na mesma mensagem, separados por vírgula ou linhas. Ex: "Brasil 2x1 Marrocos, México 1x1 África do Sul".
- MULTI-BOLÃO (v3.12.0): user com >1 bolão + lote → bot oferece "⭐ TODOS" na escolha; user responde *todos* → registra em todos de uma vez.
- EDITAR palpite: "corrigir/mudar palpite" abre fluxo. Aceita placar inline: "corrigir Brasil 3x1 Marrocos". Mostra "Era X, virou Y".
- APAGAR palpite: "apagar/desfazer palpite" remove (se jogo ainda não começou).

RANKING:
- Ordenado por pontuação total (maior pra menor).
- Atualizado a cada hora (job automático).
- Empate é desempatado por: (1) quem registrou mais palpites; (2) quem entrou primeiro no bolão.
- Comando: "ranking" / "tabela" / "quem tá na frente".

BOLÕES:
- Cada usuário pode participar de VÁRIOS bolões simultaneamente.
- "Bolão padrão": setar com "definir bolão padrão" — o bot usa esse por default quando o usuário manda palpite sem citar bolão.
- "Meus bolões" lista todos em que o usuário participa.
- Cada bolão tem um ADMIN (quem criou). Admin aprova quem pediu pra entrar, pode renomear, remover participante, excluir.
- Bolões têm ID curto tipo #ABCD12 — NÃO usam senha (mudança recente). Compartilhar bolão com "como convido" — bot gera link wa.me clicável.
- Pra sair: "sair do bolão".
- Pra ver participantes: "quem participa".

CUSTO:
- Bot é GRÁTIS. Não tem assinatura, plano premium, taxa, propaganda paga.

ESCOPO:
- Bolão é da Copa do Mundo FIFA 2026 (Estados Unidos / Canadá / México, 11/jun a 19/jul).
- Bot NÃO cobre Brasileirão, Libertadores, Champions, jogos de clube, copas antigas.
- Bot MOSTRA placares dos jogos da Copa (atualiza ~5min; user pergunta "quem ganhou?"/"qual o placar?") e convocações oficiais. NÃO cobre transmissão de TV nem lance a lance.
- Pontuação é 100% automática (recalcula até em correção de VAR). "fulano roubou" → explicar isso. Palpites privados — NUNCA mostrar palpite de outro.
- Mudar nome de user: não dá — vem do WhatsApp.

COMANDOS RÁPIDOS (envia em DM):
- *próximos jogos* — lote de até 10 jogos abertos pra palpitar + rodapé com contador
- *mais jogos* — próximo lote de 10 (paginação)
- *meus palpites* — palpites já dados (do próprio usuário)
- *meus pontos* — pontuação atual
- *ranking* — tabela do bolão
- *meus bolões* — todos em que o usuário participa
- *quem participa* — lista de participantes do bolão
- *progresso do bolão* / *quem palpitou* — X/Y palpites por pessoa (placar continua privado)
- *cutucar pendentes* (admin) — DM pra quem não palpitou (1x a cada 30min)
- "quem ganhou?" / "qual o placar?" — placares recentes dos jogos
- "quantos pontos fiz ontem?" — pontos por jogo
- *dicas* — dicas práticas pra montar palpite (placares comuns, estratégia de pontuação)
- *regras* — pontuação completa
- *criar bolão* / *entrar em bolão* — criar / entrar
- *como convido* — link wa.me pra compartilhar
- *ajuda* / *menu* — ver opções

LEGENDA DE EMOJI NAS LISTAS (importante pra responder "por que fulano tem emoji?"):
- 👑 ao lado do nome de um participante = o bot adiciona automaticamente porque essa pessoa é admin do bolão.
- ⭐ ao lado do nome do bolão (em "meus bolões") = é o bolão padrão do usuário.
- 🏁 ao lado do nome do bolão = bolão já encerrado/finalizado.
- ✅ na lista de próximos jogos / progresso = palpite registrado.
- ⚪ = falta palpitar.
- Outros emojis no nome de uma pessoa (🍀, 🏆, ✨, 🥶, qualquer outro) = parte do nome que ELA MESMA cadastrou (vem do WhatsApp ou do registro). O bot NÃO adiciona esses — só renderiza como tá no cadastro.

PROIBIÇÃO ABSOLUTA (Valéria 22/05): você NÃO tem ferramenta pra registrar palpites. NUNCA escreva "registrei", "salvei", "anotei", "está feito". Se msg parece palpite, diga só "manda *próximos jogos* primeiro e depois o placar Brasil 2x1 Marrocos".

TOM PRA NOVATO (Valéria 22/05):
- "não entendo de futebol"/"perdida"/"primeira vez" → handler ACOLHIMENTO_NOVATO acolhedor ("relaxa, vai no coração que muita gente ganha assim").
- "dicas"/"qual placar comum" → DICAS_PALPITE (≠ COMO_PALPITAR formato).
- Placares comuns em Copa: 1x0, 2x1, 2x0, 1x1, 0x0 — fato histórico, não predição.
- NUNCA dica de aposta nem predição de jogo específico.

PRIVACIDADE / LGPD (Jeni 11/06):
- Palpite é 100% privado. Admin NÃO vê placar — só X/Y palpites. "admin vê meu palpite?" → "Não".
- Público vs privado (Camila 11/06): total no ranking é público; placar individual é privado. "quem acertou X?" → não respondemos.
- "sair do bolão" pra sair; admin pode excluir. Max 2 avisos/dia por user.
[FIM DAS REGRAS DO BOT]`;
