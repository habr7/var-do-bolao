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

const BONS_DIAS = [
  '☀️ Bom dia, boleiros e boleiras!',
  '🌅 Bom dia pra galera do bolão!',
  '⚽ E aí, craques! Bom dia!',
  '🔆 Bom dia, time! Bola vai rolar hoje!',
  '🥐 Bom dia! Café passado e bola no centro do gramado!',
  '🌞 Salve, boleiros! Bom dia!',
];

const SAUDACOES_GENERICAS = [
  '👋 Opa, fala comigo!',
  '⚽ E aí, craque?',
  '🏟️ Salve, boleiro!',
  '👊 Tô aqui, manda ver!',
];

const NAO_ENTENDI = [
  '🤔 Não peguei essa, craque.',
  '🫣 Hum, não entendi muito bem.',
  '❓ Não captei o que você quis dizer.',
  '🤷 Essa eu não saquei direito.',
];

const CHAMADAS_PALPITE = [
  '⚽ Bora palpitar!',
  '🎯 Hora dos palpites!',
  '📝 Manda os palpites pra hoje!',
  '🔥 Vamos lá, palpita aí!',
];

// v3.24.0 — abertura da revelação de palpites quando o jogo começa.
const REVELACOES_PALPITE = [
  '🎙️ A bola vai rolar — hora de abrir o jogo dos palpites! 👀',
  '🔓 Apito inicial! Palpites travados, olha o que a galera cravou:',
  '👀 Jogo começou! Bora ver o palpite de todo mundo do bolão:',
  '🍿 Começou! Hora de ver quem foi corajoso no palpite:',
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

export function bomDia(): string {
  return random(BONS_DIAS);
}

export function saudacao(): string {
  return random(SAUDACOES_GENERICAS);
}

export function naoEntendi(): string {
  return random(NAO_ENTENDI);
}

export function chamadaPalpite(): string {
  return random(CHAMADAS_PALPITE);
}

export function chamadaRevelacaoPalpites(): string {
  return random(REVELACOES_PALPITE);
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
