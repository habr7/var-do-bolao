/**
 * QA matrix — valida o ROTEAMENTO (Camada 1 regex) das perguntas do brief.
 * "*" = aceitável cair em TEXTO_LIVRE (a rede LLM — Camada 2/3 — cobre, e o
 * importante é NÃO virar um intent ERRADO que bloqueie o fallback).
 *
 * Casos que dependem de FSM/estado/DB (empate→quem passa, classificado,
 * pontuação) NÃO são testáveis aqui — verificados por código/sim/test.
 */
import { parseIntencao } from '../src/whatsapp/message.parser.js';

const ANY_LLM = '*';
type Caso = [id: string, texto: string, aceitos: string[]];

const casos: Caso[] = [
  // ===== A. Regras e dúvidas do mata-mata =====
  ['A1', 'regras', ['REGRAS']],
  ['A2', 'regras do mata mata', ['REGRAS']],
  ['A3', 'mata mata', ['REGRAS', 'INFO_O_QUE_MUDA', ANY_LLM]],
  ['A4', 'penalti conta?', ['INFO_PENALTI']],
  ['A5', 'penalti vale ponto?', ['INFO_PENALTI']],
  ['A6', 'os penaltis contam no placar', ['INFO_PENALTI']],
  ['A7', 'prorrogacao conta?', ['INFO_PRORROGACAO']],
  ['A8', 'e se for pra prorrogacao?', ['INFO_PRORROGACAO']],
  ['A9', 'o placar vale ate quando agora', ['INFO_PRORROGACAO', 'INFO_O_QUE_MUDA', ANY_LLM]],
  ['A10', 'e se empatar?', ['INFO_EMPATE_MATAMATA']],
  ['A11', 'como faco se eu achar que vai dar empate', ['INFO_EMPATE_MATAMATA']],
  ['A12', 'se der empate como pontua', ['INFO_EMPATE_MATAMATA', 'INFO_BONUS_CLASSIFICADO']],
  ['A13', 'os pontos aumentaram?', ['INFO_PONTOS_MATAMATA']],
  ['A14a', 'quanto vale agora', ['INFO_PONTOS_MATAMATA']],
  ['A14b', 'quanto vale cravar na final', ['INFO_PONTOS_MATAMATA']],
  ['A15', 'aumentou a pontuacao no mata mata?', ['INFO_PONTOS_MATAMATA']],
  ['A16', 'o que e esse bonus de classificado', ['INFO_BONUS_CLASSIFICADO']],
  ['A17', 'como eu ganho o bonus', ['INFO_BONUS_CLASSIFICADO']],
  ['A18', 'se eu cravar o empate e errar quem passa eu perco meus pontos?', ['INFO_CRAVA_EMPATE']],
  ['A19', 'errei quem passou mas acertei o placar, perco tudo?', ['INFO_CRAVA_EMPATE']],
  ['A20', 'meus pontos da fase de grupos contam ainda?', ['INFO_RANKING_CONTINUA']],
  ['A21a', 'o ranking zerou?', ['INFO_RANKING_CONTINUA']],
  ['A21b', 'comeca do zero agora?', ['INFO_RANKING_CONTINUA']],
  ['A22', 'o que muda agora no mata mata', ['INFO_O_QUE_MUDA']],
  ['A23', 'to perdido, explica o que mudou', ['INFO_O_QUE_MUDA', 'ACOLHIMENTO_NOVATO', ANY_LLM]],
  ['A24', 'tem disputa de terceiro lugar?', ['REGRAS', 'INFO_O_QUE_MUDA', ANY_LLM]],
  ['A25', 'como funciona o mata mata', ['REGRAS', 'INFO_O_QUE_MUDA', ANY_LLM]],

  // ===== B. Fazer palpite no mata-mata (detecção PALPITE_INLINE) =====
  ['B26', 'Brasil 2x1 Japao', ['PALPITE_INLINE']],
  ['B27', 'Brasil 1x1 Japao', ['PALPITE_INLINE']],
  ['B28', 'Franca 0x0 Argentina', ['PALPITE_INLINE']],
  ['B29', '2x1 pro brasil', ['PALPITE_INLINE', ANY_LLM]],
  ['B31', 'brasil perde de 2 a 1', ['PALPITE_INLINE', ANY_LLM]],
  ['B34', 'Brasil 20x0 Japao', ['PALPITE_INLINE']],
  ['B35', 'corrigir palpite', ['EDITAR_PALPITE']],
  ['B36', 'apagar palpite', ['APAGAR_PALPITE']],

  // ===== C. Responder "quem se classifica" — só as que são intent em IDLE =====
  ['C44', 'cancelar', ['CANCELAR']],
  ['C45', 'ranking', ['RANKING']],

  // ===== D. Adversário, horário e chave =====
  ['D46', 'quem o brasil enfrenta', ['ADVERSARIO_TIME']],
  ['D47', 'adversario do brasil', ['ADVERSARIO_TIME']],
  ['D48', 'o brasil joga contra quem', ['ADVERSARIO_TIME']],
  ['D49', 'quem a argentina pega nas quartas', ['ADVERSARIO_TIME']],
  ['D50', 'que horas joga o brasil', ['HORARIO_JOGO']],
  ['D51', 'quando é o jogo da franca', ['HORARIO_JOGO']],
  ['D52', 'horario dos jogos de hoje', ['JOGOS_HOJE', 'HORARIO_JOGO', ANY_LLM]],
  ['D53a', 'quero ver a chave', ['VER_CHAVE']],
  ['D53b', 'mostra o chaveamento', ['VER_CHAVE']],
  ['D54', 'como ta o bracket', ['VER_CHAVE']],
  ['D55a', 'quando começa o mata mata', ['QUANDO_COMECA', 'PERGUNTA_GERAL_FUTEBOL']],
  ['D55b', 'quando sao os 16 avos', ['QUANDO_COMECA', 'PERGUNTA_GERAL_FUTEBOL']],
  ['D56', 'quem ja se classificou', ['VER_CHAVE']],

  // ===== E. Consultas — regressão =====
  ['E57', 'ranking', ['RANKING']],
  ['E58a', 'tabela', ['RANKING']],
  ['E58b', 'quem ta na frente', ['RANKING']],
  ['E59', 'meus pontos', ['MEUS_PONTOS']],
  ['E60', 'meus palpites', ['MEU_PALPITE']],
  ['E61a', 'proximos jogos', ['PROXIMOS_JOGOS']],
  ['E61b', 'bora palpitar', ['PROXIMOS_JOGOS']],
  ['E62', 'jogos de hoje', ['JOGOS_HOJE']],
  ['E63', 'meus boloes', ['MEUS_BOLOES']],
  ['E64', 'como to indo nos boloes', ['RESUMO_BOLOES']],
  ['E65', 'quem participa', ['QUEM_PARTICIPA']],
  ['E66', 'meu desempenho geral', ['RESUMO_BOLOES']],

  // ===== F. Criar / entrar / convidar — regressão =====
  ['F67', 'criar bolao', ['CRIAR_BOLAO']],
  ['F68', 'entrar em bolao', ['ENTRAR_BOLAO']],
  ['F71', 'como convido', ['COMO_CONVIDAR']],
  ['F72', 'quero o convite', ['COMO_CONVIDAR', ANY_LLM]],
  ['F73', 'qual a senha', ['INFO_SENHA']],

  // ===== G. Admin — regressão =====
  ['G74', 'pendentes', ['PENDENTES']],
  ['G76', 'recusar Fulano', ['REMOVER_PARTICIPANTE', 'RECUSAR', ANY_LLM]],
  ['G78', 'renomear bolao', ['RENOMEAR_BOLAO']],
  ['G79', 'remover Fulano do bolao', ['REMOVER_PARTICIPANTE']],
  ['G80', 'excluir bolao', ['EXCLUIR_BOLAO']],

  // ===== H. Sair de fluxo / borda =====
  ['H81', 'cancelar', ['CANCELAR']],
  ['H82a', 'sair', ['CANCELAR', 'SAIR_BOLAO']],
  ['H82b', 'esquece', ['CANCELAR']],
  ['H83', 'menu', ['MENU']],
  ['H85a', '⚽', ['SAUDACAO', 'TEXTO_LIVRE', ANY_LLM]],
  ['H85b', 'kkkk', ['RISADA']],

  // ===== I. Coloquial, gíria e typo =====
  ['I86a', 'salve', ['SAUDACAO']],
  ['I86b', 'e ai craque', ['SAUDACAO', ANY_LLM]],
  ['I87', 'qnd começa o mata mata', ['QUANDO_COMECA', 'PERGUNTA_GERAL_FUTEBOL', ANY_LLM]],
  ['I88', 'qto vale agr', ['INFO_PONTOS_MATAMATA', ANY_LLM]],
  ['I89', 'penaute conta?', [ANY_LLM]],
  ['I90', 'prorrogaçao conta', ['INFO_PRORROGACAO']],
  ['I91', 'quem q o brasil pega', ['ADVERSARIO_TIME']],
  ['I92', 'vai pra penalti e o brasil passa', ['INFO_PENALTI', 'INFO_EMPATE_MATAMATA', ANY_LLM]],
  ['I93', 'to achando q vai 0 a 0', [ANY_LLM]],
  ['I94', 'bixo eu nao entendi essa regra nova', ['INFO_O_QUE_MUDA', 'REGRAS', ANY_LLM]],
  ['I95', 'e os penal?', ['INFO_PENALTI', ANY_LLM]],
  ['I96', 'mata mata é mt diferente?', ['INFO_O_QUE_MUDA', 'REGRAS', ANY_LLM]],

  // ===== J. Não pode disparar nada estranho =====
  ['J97', 'obrigado', ['AGRADECIMENTO']],
  ['J98', 'boa noite', ['SAUDACAO']],
  ['J99', 'que jogo foi esse hein', [ANY_LLM, 'PERGUNTA_GERAL_FUTEBOL', 'DESABAFO_RANKING']],
  ['J100', 'o juiz roubou', [ANY_LLM, 'PERGUNTA_GERAL_FUTEBOL']],
  ['J101', '2026', [ANY_LLM]],
  ['J102', 'vamo brasil', [ANY_LLM, 'SAUDACAO', 'PERGUNTA_GERAL_FUTEBOL']],
];

// Casos J/I que NUNCA podem virar PALPITE_INLINE (falso positivo grave)
const NAO_PODE_SER: Record<string, string[]> = {
  J99: ['PALPITE_INLINE'],
  J100: ['PALPITE_INLINE'],
  J101: ['PALPITE_INLINE'],
  J102: ['PALPITE_INLINE'],
  I93: ['PALPITE_INLINE'], // "to achando q vai 0 a 0" sem times → não é palpite válido
};

let falhas = 0;
for (const [id, texto, aceitos] of casos) {
  const { intencao } = parseIntencao(texto);
  const aceitaLLM = aceitos.includes(ANY_LLM);
  const ok =
    aceitos.includes(intencao) || (aceitaLLM && intencao === 'TEXTO_LIVRE');
  const proibido = NAO_PODE_SER[id]?.includes(intencao);
  if (!ok || proibido) {
    falhas++;
    const tag = proibido ? '⛔ PROIBIDO' : '❌';
    console.log(`${tag} ${id} "${texto}" → ${intencao}  (esperado: ${aceitos.join(' | ')})`);
  } else {
    console.log(`✅ ${id} "${texto}" → ${intencao}`);
  }
}
console.log(`\n${casos.length - falhas}/${casos.length} ok, ${falhas} falha(s)`);
process.exit(falhas > 0 ? 1 : 0);
