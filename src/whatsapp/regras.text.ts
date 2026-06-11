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
