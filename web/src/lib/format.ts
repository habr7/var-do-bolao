/** Helpers de formatacao PT-BR */

const tz = "America/Sao_Paulo";

export function formatDataHora(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("pt-BR", {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatData(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("pt-BR", { timeZone: tz });
}

export function formatHora(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("pt-BR", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relativeTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMin = (d.getTime() - Date.now()) / 60_000;
  const future = diffMin > 0;
  const abs = Math.abs(diffMin);
  if (abs < 1) return future ? "agora" : "agora mesmo";
  if (abs < 60) return future ? `em ${Math.round(abs)}min` : `há ${Math.round(abs)}min`;
  const hours = abs / 60;
  if (hours < 24) return future ? `em ${Math.round(hours)}h` : `há ${Math.round(hours)}h`;
  const days = hours / 24;
  return future ? `em ${Math.round(days)}d` : `há ${Math.round(days)}d`;
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return n === 1 ? singular : pluralForm;
}
