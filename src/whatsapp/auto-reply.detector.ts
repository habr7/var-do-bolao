/**
 * v3.18.0 — Detector de auto-reply de WhatsApp (e similares).
 *
 * Caso real (Lucas 11/06, print 09:00): bot mandou bom-dia → WhatsApp
 * dele tinha auto-reply configurada ("Agradeço seu contato, respondo
 * em breve") → bot interpretou como AGRADECIMENTO (pattern
 * `/^agrade[cç]o\b/`) → respondeu → auto-reply disparou de novo → loop
 * de 8 mensagens em ~60s.
 *
 * Risco: violação dos termos do WhatsApp (derruba número) + custo
 * absurdo na futura migração Meta Cloud API ($0.008-0.063/conversa).
 *
 * Estratégia: keywords clássicas que aparecem em ~95% das auto-replies
 * PT-BR de WhatsApp Business. Match case/acento-insensitive em texto
 * normalizado. Quando detectado, bot SILENCIA (não responde, não
 * registra como "não entendi") — só conta métrica.
 *
 * Defesa em profundidade: esta é a camada 1 de 4. As outras (patterns
 * AGRADECIMENTO restritos + cap 8/60s + detector de repetida) cobrem
 * o caso caso essa heurística falhe.
 */

/**
 * Normaliza texto pra comparação: remove acentos, lowercase, colapsa
 * espaços, remove pontuação. Permite casar "Agradeço seu contato!"
 * com "agradeco seu contato".
 */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Frases-chave que aparecem em auto-replies típicas de WhatsApp
 * Business em PT-BR. Cobertura focada em alta precisão (raro um humano
 * legítimo escrever exatamente isso de propósito).
 */
const PADROES_AUTO_REPLY: string[] = [
  // "Agradeço seu contato" — caso real Lucas 11/06
  'agradeco seu contato',
  'agradeco o seu contato',
  'agradeco sua mensagem',
  'agradeco pelo contato',
  // "Obrigado pelo contato / pela mensagem"
  'obrigado pelo contato',
  'obrigada pelo contato',
  'obrigado pela mensagem',
  'obrigada pela mensagem',
  'obrigado pelo seu contato',
  // "Respondo / retorno em breve"
  'respondo em breve',
  'respondo assim que possivel',
  'respondo o quanto antes',
  'respondo o mais rapido',
  'respondo assim que puder',
  'retorno em breve',
  'retorno assim que possivel',
  'retornarei em breve',
  'retornarei assim que',
  'sera respondida em breve',
  'sera respondida o quanto antes',
  'respondida assim que possivel',
  'responderei em breve',
  'responderei assim que',
  // Ausência / horário
  'estou ausente',
  'estarei ausente',
  'no momento nao posso atender',
  'momento nao posso atender',
  'no momento nao consigo',
  'fora do horario',
  'fora do expediente',
  'horario comercial',
  'horario de atendimento',
  'horario de expediente',
  // Auto-resposta declarada
  'mensagem automatica',
  'resposta automatica',
  'auto resposta',
  'auto reply',
  // Variações comuns "assim que possível"
  'assim que possivel',
  'o mais breve possivel',
  'o quanto antes',
];

/**
 * Retorna `true` se a mensagem parece auto-reply de WhatsApp Business.
 * Threshold: texto contém pelo menos 1 dos padrões clássicos.
 *
 * Falsos positivos esperados (aceitáveis):
 * - "obrigado pelo contato com a galera" — raro, e mesmo se rolar o
 *   custo é só não responder UMA mensagem (user manda outra coisa).
 *
 * Falsos negativos esperados:
 * - "Volto já 👋" — não casa, mas é tão curto que cai em DESPEDIDA ou
 *   TEXTO_LIVRE sem causar loop.
 */
export function parecAutoReply(texto: string): boolean {
  if (!texto) return false;
  const n = normalizar(texto);
  // Heurística adicional: auto-replies tendem a ser longas (≥ 25 chars).
  // Mensagens curtas como "obrigado" não são auto-reply.
  if (n.length < 25) return false;
  for (const padrao of PADROES_AUTO_REPLY) {
    if (n.includes(padrao)) return true;
  }
  return false;
}
