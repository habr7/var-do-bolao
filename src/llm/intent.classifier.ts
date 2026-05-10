import { Intencao } from '../whatsapp/message.parser.js';
import { chat, tryParseJson } from './ollama.client.js';

/**
 * Classifica uma mensagem em linguagem natural numa das intencoes conhecidas.
 * So eh chamado quando o parser regex falhou (intencao = TEXTO_LIVRE).
 *
 * Devolve `null` se o LLM nao funcionou OU nao soube classificar — caller
 * deve usar a resposta padrao "nao entendi".
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
  Intencao.MEU_PALPITE,
  Intencao.PENDENTES,
  Intencao.CANCELAR,
] as const;

const SYSTEM_PROMPT = `Voce eh um classificador de intencoes para um bot de WhatsApp brasileiro chamado "VAR do Bolao", que gerencia boloes de futebol.
Receba uma mensagem do usuario em portugues coloquial (com gírias, abreviacoes, erros de digitacao) e classifique em UMA destas intencoes:

- SAUDACAO: oi, olá, eai, bom dia, boa tarde, "como vai?"
- MENU: pessoa quer ver o menu, "começar", "início"
- AJUDA: pessoa quer ajuda, comandos, "como funciona", "o que da pra fazer"
- CRIAR_BOLAO: quer criar/abrir/montar um bolao novo
- ENTRAR_BOLAO: quer participar/entrar/se juntar a um bolao existente
- MEUS_BOLOES: quer ver os boloes em que participa, "meus jogos", "onde eu jogo"
- RANKING: quer ver classificacao/posicoes/ranking
- MEUS_PONTOS: quer saber a propria pontuacao, "quanto eu fiz", "meu placar"
- JOGOS_HOJE: quer saber quais jogos tem hoje, "tem jogo hoje?", "agenda"
- MEU_PALPITE: quer ver os palpites que ja deu, "o que eu chutei?"
- PENDENTES: admin perguntando por solicitacoes pendentes
- CANCELAR: quer cancelar acao em andamento, "esquece", "deixa pra la"
- DESCONHECIDO: a mensagem nao se encaixa em nenhuma das intencoes acima ou eh ambigua demais

Responda APENAS com JSON valido neste formato:
{"intencao": "NOME_DA_INTENCAO", "confianca": 0.0-1.0, "motivo": "frase curta"}

Se confianca < 0.6, retorne intencao=DESCONHECIDO.`;

interface ClassificationResult {
  intencao: string;
  confianca: number;
  motivo?: string;
}

export async function classificarIntencao(text: string): Promise<Intencao | null> {
  const raw = await chat(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
    ],
    { json: true, temperature: 0.1, maxTokens: 100 },
  );

  const parsed = tryParseJson<ClassificationResult>(raw);
  if (!parsed) return null;
  if (typeof parsed.confianca !== 'number' || parsed.confianca < 0.6) return null;

  // Valida que a intencao retornada eh uma das aceitas
  const intencao = (INTENCOES_VALIDAS as readonly string[]).includes(parsed.intencao)
    ? (parsed.intencao as Intencao)
    : null;

  return intencao;
}
