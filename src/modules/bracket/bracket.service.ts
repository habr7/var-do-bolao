import { prisma } from '../../config/database.js';
import { timeCorresponde } from '../../utils/validators.js';
import { ehTimePlaceholder } from '../../data/bracket-2026.js';
import type { FaseTorneio } from '@prisma/client';

/**
 * Leitura da CHAVE semeada/avançada pros handlers de dúvida (ADVERSARIO_TIME,
 * HORARIO_JOGO, VER_CHAVE). Lê só jogos de mata-mata (fase != GRUPOS) das
 * rodadas dos bolões do usuário. Não inventa adversário: jogo com time
 * placeholder ("Vencedor 73") é reportado como dependência.
 */

export interface JogoMataMata {
  apiJogoId: string;
  fase: FaseTorneio;
  timeCasa: string;
  timeVisitante: string;
  dataHora: Date;
  status: string;
  golsCasa: number | null;
  golsVisitante: number | null;
  bolaoNome: string;
}

/** IDs dos bolões em que o usuário participa (participante OU admin ativo). */
async function bolaoIdsDoUsuario(usuarioId: string): Promise<string[]> {
  const [participacoes, adminados] = await Promise.all([
    prisma.participacao.findMany({ where: { usuarioId }, select: { bolaoId: true } }),
    prisma.bolao.findMany({ where: { adminId: usuarioId, status: 'ATIVO' }, select: { id: true } }),
  ]);
  return [...new Set([...participacoes.map((p) => p.bolaoId), ...adminados.map((a) => a.id)])];
}

/** Todos os jogos de mata-mata dos bolões do usuário, ordenados por data. */
export async function buscarJogosMataMataDoUsuario(usuarioId: string): Promise<JogoMataMata[]> {
  const bolaoIds = await bolaoIdsDoUsuario(usuarioId);
  if (bolaoIds.length === 0) return [];

  const rodadas = await prisma.rodada.findMany({
    where: { bolaoId: { in: bolaoIds }, fase: { not: 'GRUPOS' } },
    include: { bolao: { select: { nome: true } }, jogos: true },
  });

  const jogos: JogoMataMata[] = [];
  for (const rodada of rodadas) {
    for (const j of rodada.jogos) {
      jogos.push({
        apiJogoId: j.apiJogoId,
        fase: j.fase,
        timeCasa: j.timeCasa,
        timeVisitante: j.timeVisitante,
        dataHora: j.dataHora,
        status: j.status,
        golsCasa: j.golsCasa,
        golsVisitante: j.golsVisitante,
        bolaoNome: rodada.bolao.nome,
      });
    }
  }
  jogos.sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
  return jogos;
}

export interface ConfrontoDoTime {
  jogo: JogoMataMata;
  /** Adversário do time procurado (ou placeholder se ainda não definido). */
  adversario: string;
  /** True se o adversário ainda é placeholder ("Vencedor 73"). */
  adversarioIndefinido: boolean;
}

/**
 * Acha o PRÓXIMO confronto de mata-mata de um time nos bolões do usuário. Casa
 * o nome com tolerância (acento/abreviação) via timeCorresponde. Ignora jogos
 * onde o próprio time procurado ainda é placeholder. Retorna o primeiro (mais
 * cedo) confronto encontrado, ou null se o time não está na chave do usuário.
 */
export async function acharConfrontoDoTime(
  usuarioId: string,
  timeNome: string,
): Promise<ConfrontoDoTime | null> {
  const jogos = await buscarJogosMataMataDoUsuario(usuarioId);
  for (const jogo of jogos) {
    const ehCasa = !ehTimePlaceholder(jogo.timeCasa) && timeCorresponde(timeNome, jogo.timeCasa);
    const ehVisitante =
      !ehTimePlaceholder(jogo.timeVisitante) && timeCorresponde(timeNome, jogo.timeVisitante);
    if (!ehCasa && !ehVisitante) continue;

    const adversario = ehCasa ? jogo.timeVisitante : jogo.timeCasa;
    return {
      jogo,
      adversario,
      adversarioIndefinido: ehTimePlaceholder(adversario),
    };
  }
  return null;
}
