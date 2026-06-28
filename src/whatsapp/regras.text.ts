/**
 * Textos de boas-vindas e regras do bolão.
 *
 * Os números (10/7/5/3/0) sao a config padrao em
 * src/modules/ranking/ranking.types.ts (PONTUACAO_PADRAO).
 * Se a pontuacao mudar la, atualizar aqui tambem.
 *
 * Usado em 2 lugares:
 *   1. Mensagem de aprovacao (quando admin aprova o participante)
 *   2. Intent REGRAS — sempre que o usuario pedir
 */

/**
 * Bloco "puro" das regras, sem cabecalho de boas-vindas. Reusavel.
 */
export function regrasTexto(): string {
  return (
    '━━━━━━━━━━━━━━━━━━━\n' +
    '🎯 *COMO PONTUAR*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    '🎯 *Placar exato* → 10 pts\n' +
    '   _Você 2x1, deu 2x1_ ✅\n\n' +
    '🥇 *Resultado + gols de um time* → 7 pts\n' +
    '   _Você 2x0, deu 2x1 (acertou o vencedor + gols dele)_ ✅\n' +
    '   _Você 3x1, deu 2x1 (acertou o vencedor + gols do perdedor)_ ✅\n\n' +
    '✅ *Só o resultado (vencedor ou empate)* → 5 pts\n' +
    '   _Você 2x0, deu 4x1_ ✅\n' +
    '   _Você 1x1, deu 2x2_ ✅\n\n' +
    '📊 *Só os gols de um time (resultado errado)* → 3 pts\n' +
    '   _Você 2x1, deu 0x2_ ✅\n\n' +
    '❌ *Errou tudo* → 0 pts\n\n' +
    '⚠️ _Os critérios não acumulam — vale sempre o melhor acerto._\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '⏰ *PRAZO DOS PALPITES*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'Cada palpite trava quando *o jogo dele começa* (kickoff da hora marcada).\n' +
    'Cada jogo tem seu próprio prazo — depois de um jogo começar, você ainda pode palpitar nos próximos do mesmo dia.\n' +
    'Pode editar quantas vezes quiser até o kickoff. 🔄\n' +
    'Horários em *fuso de Brasília* 🇧🇷\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '💬 *COMO MANDAR PALPITE*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'Fala comigo aqui no privado, do jeito que quiser:\n\n' +
    '_"Brasil 2x1 Argentina"_\n' +
    '_"acho que vai 3 a 0 pro Brasil"_\n' +
    '_"BRA 2 ARG 1"_\n' +
    '_"Brasil dois a um Argentina"_\n\n' +
    'Eu entendo tudo! 🤖\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '🏅 *RANKING*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'O ranking ordena pela *pontuação total*.\n' +
    'Em caso de empate, vence quem registrou mais palpites e/ou entrou primeiro no bolão.\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '📅 *QUANDO QUISER, É SÓ PEDIR*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    '• *próximos jogos* — jogos abertos pra palpitar ⚽\n' +
    '• *meus palpites* — palpites já dados 📋\n' +
    '• *meus pontos* — sua pontuação 📊\n' +
    '• *ranking* — quem tá na frente 🏆\n' +
    '• *regras* — voltar aqui 📖'
  );
}

import type { FaseTorneio } from '@prisma/client';
import { TABELA_PONTOS, BONUS_CLASSIFICADO } from '../modules/ranking/ranking.types.js';

/**
 * Regras COMPLETAS (grupos) — alias semântico de regrasTexto(), usado pelo
 * submenu de regras ("completas" vs "só do mata-mata").
 */
export function regrasCompletas(): string {
  return regrasTexto();
}

/**
 * Regras do MATA-MATA. Os números por fase saem de TABELA_PONTOS/
 * BONUS_CLASSIFICADO (fonte única) — não há valores soltos a desatualizar.
 * Destaca a regra universal: placar vale 90'+prorrogação, pênalti fora.
 */
export function regrasMataMata(): string {
  const linha = (label: string, fase: FaseTorneio) =>
    `• *${label}*: ${TABELA_PONTOS[fase].placarExato} pts no placar exato + ${BONUS_CLASSIFICADO[fase]} de bônus`;

  return (
    '🏆 *REGRAS DO MATA-MATA* 🏆\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '⚽ *PLACAR VALE ATÉ A PRORROGAÇÃO*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'O placar do bolão é o resultado ao *fim da prorrogação* (90min + 30 da prorrogação).\n' +
    '*Pênaltis NÃO entram no placar* — só decidem quem avança.\n' +
    '_Ex: 1x1 que vai pra pênaltis vale 1x1. 1x1 que vira 2x1 na prorrogação vale 2x1._\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '🎯 *BÔNUS DE QUEM PASSA*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'Acertar quem se classifica dá um bônus EXTRA (somado ao placar):\n' +
    '• Se você crava um *vencedor*, já conta que ele passa — não pergunto nada.\n' +
    '• Se você crava *empate*, eu pergunto quem você acha que passa nos pênaltis.\n' +
    '  _(ou já diga na mesma mensagem: "Brasil 1x1 Japão e o Brasil passa" — confirmo no preview)._\n' +
    '*Errar quem passa NUNCA tira o ponto do placar* — a crava fica garantida. 🔒\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '📈 *PONTOS SOBEM POR FASE*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    linha('16-avos', 'R32') + '\n' +
    linha('Oitavas', 'OITAVAS') + '\n' +
    linha('Quartas', 'QUARTAS') + '\n' +
    linha('Semifinal', 'SEMI') + '\n' +
    linha('3º lugar', 'TERCEIRO') + '\n' +
    linha('Final', 'FINAL') + '\n\n' +
    '_As outras faixas (resultado, gols de um time) sobem na mesma proporção._\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '🧮 *EXEMPLOS (16-avos)*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    '_Você 2x0, deu 2x0 e a casa passou_ → 10 + 3 = *13* 🎯\n' +
    '_Você 1x1 (passa a casa), deu 1x1 nos pênaltis e a casa passou_ → 10 + 3 = *13*\n' +
    '_Você 1x1 (passa o visitante), deu 1x1 e a casa passou_ → 10 + 0 = *10* _(crava garantida!)_\n' +
    '_Você 3x1, deu 2x0 e a casa passou_ → 5 + 3 = *8*\n\n' +
    '━━━━━━━━━━━━━━━━━━━\n' +
    '🏅 *RANKING SEGUE CUMULATIVO*\n' +
    '━━━━━━━━━━━━━━━━━━━\n\n' +
    'Seus pontos da fase de grupos *continuam valendo*. O ranking não zera — é grupos + mata-mata somados. 📊'
  );
}

/**
 * Mensagem completa de boas-vindas quando o admin aprova o participante.
 */
export function boasVindasComRegras(nomeBolao: string): string {
  return (
    '⚽ *BEM-VINDO AO VAR DO BOLÃO!* ⚽\n\n' +
    `Você foi aprovado no bolão *${nomeBolao}*! 🏆\n\n` +
    'Antes de mandar seus palpites, dá uma olhada nas regras:\n\n' +
    regrasTexto() +
    '\n\n━━━━━━━━━━━━━━━━━━━\n\n' +
    'Bora começar? Manda seu primeiro palpite aí! 🚀'
  );
}
