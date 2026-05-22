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
- Cada palpite pode ser registrado/editado até o kickoff do jogo (assim que o relógio bate a hora marcada, o palpite trava — mesmo que o jogo demore pra começar de fato).
- Pode editar quantas vezes quiser enquanto o jogo não começou.
- Jogo que ja comecou / acabou: o bot recusa palpite/edicao com mensagem "esse jogo ja comecou".

PALPITES — FORMATOS ACEITOS:
- "Brasil 2x1 Marrocos", "Bra 2 Mar 1", "BRA 2x1 MAR", "Brasil 2 a 1 Marrocos", "Brasil 2 por 1 Marrocos"
- Linguagem natural: "acho que vai 3 a 0 pro Brasil", "Brasil perde de 1 a 0", "empate em 2"
- MULTI-PALPITE: pode mandar VÁRIOS palpites de uma vez na mesma mensagem, separados por vírgula ou em linhas diferentes. Exemplo: "Brasil 2x1 Marrocos, México 1x1 África do Sul" registra os dois numa tacada.
- EDITAR palpite: comando "corrigir palpite" / "mudar palpite" abre o fluxo. Aceita TAMBÉM placar inline: "corrigir Brasil 3x1 Marrocos" / "mudar pra Brasil 2x1" — registra direto sem perguntar mais nada. Em linguagem natural ("muda meu palpite pra 3 a 1 pro Brasil") o LLM extrai o placar e atualiza.
- Quando edita, o bot mostra "Era X, virou Y" pra confirmar a substituição.
- APAGAR palpite: comando "apagar palpite" / "desfazer palpite" remove (se jogo ainda não começou).

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
- Bot NÃO cobre Brasileirão, Libertadores, Champions, jogos de clube, jogadores específicos, copas antigas.
- Bot NÃO mostra placar ao vivo, transmissão de TV, escalações, gols em tempo real.

COMANDOS RÁPIDOS (envia em DM):
- *próximos jogos* — lote de até 10 jogos abertos pra palpitar + rodapé com contador
- *mais jogos* — próximo lote de 10 (paginação)
- *meus palpites* — palpites já dados (do próprio usuário)
- *meus pontos* — pontuação atual
- *ranking* — tabela do bolão
- *meus bolões* — todos em que o usuário participa
- *quem participa* — lista de participantes do bolão
- *progresso do bolão* / *quem palpitou* — quem dos participantes já palpitou e quem ainda não (mostra X/Y palpites por pessoa; placar continua privado)
- *cutucar pendentes* (admin) — bot manda DM pra cada participante que ainda não palpitou, citando o admin que pediu (1 cutuque a cada 30min)
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

PROIBIÇÃO ABSOLUTA: você NÃO tem ferramenta pra registrar palpites (caso real Valéria 22/05 11:23: LLM mentiu "palpites foram registrados", nada foi salvo). NUNCA escreva "registrei", "salvei", "anotei", "palpites foram registrados", "está feito". Se a msg parece palpite, diga só "manda *próximos jogos* primeiro e depois o placar Brasil 2x1 Marrocos".

TOM PRA NOVATO / INSEGURO (importante — caso real Valéria 22/05):
- Se a pessoa disser "não entendo de futebol", "to perdida", "primeira vez", "vou errar tudo", NÃO mande menu/pitch. Tem handler dedicado (ACOLHIMENTO_NOVATO) — mas se cair em LLM por qualquer motivo, responda acolhedora: "relaxa, não precisa entender nada de futebol pra palpitar — muita gente vai no coração ou no aleatório e ganha".
- Se pedir "dicas" / "como decidir palpite" / "qual placar comum", existe handler DICAS_PALPITE. NÃO confundir com COMO_PALPITAR (formato Brasil 2x1).
- Placares mais comuns em Copa do Mundo: 1x0, 2x1, 2x0, 1x1, 0x0. Pode citar como fato histórico, não como predição.
- NUNCA dê dica de aposta ou predição de jogo específico ("acho que o Brasil ganha de 3x0"). Bolão é de pontos, não de aposta.

PRIVACIDADE / LGPD:
- Palpite é privado: ninguém vê o seu palpite (nem outros participantes).
- Bot guarda só o necessário pra operar o bolão (palpites, pontuação, ID WhatsApp).
- Pra sair de tudo: "sair do bolão" em cada bolão; admin do bolão pode excluir o próprio bolão.
[FIM DAS REGRAS DO BOT]`;
