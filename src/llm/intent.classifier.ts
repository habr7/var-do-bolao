import { Intencao } from '../whatsapp/message.parser.js';
import { chat, tryParseJson } from './llm.client.js';
import { INTENT_CLASSIFIER_PROMPT } from './system-prompts.js';

/**
 * Classifica uma mensagem em linguagem natural numa das intencoes conhecidas.
 * So eh chamado quando o parser regex falhou (intencao = TEXTO_LIVRE).
 *
 * Devolve `null` se o LLM nao funcionou OU nao soube classificar — caller
 * deve usar a resposta padrao "nao entendi".
 *
 * Threshold de confianca: 0.55. Mais baixo que o classico 0.6 porque o
 * regex parser (camada 1) ja absorve as variantes obvias — quando cai aqui
 * eh porque a mensagem eh ambigua mesmo, e ainda assim preferimos arriscar
 * uma intencao plausivel do que cair no generico "nao entendi" (frustra
 * mais o usuario).
 */

const INTENCOES_VALIDAS = [
  Intencao.SAUDACAO,
  Intencao.MENU,
  Intencao.AJUDA,
  Intencao.CRIAR_BOLAO,
  Intencao.ENTRAR_BOLAO,
  Intencao.MEUS_BOLOES,
  Intencao.RANKING,
  Intencao.MEUS_PONTOS,
  Intencao.JOGOS_HOJE,
  Intencao.PROXIMOS_JOGOS,
  Intencao.MEU_PALPITE,
  Intencao.ABRIR_RODADA,
  Intencao.COMO_CONVIDAR,
  Intencao.SAIR_BOLAO,
  Intencao.QUEM_PARTICIPA,
  Intencao.PENDENTES,
  Intencao.CANCELAR,
] as const;

// Prompt antigo (inline) — comentado pra rollback rapido. O ativo agora
// vem de system-prompts.ts (INTENT_CLASSIFIER_PROMPT).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _LEGACY_INLINE_PROMPT = `Voce eh um classificador de intencoes para um bot de WhatsApp brasileiro chamado "VAR do Bolao", que gerencia boloes da Copa do Mundo FIFA 2026.

O usuario escreve em portugues coloquial (girias, abreviacoes, erros de digitacao, gerundios brasileiros, "cê", "vc", "to"). Sua tarefa: identificar UMA das intencoes abaixo. Pense pelo SENTIDO da pergunta, nao palavras-chave literais.

INTENCOES:

- SAUDACAO: cumprimentar, abrir conversa. Ex: "oi", "salve", "fala bot", "e ai cara".
- MENU: pedir pra ver opcoes. Ex: "menu", "comeca de novo", "voltar pro inicio".
- AJUDA: nao sabe o que pode fazer. Ex: "ajuda", "como funciona?", "o que voce faz?", "pra que serve esse bot?".
- CRIAR_BOLAO: quer criar/abrir um bolao novo. Ex: "quero abrir um bolao", "monta um bolao pra mim", "bora criar".
- ENTRAR_BOLAO: quer entrar em bolao existente. Ex: "me coloca num bolao", "como entro?", "quero participar".
- MEUS_BOLOES: ver os boloes em que o usuario participa. Ex: "meus boloes", "onde eu jogo", "em qual bolao to?".
- RANKING: ver classificacao. Ex: "ranking", "tabela", "quem ta na frente", "quem ta ganhando".
- MEUS_PONTOS: quer saber a propria pontuacao. Ex: "quantos pontos eu fiz?", "meu placar", "estou em que posicao?".
- JOGOS_HOJE: o que tem hoje. Ex: "tem jogo hoje?", "agenda", "que jogo vai rolar?".
- PROXIMOS_JOGOS: jogos futuros, especialmente os que faltam palpite. Ex: "proximos jogos", "quais eu ainda nao palpitei?", "o que falta palpitar?", "quero palpitar", "bora palpitar nos jogos".
- MEU_PALPITE: ver palpites JA dados. Ex: "meus palpites", "o que eu chutei?", "quais palpites dei?".
- ABRIR_RODADA: admin quer abrir/iniciar uma rodada de palpites. Ex: "abrir rodada", "como inicio a rodada", "começar bolão", "abrir os palpites".
- COMO_CONVIDAR: usuario (admin) quer saber como compartilhar o bolao com gente nova. Ex: "como convido pessoas", "manda o convite", "pegar o ID do bolão", "como chamo amigos pro bolão".
- SAIR_BOLAO: usuario quer sair de um bolao. Ex: "sair do bolão", "não quero mais jogar", "me remove".
- QUEM_PARTICIPA: listar quem esta em um bolao. Ex: "quem participa", "quem ta no bolão", "lista de participantes".
- PENDENTES: admin perguntando solicitacoes pendentes de aprovacao. Ex: "tem pedido pra aprovar?", "pendentes".
- CANCELAR: cancelar acao em andamento. Ex: "esquece", "deixa pra la", "para".
- DESCONHECIDO: mensagem nao se encaixa em nada acima ou eh ambigua demais.

DISTINCAO IMPORTANTE:
- "Meus palpites" (MEU_PALPITE) = ver o que JA palpitei → mostrar historico.
- "Proximos jogos" / "o que falta palpitar" (PROXIMOS_JOGOS) = ver o que AINDA NAO palpitei → entrar em modo de palpite.
- "Meus pontos" (MEUS_PONTOS) = ver pontuacao numerica.
- "Ranking" (RANKING) = ver tabela com todo mundo.

Responda APENAS com JSON valido neste formato:
{"intencao": "NOME_DA_INTENCAO", "confianca": 0.0-1.0, "motivo": "frase curta"}

Se voce nao tiver pelo menos 55% de certeza, retorne intencao=DESCONHECIDO. Mas seja generoso com mensagens claras em portugues coloquial — o usuario ja errou uma vez no parser regex; nao devolva DESCONHECIDO so porque a frase tem giria ou erro de digitacao.`;

interface ClassificationResult {
  intencao: string;
  confianca: number;
  motivo?: string;
}

export async function classificarIntencao(text: string): Promise<Intencao | null> {
  const raw = await chat(
    [
      { role: 'system', content: INTENT_CLASSIFIER_PROMPT },
      { role: 'user', content: text },
    ],
    { json: true, temperature: 0.1, maxTokens: 100 },
  );

  const parsed = tryParseJson<ClassificationResult>(raw);
  if (!parsed) return null;
  if (typeof parsed.confianca !== 'number' || parsed.confianca < 0.55) return null;

  // Valida que a intencao retornada eh uma das aceitas
  const intencao = (INTENCOES_VALIDAS as readonly string[]).includes(parsed.intencao)
    ? (parsed.intencao as Intencao)
    : null;

  return intencao;
}
