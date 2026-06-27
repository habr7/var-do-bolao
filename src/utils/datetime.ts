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

/** Offset (ms) de uma IANA timezone num dado instante (tz - UTC). */
function offsetTimeZoneMs(timeZone: string, instante: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instante).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const comoUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return comoUtc - instante.getTime();
}

/**
 * Converte um horário LOCAL de uma sede (data "YYYY-MM-DD" + hora "HH:MM" + IANA
 * timezone) pro Date em UTC. Tz-aware com DST (usa Intl, nunca offset fixo) —
 * a FIFA mostra horário local da sede e nós guardamos kickoff em UTC.
 *
 * Ex: 16:00 em America/Los_Angeles (PDT, verão) → 23:00 UTC.
 */
export function horaLocalSedeParaUtc(dataISO: string, hora: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO.trim());
  const h = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m || !h) {
    throw new Error(`Data/hora inválida: "${dataISO}" "${hora}" (esperado YYYY-MM-DD e HH:MM)`);
  }
  const [, y, mo, d] = m;
  const [, hh, mi] = h;
  // Wall-clock interpretado como UTC, depois ajustado pelo offset da tz naquele
  // instante (1 passo de correção cobre fronteiras de DST — irrelevante em jun/jul).
  let palpite = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi));
  const off1 = offsetTimeZoneMs(timeZone, new Date(palpite));
  palpite -= off1;
  const off2 = offsetTimeZoneMs(timeZone, new Date(palpite));
  if (off2 !== off1) palpite += off1 - off2;
  return new Date(palpite);
}
