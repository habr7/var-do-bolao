import { medalha, resultadoEmoji } from './football.terms.js';

export interface RankingEntry {
  nome: string;
  pontuacaoTotal: number;
  posicao: number;
}

export interface JogoDisplay {
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number | null;
  golsVisitante: number | null;
  status: string;
}

export interface PalpiteDisplay {
  timeCasa: string;
  timeVisitante: string;
  golsCasa: number;
  golsVisitante: number;
  pontosObtidos?: number;
}

export function formatRanking(nome: string, rodada: number, campeonato: string, entries: RankingEntry[]): string {
  const header = `🏆 *RANKING — ${nome}*\nRodada ${rodada} | ${campeonato}\n${'─'.repeat(30)}`;

  const lines = entries.map((e) =>
    `${medalha(e.posicao)} ${e.nome} ${'·'.repeat(Math.max(1, 20 - e.nome.length))} ${e.pontuacaoTotal} pts`
  );

  return `${header}\n${lines.join('\n')}\n${'─'.repeat(30)}\n📊 _VAR do Bolão_`;
}

export function formatJogosRodada(numero: number, campeonato: string, jogos: JogoDisplay[]): string {
  const header = `⚽ *Rodada ${numero}* — ${campeonato}\n`;

  const lines = jogos.map((j, i) => {
    if (j.golsCasa !== null && j.golsVisitante !== null) {
      return `${i + 1}. ${j.timeCasa} ${j.golsCasa} x ${j.golsVisitante} ${j.timeVisitante} ✅`;
    }
    return `${i + 1}. ${j.timeCasa} x ${j.timeVisitante}`;
  });

  return `${header}${lines.join('\n')}`;
}

export function formatPalpitesUsuario(rodada: number, palpites: PalpiteDisplay[]): string {
  const header = `📋 *Seus palpites — Rodada ${rodada}*\n`;

  const lines = palpites.map((p) => {
    const emoji = p.pontosObtidos !== undefined ? ` ${resultadoEmoji(p.pontosObtidos)} (${p.pontosObtidos}pts)` : '';
    return `• ${p.timeCasa} ${p.golsCasa}x${p.golsVisitante} ${p.timeVisitante}${emoji}`;
  });

  return `${header}${lines.join('\n')}`;
}

export function formatResultados(rodada: number, jogos: JogoDisplay[]): string {
  const finalizados = jogos.filter((j) => j.golsCasa !== null);
  if (finalizados.length === 0) return '⏳ Nenhum jogo finalizado ainda nesta rodada.';

  const header = `⚽ *RESULTADOS — Rodada ${rodada}*\n${'─'.repeat(30)}`;

  const lines = finalizados.map((j) =>
    `${j.timeCasa} ${j.golsCasa} x ${j.golsVisitante} ${j.timeVisitante} ✅`
  );

  return `${header}\n${lines.join('\n')}\n${'─'.repeat(30)}\n📺 _VAR do Bolão_`;
}

/**
 * Bug Humberto 18/05: este texto estava completamente desatualizado, mostrando
 * o formato `!comando` legado da v1 que nao funciona mais. A UX atual eh
 * linguagem natural sem prefixo. Atualizado pra refletir os intents e
 * fluxos suportados em v3.2.0+.
 *
 * O parametro `prefix` eh ignorado (mantido pra compat); pode ser removido
 * num refactor futuro.
 */
export function formatAjuda(_prefix: string): string {
  void _prefix;
  return `📖 *VAR do Bolão — Guia completo*

Fala comigo em *português normal*, sem prefixo. Eu entendo gírias e erros de digitação.

⚽ *Palpitar* (jeito mais rápido):
Manda o placar direto, qualquer formato funciona:
• \`Brasil 2x1 Marrocos\`
• \`Brasil 2 a 1 Marrocos\`
• \`Brasil dois a um Marrocos\` (extenso)
• \`Brasil perde de 1 a 0 do Marrocos\` (narrativa)
Vários de uma vez, um por linha — eu mostro preview e você confirma.

🏆 *Bolão (admin)*:
• *criar bolão* — cria novo (gratuito)
• *como convido* — pega o link wa.me pra encaminhar
• *aprovado Fulano* / *recusar Fulano* — aprova/recusa pedido
• *renomear bolão* — muda o nome
• *remover Fulano* — tira alguém
• *excluir bolão* — encerra (palpites/ranking ficam guardados)

🎟️ *Entrar em bolão*:
• Clica no link wa.me que o admin mandou (caminho mais rápido)
• Ou manda o ID: \`#K3MZ8P\`
• Ou *entrar em bolão* + nome

📊 *Consultas*:
• *ranking* — classificação do bolão (ou \`ranking Firma FC\`)
• *meus pontos* / *pontuação* — sua posição
• *meus palpites* — histórico
• *próximos jogos* / *jogos hoje* — agenda
• *meus bolões* — todos os bolões que você participa
• *quem participa* — quem está em cada bolão
• *como tô indo nos bolões* — resumo cruzado
• *regras* — pontuação 10/7/5/3/0

✏️ *Editar / apagar palpite*:
• *corrigir palpite* / *mudar palpite*
• *apagar palpite* / *desfazer palpite*

⭐ *Bolão padrão* (multi-bolão):
• *bolão padrão* — define qual usar por default
Comandos como ranking, meus pontos passam a usar ele direto.

🚪 *Sair*:
• *sair do bolão* — sai (palpites ficam no histórico)
• *cancelar* — aborta qualquer fluxo em andamento

💡 _Em dúvida, manda *menu* ou *ajuda* — eu volto aqui._`;
}
