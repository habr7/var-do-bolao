import { chamadaRevelacaoPalpites } from './football.terms.js';

/**
 * v3.24.0 — Revelação de palpites do bolão quando o jogo começa.
 *
 * Princípio de privacidade TEMPORAL: o palpite é secreto ATÉ o kickoff
 * (enquanto ainda dá pra editar/copiar). Quando a bola rola, o palpite
 * trava e vira público PRO BOLÃO daquele jogo — justo, ninguém leva
 * vantagem. Estas funções são PURAS (sem prisma/redis) pra serem
 * testadas isoladamente; o job e o handler montam os dados e chamam aqui.
 *
 * Escopo de segurança garantido pelo CALLER: os `palpites` passados
 * devem ser SEMPRE de um único jogo (jogoId) e os `participantes` os do
 * bolão dono daquele jogo — assim nunca vaza palpite de outro jogo nem
 * de bolão que a pessoa não participa.
 */

export interface LinhaRevelacao {
  nome: string;
  ehVoce: boolean;
  palpitou: boolean;
  golsCasa: number | null;
  golsVisitante: number | null;
}

export interface BlocoRevelacao {
  nomeBolao: string;
  timeCasa: string;
  timeVisitante: string;
  linhas: LinhaRevelacao[];
}

/**
 * Monta um bloco (1 bolão + 1 jogo) com a linha de cada participante.
 * Quem não palpitou aparece como "não palpitou". Ordem: palpiteiros
 * primeiro (com "Você" no topo), depois quem não palpitou — ambos
 * alfabéticos.
 */
export function montarBloco(params: {
  nomeBolao: string;
  timeCasa: string;
  timeVisitante: string;
  participantes: Array<{ id: string; nome: string }>;
  palpites: Array<{ usuarioId: string; golsCasa: number | null; golsVisitante: number | null }>;
  usuarioIdVoce: string;
}): BlocoRevelacao {
  const palpiteMap = new Map(params.palpites.map((p) => [p.usuarioId, p]));

  const linhas: LinhaRevelacao[] = params.participantes.map((part) => {
    const pj = palpiteMap.get(part.id);
    const palpitou = !!pj && pj.golsCasa !== null && pj.golsVisitante !== null;
    return {
      nome: part.nome,
      ehVoce: part.id === params.usuarioIdVoce,
      palpitou,
      golsCasa: palpitou ? pj!.golsCasa : null,
      golsVisitante: palpitou ? pj!.golsVisitante : null,
    };
  });

  linhas.sort((a, b) => {
    if (a.palpitou !== b.palpitou) return a.palpitou ? -1 : 1; // palpiteiros primeiro
    if (a.ehVoce !== b.ehVoce) return a.ehVoce ? -1 : 1; // "Você" no topo
    return a.nome.localeCompare(b.nome, 'pt-BR');
  });

  return {
    nomeBolao: params.nomeBolao,
    timeCasa: params.timeCasa,
    timeVisitante: params.timeVisitante,
    linhas,
  };
}

/** Renderiza a mensagem final (frase animadora + blocos por bolão). */
export function montarMensagemRevelacao(blocos: BlocoRevelacao[]): string {
  const corpo = blocos.map((b) => {
    const linhas = b.linhas.map((l) => {
      const quem = l.ehVoce ? 'Você' : l.nome;
      if (!l.palpitou) return `• ${quem}: _não palpitou_`;
      return `• ${quem}: *${l.golsCasa}×${l.golsVisitante}*`;
    });
    return `🏆 *${b.nomeBolao}* — ${b.timeCasa} x ${b.timeVisitante}\n${linhas.join('\n')}`;
  });

  return `${chamadaRevelacaoPalpites()}\n\n${corpo.join('\n\n')}\n\n🍿 Agora é torcer e ver quem cravou! 🎯`;
}
