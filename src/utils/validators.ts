export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 99;
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function isUserJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net');
}

export function extractPhoneFromJid(jid: string): string {
  return jid.split('@')[0];
}

export function normalizeTeamName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function parseScore(text: string): { golsCasa: number; golsVisitante: number } | null {
  const match = text.match(/(\d+)\s*[xX]\s*(\d+)/);
  if (!match) return null;

  const golsCasa = parseInt(match[1], 10);
  const golsVisitante = parseInt(match[2], 10);

  if (!isValidScore(golsCasa) || !isValidScore(golsVisitante)) return null;

  return { golsCasa, golsVisitante };
}
