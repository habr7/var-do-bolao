/**
 * Helpers de data/hora — TODOS forçam fuso de Brasília.
 *
 * Bug Jeni 11/06 (anexo): bot listou "13/06, 22:00 — Brasil x Marrocos"
 * em VPS UTC porque chamadas `toLocaleDateString/toLocaleString` SEM
 * `timeZone: 'America/Sao_Paulo'` usam o fuso do servidor. Como a VPS
 * roda UTC (default Linux), o display ficou 3h adiantado. JSON estava
 * correto (`2026-06-13T19:00:00-03:00`), banco estava correto, trava
 * de palpite estava correta — só o DISPLAY mentia.
 *
 * Use esses helpers em vez de chamar `toLocaleDateString` direto pra
 * garantir que o display SEMPRE bate com Brasília, independente do
 * fuso do servidor.
 */

const TZ_BR = 'America/Sao_Paulo';

/** "13/06, 19:00" (formato curto: dia/mês + hora). */
export function formatarDataHoraCurtaBR(d: Date): string {
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ_BR,
  });
}

/** "sáb., 13/06, 19:00" (com dia da semana — útil pro "próximo jogo"). */
export function formatarDataHoraComDiaBR(d: Date): string {
  return d.toLocaleString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ_BR,
  });
}

/** "sáb., 13/06" (dia da semana + data, sem hora — cabeçalho de agrupamento). */
export function formatarDataComDiaBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: TZ_BR,
  });
}

/** "13/06" (só dia/mês). */
export function formatarDataBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    timeZone: TZ_BR,
  });
}

/** "19:00" (só hora). */
export function formatarHoraBR(d: Date): string {
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ_BR,
  });
}
