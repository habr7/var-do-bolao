// Vocabulario boleiro para respostas do bot

const CELEBRACOES = [
  '🔥 Subiu no ranking!',
  '⚽ Jogou bonito!',
  '🏆 Craque demais!',
  '💪 Tá voando!',
  '🎯 Acertou na mosca!',
  '👏 Show de bola!',
];

const LAMENTOS = [
  '😬 Pisou na bola nessa rodada...',
  '😅 Não foi dessa vez, craque!',
  '💀 VAR não perdoa!',
  '🫣 Palpite errado, mas segue o jogo!',
  '📉 Escorregou nessa...',
];

const CONFIRMACOES = [
  '✅ Palpite registrado!',
  '📺 VAR confirmou: palpite validado!',
  '✅ Anotado! Boa sorte, craque!',
  '👍 Registrado com sucesso!',
];

const LEMBRETES = [
  '⏰ Bora palpitar! A rodada fecha logo!',
  '🔔 Falta pouco pra fechar! Registra teu palpite!',
  '⚠️ Última chamada pros palpites!',
  '📢 Não esquece de palpitar, craque!',
];

function random<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function celebracao(): string {
  return random(CELEBRACOES);
}

export function lamento(): string {
  return random(LAMENTOS);
}

export function confirmacao(): string {
  return random(CONFIRMACOES);
}

export function lembrete(): string {
  return random(LEMBRETES);
}

export function medalha(posicao: number): string {
  switch (posicao) {
    case 1: return '🥇';
    case 2: return '🥈';
    case 3: return '🥉';
    default: return `${posicao}.`;
  }
}

export function resultadoEmoji(pontosObtidos: number): string {
  if (pontosObtidos === 10) return '🎯';
  if (pontosObtidos >= 7) return '🔥';
  if (pontosObtidos >= 5) return '👍';
  if (pontosObtidos >= 3) return '😐';
  return '❌';
}
