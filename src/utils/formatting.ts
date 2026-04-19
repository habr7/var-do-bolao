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

export function formatAjuda(prefix: string): string {
  return `📖 *VAR do Bolão — Comandos*

👑 *Admin:*
${prefix}criar bolao [nome] — Cria um bolão
${prefix}abrir rodada [N] — Abre rodada para palpites
${prefix}fechar rodada — Fecha rodada atual
${prefix}calcular — Calcula pontuação

⚽ *Participante:*
${prefix}entrar — Entra no bolão
${prefix}sair — Sai do bolão
${prefix}palpite — Registra palpites
${prefix}meu palpite — Vê seus palpites
${prefix}ranking — Ranking geral
${prefix}rodada — Jogos da rodada
${prefix}meus pontos — Sua pontuação
${prefix}resultados — Resultados dos jogos

💡 _Você também pode enviar palpites direto:_
_Flamengo 2x1 Palmeiras_`;
}
