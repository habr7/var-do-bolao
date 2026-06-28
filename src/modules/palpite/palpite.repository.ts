import { prisma } from '../../config/database.js';

export async function getOrCreatePalpite(usuarioId: string, rodadaId: string) {
  const existente = await prisma.palpite.findUnique({
    where: { usuarioId_rodadaId: { usuarioId, rodadaId } },
    include: { jogos: { include: { jogo: true } } },
  });

  if (existente) return existente;

  return prisma.palpite.create({
    data: { usuarioId, rodadaId },
    include: { jogos: { include: { jogo: true } } },
  });
}

export async function registrarPalpiteJogo(
  palpiteId: string,
  jogoId: string,
  golsCasa: number,
  golsVisitante: number,
) {
  // Mata-mata: placar DECISIVO não tem "quem passa" (é inferido do vencedor).
  // Ao reescrever um palpite que ANTES era empate (com classificadoPalpite
  // cravado) e agora é decisivo, zera o campo — senão fica órfão e o display
  // mostra "você acha que X passa" num jogo que não é mais empate.
  const empate = golsCasa === golsVisitante;
  return prisma.palpiteJogo.upsert({
    where: { palpiteId_jogoId: { palpiteId, jogoId } },
    create: { palpiteId, jogoId, golsCasa, golsVisitante },
    update: { golsCasa, golsVisitante, ...(empate ? {} : { classificadoPalpite: null }) },
  });
}

export async function buscarPalpitesUsuarioRodada(usuarioId: string, rodadaId: string) {
  return prisma.palpite.findUnique({
    where: { usuarioId_rodadaId: { usuarioId, rodadaId } },
    include: {
      jogos: {
        include: { jogo: true },
        orderBy: { jogo: { dataHora: 'asc' } },
      },
    },
  });
}

export async function buscarPalpitesDaRodada(rodadaId: string) {
  return prisma.palpite.findMany({
    where: { rodadaId },
    include: {
      usuario: true,
      jogos: { include: { jogo: true } },
    },
  });
}

export async function atualizarPontuacaoPalpiteJogo(
  palpiteJogoId: string,
  pontosObtidos: number,
  bonusObtido = 0,
) {
  return prisma.palpiteJogo.update({
    where: { id: palpiteJogoId },
    data: { pontosObtidos, bonusObtido },
  });
}

export async function atualizarPontuacaoPalpite(palpiteId: string, pontuacao: number) {
  return prisma.palpite.update({
    where: { id: palpiteId },
    data: { pontuacao, calculado: true },
  });
}
