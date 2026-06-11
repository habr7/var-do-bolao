/**
 * v3.20.0 — Estado derivado de jogo POR HORÁRIO.
 *
 * Por que existe: o openfootball (fonte de placares desde a v3.16.0)
 * NÃO publica placar ao vivo — commits da comunidade chegam ~30-60min
 * após o fim do jogo. Então o `Jogo.status` no banco fica `AGENDADO`
 * durante TODO o jogo (nenhum caminho seta AO_VIVO em produção).
 *
 * Análise feita com México x África do Sul ROLANDO (11/06 16:19, jogo
 * começou 16:00): "qual o placar?" respondia "não achei jogo rolando"
 * porque buscava `status: 'AO_VIVO'` que nunca existia.
 *
 * Solução: derivar o estado do HORÁRIO — o bot sabe o kickoff
 * (`dataHora`); se `dataHora <= agora < dataHora + 2.5h` e o jogo não
 * está FINALIZADO/ADIADO/CANCELADO, ele está rolando.
 *
 * Janela de 2.5h: jogo de futebol dura ~1h55 com intervalo; acréscimos
 * esticam. 2.5h cobre com folga. Após a janela, o jogo é considerado
 * "encerrado aguardando placar oficial" até o openfootball commitar.
 */

/** Duração máxima estimada de um jogo (kickoff → apito final + folga). */
export const JANELA_JOGO_ROLANDO_MS = 2.5 * 60 * 60 * 1000;

interface JogoStatusInput {
  dataHora: Date;
  status: string; // AGENDADO | AO_VIVO | FINALIZADO | ADIADO | CANCELADO
}

/**
 * Jogo está rolando AGORA (derivado por horário OU status explícito).
 */
export function jogoEstaRolandoPorHorario(jogo: JogoStatusInput, agora: Date = new Date()): boolean {
  if (jogo.status === 'FINALIZADO' || jogo.status === 'ADIADO' || jogo.status === 'CANCELADO') {
    return false;
  }
  if (jogo.status === 'AO_VIVO') return true; // status explícito vence
  const inicio = jogo.dataHora.getTime();
  const t = agora.getTime();
  return t >= inicio && t < inicio + JANELA_JOGO_ROLANDO_MS;
}

/**
 * Jogo já passou da janela de 2.5h mas o placar oficial ainda não
 * chegou (status segue AGENDADO/AO_VIVO no banco). Estado transitório
 * "⏳ encerrado, aguardando placar oficial" — esperado durar 30-60min
 * (latência do openfootball).
 */
export function jogoEncerradoAguardandoPlacar(jogo: JogoStatusInput, agora: Date = new Date()): boolean {
  if (jogo.status === 'FINALIZADO' || jogo.status === 'ADIADO' || jogo.status === 'CANCELADO') {
    return false;
  }
  const inicio = jogo.dataHora.getTime();
  return agora.getTime() >= inicio + JANELA_JOGO_ROLANDO_MS;
}

/**
 * Jogo ainda NÃO começou (palpite ainda aberto).
 */
export function jogoAindaNaoComecou(jogo: JogoStatusInput, agora: Date = new Date()): boolean {
  if (jogo.status === 'ADIADO' || jogo.status === 'CANCELADO') return false;
  return agora.getTime() < jogo.dataHora.getTime();
}
