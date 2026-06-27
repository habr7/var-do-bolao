import { prisma } from '../config/database.js';
import { jogoEstaRolandoPorHorario } from '../utils/jogo-status.js';
import { formatarDataHoraCurtaBR, formatarHoraBR } from '../utils/datetime.js';
import { ehTimePlaceholder } from '../data/bracket-2026.js';

/**
 * v3.32.0 — Bloco de DADOS AO VIVO pro smart-fallback conversacional.
 *
 * Bug estrutural (caso Humberto 11/06 23:49): quando uma pergunta caía no
 * `responderConversacional`, o LLM era PROIBIDO de afirmar placares (regra
 * anti-alucinação) e não recebia NENHUM dado do banco — então respondia
 * "essa eu nao sei te responder" mesmo com o jogo ROLANDO na base.
 *
 * Este builder monta um bloco enxuto com os jogos dos bolões do usuário:
 *   🔴 rolando agora (status AO_VIVO ou kickoff < 2.5h) com placar parcial
 *   ✅ finalizados nas últimas 48h com placar
 *   ⏳ próximos (até 5) com data/hora
 *
 * O bloco vai como `bloqueFatos` no responder — o LLM pode afirmar SÓ o
 * que está nele (mesma regra do [FATOS VERIFICADOS] da Copa). Retorna null
 * quando não há nada a dizer (não infla o prompt à toa).
 */
const TETO_CHARS = 900;

export async function construirFatosVivos(usuarioId: string): Promise<string | null> {
  const agora = new Date();
  const corte48h = new Date(agora.getTime() - 48 * 3600_000);

  let jogos;
  try {
    jogos = await prisma.jogo.findMany({
      where: {
        rodada: { bolao: { participacoes: { some: { usuarioId } } } },
        OR: [
          { status: 'AO_VIVO' },
          { status: 'FINALIZADO', dataHora: { gte: corte48h } },
          { status: 'AGENDADO', dataHora: { gte: corte48h } },
        ],
      },
      orderBy: { dataHora: 'asc' },
      take: 40,
    });
  } catch (error) {
    console.error('[fatos-vivos] query falhou:', (error as Error).message);
    return null;
  }
  if (jogos.length === 0) return null;

  // Dedup por par de times (mesmo jogo em N bolões) + descarta jogos de
  // mata-mata ainda com time placeholder ("Vencedor 73") — senão o LLM
  // afirmaria "Vencedor 73 joga..." pro usuário.
  const vistos = new Set<string>();
  const unicos = jogos.filter((j) => {
    if (ehTimePlaceholder(j.timeCasa) || ehTimePlaceholder(j.timeVisitante)) return false;
    const k = `${j.timeCasa}|${j.timeVisitante}|${j.dataHora.getTime()}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });

  const rolando: string[] = [];
  const finalizados: string[] = [];
  const proximos: string[] = [];

  for (const j of unicos) {
    if (j.status === 'FINALIZADO') {
      if (j.golsCasa !== null && j.golsVisitante !== null) {
        finalizados.push(`- ${j.timeCasa} ${j.golsCasa} x ${j.golsVisitante} ${j.timeVisitante} (encerrado)`);
      }
    } else if (jogoEstaRolandoPorHorario(j, agora)) {
      const placar =
        j.golsCasa !== null && j.golsVisitante !== null
          ? `${j.golsCasa} x ${j.golsVisitante}`
          : 'placar parcial indisponível';
      rolando.push(`- ${j.timeCasa} x ${j.timeVisitante} — ROLANDO AGORA (${placar}, começou ${formatarHoraBR(j.dataHora)})`);
    } else if (j.dataHora.getTime() > agora.getTime() && proximos.length < 5) {
      proximos.push(`- ${j.timeCasa} x ${j.timeVisitante} — ${formatarDataHoraCurtaBR(j.dataHora)}`);
    }
  }

  if (rolando.length === 0 && finalizados.length === 0 && proximos.length === 0) return null;

  const partes: string[] = [`[DADOS AO VIVO — ${formatarDataHoraCurtaBR(agora)} BRT, jogos dos bolões deste usuário]`];
  if (rolando.length > 0) partes.push(`Rolando agora:\n${rolando.join('\n')}`);
  if (finalizados.length > 0) partes.push(`Finalizados (últimas 48h):\n${finalizados.slice(-8).join('\n')}`);
  if (proximos.length > 0) partes.push(`Próximos jogos:\n${proximos.join('\n')}`);
  partes.push('[FIM DOS DADOS AO VIVO]');

  const bloco = partes.join('\n\n');
  return bloco.length > TETO_CHARS ? bloco.slice(0, TETO_CHARS) + '\n[FIM DOS DADOS AO VIVO]' : bloco;
}
