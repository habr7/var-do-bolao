import { prisma } from '../../config/database.js';
import { normalizeTeamName } from '../../utils/validators.js';
import { montarBloco, type BlocoRevelacao } from '../../utils/palpite-reveal.js';

/**
 * v3.24.0 — Revelação de palpites do bolão quando o jogo começa.
 *
 * Fonte única da query + montagem de bloco, usada por:
 *   - send-palpite-reveal.job.ts (push automático no kickoff)
 *   - handlePalpiteOutros (resposta sob demanda)
 *
 * Segurança: `palpitesJogo` é SEMPRE de um único jogo (jogoId), e
 * `participacoes` são as do bolão dono daquele jogo. Como `Jogo.apiJogoId`
 * é único por rodada/bolão, é impossível vazar palpite de outro jogo ou
 * de bolão que a pessoa não participa.
 */

/** Include canônico pra montar a revelação de um jogo. */
export const INCLUDE_REVELACAO = {
  rodada: { include: { bolao: { include: { participacoes: { include: { usuario: true } } } } } },
  palpitesJogo: { include: { palpite: { select: { usuarioId: true } } } },
} as const;

export interface JogoRevelacao {
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
  rodada: {
    bolao: {
      nome: string;
      participacoes: Array<{ usuario: { id: string; nome: string; whatsappId: string } }>;
    };
  };
  palpitesJogo: Array<{
    golsCasa: number | null;
    golsVisitante: number | null;
    classificadoPalpite?: 'CASA' | 'VISITANTE' | null;
    palpite: { usuarioId: string };
  }>;
}

/**
 * Monta o bloco de um jogo na perspectiva de um usuário ("Você").
 * Retorna null se não vale revelar: bolão com <2 participantes (solo) ou
 * ninguém palpitou (nada a comparar).
 */
export function blocoDoJogo(jogo: JogoRevelacao, usuarioIdVoce: string): BlocoRevelacao | null {
  const participantes = jogo.rodada.bolao.participacoes.map((p) => ({
    id: p.usuario.id,
    nome: p.usuario.nome,
  }));
  if (participantes.length < 2) return null;

  const palpites = jogo.palpitesJogo.map((pj) => ({
    usuarioId: pj.palpite.usuarioId,
    golsCasa: pj.golsCasa,
    golsVisitante: pj.golsVisitante,
    classificadoPalpite: pj.classificadoPalpite ?? null,
  }));
  const houvePalpite = palpites.some((p) => p.golsCasa !== null && p.golsVisitante !== null);
  if (!houvePalpite) return null;

  return montarBloco({
    nomeBolao: jogo.rodada.bolao.nome,
    timeCasa: jogo.timeCasa,
    timeVisitante: jogo.timeVisitante,
    participantes,
    palpites,
    usuarioIdVoce,
  });
}

const JANELA_ONDEMAND_MS = 24 * 60 * 60 * 1000; // jogos iniciados nas últimas 24h

/**
 * Sob demanda: jogos JÁ INICIADOS (kickoff passado) nos bolões do usuário,
 * opcionalmente filtrados por time mencionado. Retorna [] se nenhum jogo
 * começou ainda — o caller decide explicar a regra nesse caso.
 *
 * v3.27.0 — quando o user cita um TIME específico ("placares dos demais
 * no jogo México x África"), a busca ignora a janela de 24h: jogo
 * finalizado é público pra sempre. A janela só vale pro pedido genérico
 * ("palpites de todos"), pra não despejar a Copa inteira na conversa.
 */
const TETO_BLOCOS = 8; // teto defensivo de tamanho de mensagem

export async function revelacoesParaUsuario(
  usuarioId: string,
  filtroTimes: string[] = [],
  // v3.54.0 — escopo da lista on-demand:
  //   'rolando' → só jogos que começaram e AINDA NÃO finalizaram (mais limpo,
  //               default do "palpite da galera" sem filtro de time);
  //   'todos'   → todos os iniciados na janela de 24h (live + finalizados).
  // Filtro por TIME ignora o escopo (citou o jogo → mostra, live ou não).
  escopo: 'rolando' | 'todos' = 'todos',
): Promise<{ blocos: BlocoRevelacao[]; total: number; totalRolando: number; totalTodos: number }> {
  const agora = new Date();
  const desde = new Date(agora.getTime() - JANELA_ONDEMAND_MS);

  const jogos = await prisma.jogo.findMany({
    where: {
      dataHora: filtroTimes.length > 0 ? { lte: agora } : { lte: agora, gte: desde },
      status: { notIn: ['ADIADO', 'CANCELADO'] },
      rodada: { bolao: { participacoes: { some: { usuarioId } } } },
    },
    include: INCLUDE_REVELACAO,
    orderBy: { dataHora: 'desc' },
  });

  // Uma query só → separa "todos" (todos os iniciados) de "rolando" (não
  // finalizados). Assim o caller sabe se vale oferecer "ver todos" sem 2ª ida.
  const blocosTodos: BlocoRevelacao[] = [];
  const blocosRolando: BlocoRevelacao[] = [];
  for (const jogo of jogos) {
    if (filtroTimes.length > 0 && !jogoBateTime(jogo.timeCasa, jogo.timeVisitante, filtroTimes)) {
      continue;
    }
    const bloco = blocoDoJogo(jogo, usuarioId);
    if (!bloco) continue;
    blocosTodos.push(bloco);
    if (jogo.status !== 'FINALIZADO') blocosRolando.push(bloco);
  }

  // Citar time força "todos" (jogo finalizado é público pra sempre).
  const usarRolando = escopo === 'rolando' && filtroTimes.length === 0;
  const escolhidos = usarRolando ? blocosRolando : blocosTodos;
  // v3.28.0 — devolve o total pra o caller avisar quando cortar (antes
  // cortava em 8 silenciosamente).
  return {
    blocos: escolhidos.slice(0, TETO_BLOCOS),
    total: escolhidos.length,
    totalRolando: blocosRolando.length,
    totalTodos: blocosTodos.length,
  };
}

function jogoBateTime(casa: string, visitante: string, filtroTimes: string[]): boolean {
  const c = normalizeTeamName(casa);
  const v = normalizeTeamName(visitante);
  return filtroTimes.some((t) => {
    const n = normalizeTeamName(t);
    return c.includes(n) || v.includes(n);
  });
}
