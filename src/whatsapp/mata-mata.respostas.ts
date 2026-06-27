/**
 * Respostas curtas e canônicas pras dúvidas frequentes do mata-mata (Copa
 * 2026). Regex-first → resposta fixa (custo zero de LLM). TODAS destacam, onde
 * cabe, que o placar agora vale 90'+prorrogação. Os valores por fase vêm de
 * TABELA_PONTOS/BONUS_CLASSIFICADO (fonte única — sem números soltos).
 */
import { TABELA_PONTOS, BONUS_CLASSIFICADO } from '../modules/ranking/ranking.types.js';

export function infoProrrogacao(): string {
  return (
    '⏱️ *Prorrogação conta sim!*\n\n' +
    'No mata-mata o placar do bolão vale o resultado ao *fim da prorrogação* ' +
    '(90min + 30 da prorrogação).\n' +
    '_Ex: 1x1 que vira 2x1 na prorrogação vale 2x1._'
  );
}

export function infoPenalti(): string {
  return (
    '🥅 *Pênalti NÃO conta pro placar.*\n\n' +
    'A disputa de pênaltis só decide *quem avança* — não entra no placar do bolão.\n' +
    'O placar vale até o fim da prorrogação.\n' +
    '_Ex: 1x1 que vai pra pênaltis vale 1x1 (e quem venceu os pênaltis é quem passa)._'
  );
}

export function infoEmpateMataMata(): string {
  return (
    '🤝 *E se empatar?*\n\n' +
    'A partir dos *16-avos*, se você cravar um empate, eu pergunto quem você acha ' +
    'que se classifica nos pênaltis. Acertar quem passa dá um *bônus* extra.\n' +
    'Se você cravar um vencedor, já conta que ele passa — não pergunto nada.\n\n' +
    'Lembrando: o placar vale até o fim da *prorrogação* (pênalti não entra no placar).'
  );
}

export function infoPontosMataMata(): string {
  const linha = (label: string, fase: keyof typeof TABELA_PONTOS) =>
    `• *${label}*: ${TABELA_PONTOS[fase].placarExato} pts (placar exato) + ${BONUS_CLASSIFICADO[fase]} de bônus`;
  return (
    '📈 *Os pontos sobem por fase no mata-mata:*\n\n' +
    linha('16-avos', 'R32') + '\n' +
    linha('Oitavas', 'OITAVAS') + '\n' +
    linha('Quartas', 'QUARTAS') + '\n' +
    linha('Semifinal', 'SEMI') + '\n' +
    linha('Final', 'FINAL') + '\n\n' +
    '_As outras faixas (resultado, gols de um time) sobem na mesma proporção._\n' +
    '🏆 *Por isso dá pra passar de 10 num jogo só* — o placar vale mais por fase E ainda soma o bônus de classificado. O placar conta até o fim da prorrogação (pênalti fora).'
  );
}

export function infoBonusClassificado(): string {
  return (
    '🎯 *O bônus de classificado* é um ponto EXTRA por acertar quem avança:\n\n' +
    `• 16-avos/oitavas: +${BONUS_CLASSIFICADO.R32} · quartas: +${BONUS_CLASSIFICADO.QUARTAS} · ` +
    `semi: +${BONUS_CLASSIFICADO.SEMI} · final: +${BONUS_CLASSIFICADO.FINAL}\n` +
    '• Se você crava um *vencedor*, o classificado é ele (não pergunto nada).\n' +
    '• Se você crava *empate*, eu pergunto quem passa nos pênaltis.\n\n' +
    'O bônus é somado ao placar — *errar quem passa nunca tira o ponto do placar*.'
  );
}

export function infoCravaEmpate(): string {
  return (
    '🔒 *Não! A sua crava fica garantida.*\n\n' +
    'Errar quem se classifica só faz você *não levar o bônus* — o ponto do placar ' +
    'continua valendo normalmente. Os dois são separados: placar de um lado, bônus do outro.'
  );
}

export function infoRankingContinua(): string {
  return (
    '🏅 *O ranking NÃO zera!*\n\n' +
    'Seus pontos da fase de grupos *continuam valendo*. O ranking é cumulativo: ' +
    'grupos + mata-mata somados, do começo ao fim do torneio.'
  );
}

export function infoOQueMuda(): string {
  return (
    '🆕 *O que muda no mata-mata:*\n\n' +
    '1️⃣ O placar agora vale até o fim da *prorrogação* (pênalti não entra).\n' +
    '2️⃣ Se você cravar *empate*, eu pergunto quem passa nos pênaltis (dá *bônus* acertar).\n' +
    '3️⃣ Os pontos *sobem por fase* (a final vale mais que os 16-avos).\n' +
    '4️⃣ O ranking *continua cumulativo* — seus pontos dos grupos seguem valendo.'
  );
}
