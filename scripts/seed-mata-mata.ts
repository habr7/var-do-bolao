/**
 * Seed do MATA-MATA da Copa 2026 (16-avos → final) pra TODOS os bolões ATIVOS.
 *
 * IMPORTANTE — os 16 confrontos reais do R32 chegam DEPOIS (à noite). Hoje o
 * script já fica pronto e é testável com dados de exemplo. Pra rodar de verdade,
 * o dono só PREENCHE o bloco DATA_R32 abaixo (uma linha por jogo) — SEM mexer em
 * código. A ligação da chave (proximoJogoApiId/proximoSlot) vem de
 * bracket-2026.ts; o dono NÃO digita isso.
 *
 * Formato de cada linha (16 linhas, jogos 73–88):
 *   num | TimeCasa x TimeVisitante | YYYY-MM-DD | HH:MM | Sede
 *   73 | África do Sul x Canadá | 2026-06-28 | 16:00 | Los Angeles
 *
 * Use "?" nos times pra deixar a linha como NÃO-preenchida (portão fechado).
 * O horário é o LOCAL DA SEDE (a FIFA mostra assim); o script converte pra UTC.
 *
 * Uso:
 *   npx tsx scripts/seed-mata-mata.ts --dry-run   # valida transcrição/fuso, NÃO grava
 *   npx tsx scripts/seed-mata-mata.ts             # grava em todos os bolões ATIVOS
 *
 * Garantias:
 *   - Idempotente: não duplica jogo (chave [rodadaId, apiJogoId]); re-rodável
 *     (corrige um jogo no bloco e roda de novo).
 *   - Transacional por bolão (tudo-ou-nada por bolão).
 *   - PORTÃO: só marca a rodada R32 como ABERTA quando os 16 jogos tiverem DOIS
 *     times reais. Senão fica FECHADA (palpite não abre com placeholder).
 *   - Migration-safe: oitavas→final entram com times placeholder ("Vencedor 73")
 *     + apiJogoId + ligações da chave já gravados (o advance-bracket preenche).
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { PrismaClient } from '@prisma/client';
import { horaLocalSedeParaUtc } from '../src/utils/datetime.js';
import {
  JOGOS_MATA_MATA,
  FASES_MATA_MATA,
  BRACKET_2026,
  apiIdMataMata,
  ianaDaSede,
  rotuloAlimentador,
  faseLabel,
} from '../src/data/bracket-2026.js';
import type { FaseTorneio } from '@prisma/client';

// ============================================================
// BLOCO DE DADOS — o dono PREENCHE aqui (16 linhas, jogos 73–88).
// Hoje vai com "?" (portão fechado). À noite, troca pelos confrontos reais.
// ============================================================
const DATA_R32: string[] = [
  '73 | ? x ? | 2026-06-28 | 16:00 | Los Angeles',
  '74 | ? x ? | 2026-06-28 | 13:00 | Houston',
  '75 | ? x ? | 2026-06-29 | 13:00 | Boston',
  '76 | ? x ? | 2026-06-29 | 16:00 | Mexico City',
  '77 | ? x ? | 2026-06-29 | 19:00 | Dallas',
  '78 | ? x ? | 2026-06-30 | 16:00 | Atlanta',
  '79 | ? x ? | 2026-06-30 | 19:00 | Los Angeles',
  '80 | ? x ? | 2026-07-01 | 13:00 | Vancouver',
  '81 | ? x ? | 2026-07-01 | 16:00 | Seattle',
  '82 | ? x ? | 2026-06-30 | 13:00 | Monterrey',
  '83 | ? x ? | 2026-07-02 | 16:00 | New York/New Jersey (East Rutherford)',
  '84 | ? x ? | 2026-07-02 | 13:00 | Philadelphia',
  '85 | ? x ? | 2026-07-01 | 19:00 | Kansas City',
  '86 | ? x ? | 2026-07-03 | 16:00 | Miami',
  '87 | ? x ? | 2026-07-03 | 13:00 | San Francisco (Santa Clara)',
  '88 | ? x ? | 2026-07-02 | 19:00 | Toronto',
];

// Datas placeholder por fase (oitavas→final). Aproximação do calendário FIFA
// 2026 — só pra ORDENAR a chave; o kickoff real entra quando a rodada abrir.
// CONFERIR FIFA antes de cada fase.
const DATA_PLACEHOLDER_POR_FASE: Record<Exclude<FaseTorneio, 'GRUPOS' | 'R32'>, string> = {
  OITAVAS: '2026-07-05T20:00:00.000Z',
  QUARTAS: '2026-07-10T20:00:00.000Z',
  SEMI: '2026-07-14T20:00:00.000Z',
  TERCEIRO: '2026-07-18T20:00:00.000Z',
  FINAL: '2026-07-19T19:00:00.000Z',
};

const PLACEHOLDER_TIME = 'A definir';

interface ConfrontoR32 {
  numero: number;
  apiJogoId: string;
  timeCasa: string;
  timeVisitante: string;
  sede: string;
  iana: string;
  dataHoraUtc: Date;
  timesReais: boolean;
}

/** Um time é "real" se não for vazio, "?", ou placeholder ("A definir"). */
export function ehTimeReal(nome: string): boolean {
  const n = nome.trim();
  if (n === '' || n === '?') return false;
  return !/^(a definir|tbd|time [a-z0-9]+|sele[çc][ãa]o [a-z0-9]+|vencedor \d+|perdedor \d+)$/i.test(n);
}

/**
 * Faz o parse + validação do bloco DATA_R32. Lança erro com TODOS os problemas
 * de transcrição de uma vez (pra o dono corrigir tudo num passe).
 */
export function parsearR32(linhas: string[]): ConfrontoR32[] {
  const erros: string[] = [];
  const confrontos: ConfrontoR32[] = [];
  const numerosVistos = new Set<number>();

  linhas.forEach((linha, i) => {
    const limpa = linha.trim();
    if (limpa === '' || limpa.startsWith('#')) return;
    const partes = limpa.split('|').map((p) => p.trim());
    if (partes.length !== 5) {
      erros.push(`Linha ${i + 1}: esperado 5 campos separados por "|", veio ${partes.length}: "${limpa}"`);
      return;
    }
    const [numStr, confronto, data, hora, sede] = partes;
    const numero = Number(numStr);
    if (!Number.isInteger(numero) || numero < 73 || numero > 88) {
      erros.push(`Linha ${i + 1}: número "${numStr}" fora de 73–88.`);
      return;
    }
    if (numerosVistos.has(numero)) erros.push(`Linha ${i + 1}: número ${numero} repetido.`);
    numerosVistos.add(numero);

    const mConf = confronto.split(/\s+x\s+/i);
    if (mConf.length !== 2) {
      erros.push(`Linha ${i + 1}: confronto "${confronto}" deve ser "TimeCasa x TimeVisitante".`);
      return;
    }
    const [timeCasa, timeVisitante] = mConf.map((t) => t.trim());

    const iana = ianaDaSede(sede);
    if (!iana) {
      erros.push(`Linha ${i + 1}: sede "${sede}" não reconhecida (confira o mapa Sede→IANA).`);
      return;
    }

    let dataHoraUtc: Date;
    try {
      dataHoraUtc = horaLocalSedeParaUtc(data, hora, iana);
    } catch (e) {
      erros.push(`Linha ${i + 1}: ${(e as Error).message}`);
      return;
    }

    const timesReais = ehTimeReal(timeCasa) && ehTimeReal(timeVisitante);
    confrontos.push({
      numero,
      apiJogoId: apiIdMataMata(numero),
      timeCasa: ehTimeReal(timeCasa) ? timeCasa : PLACEHOLDER_TIME,
      timeVisitante: ehTimeReal(timeVisitante) ? timeVisitante : PLACEHOLDER_TIME,
      sede,
      iana,
      dataHoraUtc,
      timesReais,
    });
  });

  const faltando = [...Array(16).keys()].map((k) => k + 73).filter((n) => !numerosVistos.has(n));
  if (faltando.length > 0) erros.push(`Faltam os jogos: ${faltando.join(', ')} (precisa dos 16: 73–88).`);

  if (erros.length > 0) {
    throw new Error('Erros na transcrição do R32:\n' + erros.map((e) => `  • ${e}`).join('\n'));
  }
  return confrontos.sort((a, b) => a.numero - b.numero);
}

/** Time placeholder de um slot de oitavas+ ("Vencedor 73") ou PLACEHOLDER_TIME. */
function timePlaceholderSlot(apiJogoId: string, slot: 'CASA' | 'VISITANTE'): string {
  return rotuloAlimentador(apiJogoId, slot) ?? PLACEHOLDER_TIME;
}

/** Semeia (ou atualiza) o mata-mata de UM bolão, transacionalmente. */
async function semearBolao(
  prisma: PrismaClient,
  bolaoId: string,
  confrontos: ConfrontoR32[],
): Promise<{ portaoAberto: boolean }> {
  const portaoAberto = confrontos.length === 16 && confrontos.every((c) => c.timesReais);

  await prisma.$transaction(async (tx) => {
    const existentes = await tx.rodada.findMany({ where: { bolaoId } });
    let proximoNumero = existentes.reduce((max, r) => Math.max(max, r.numero), 0) + 1;

    // 1 rodada por fase de mata-mata (reusa por `fase` se já existir).
    const rodadaIdPorFase = new Map<FaseTorneio, string>();
    for (const fase of FASES_MATA_MATA) {
      const existente = existentes.find((r) => r.fase === fase);
      if (existente) {
        rodadaIdPorFase.set(fase, existente.id);
      } else {
        const dataAbertura = new Date();
        const nova = await tx.rodada.create({
          data: {
            bolaoId,
            numero: proximoNumero++,
            fase,
            // R32 abre só se o portão passou; demais fases o advance-bracket abre.
            status: fase === 'R32' && portaoAberto ? 'ABERTA' : 'FECHADA',
            dataAbertura,
            dataFechamento: fase === 'R32' ? confrontos[0].dataHoraUtc : new Date(DATA_PLACEHOLDER_POR_FASE[fase as Exclude<FaseTorneio, 'GRUPOS' | 'R32'>]),
          },
        });
        rodadaIdPorFase.set(fase, nova.id);
      }
    }

    // R32 sempre reflete o estado atual do portão (re-rodável corrige status).
    const r32Id = rodadaIdPorFase.get('R32')!;
    await tx.rodada.update({
      where: { id: r32Id },
      data: {
        status: portaoAberto ? 'ABERTA' : 'FECHADA',
        dataFechamento: confrontos[0].dataHoraUtc,
      },
    });

    // Jogos de todas as 6 fases (32 jogos).
    for (const desc of JOGOS_MATA_MATA) {
      const rodadaId = rodadaIdPorFase.get(desc.fase)!;
      const avanco = BRACKET_2026[desc.apiJogoId] ?? {};
      const lig = avanco.vencedor;

      let timeCasa: string;
      let timeVisitante: string;
      let dataHora: Date;
      if (desc.fase === 'R32') {
        const c = confrontos.find((x) => x.numero === desc.numero)!;
        timeCasa = c.timeCasa;
        timeVisitante = c.timeVisitante;
        dataHora = c.dataHoraUtc;
      } else {
        timeCasa = timePlaceholderSlot(desc.apiJogoId, 'CASA');
        timeVisitante = timePlaceholderSlot(desc.apiJogoId, 'VISITANTE');
        dataHora = new Date(DATA_PLACEHOLDER_POR_FASE[desc.fase as Exclude<FaseTorneio, 'GRUPOS' | 'R32'>]);
      }

      const jogoExistente = await tx.jogo.findUnique({
        where: { rodadaId_apiJogoId: { rodadaId, apiJogoId: desc.apiJogoId } },
      });

      const dadosChave = {
        fase: desc.fase,
        proximoJogoApiId: lig?.proximoJogoApiId ?? null,
        proximoSlot: lig?.proximoSlot ?? null,
      };

      if (!jogoExistente) {
        await tx.jogo.create({
          data: { rodadaId, apiJogoId: desc.apiJogoId, timeCasa, timeVisitante, dataHora, ...dadosChave },
        });
      } else if (desc.fase === 'R32') {
        // R32 é re-rodável: atualiza times/data do bloco (corrige transcrição).
        await tx.jogo.update({
          where: { id: jogoExistente.id },
          data: { timeCasa, timeVisitante, dataHora, ...dadosChave },
        });
      } else {
        // Oitavas+: só garante as ligações da chave; NÃO sobrescreve times reais
        // que o advance-bracket já tenha preenchido.
        await tx.jogo.update({ where: { id: jogoExistente.id }, data: dadosChave });
      }
    }
  });

  return { portaoAberto };
}

function imprimirResumo(confrontos: ConfrontoR32[]) {
  console.log('\n📋 R32 (16-avos) — confrontos transcritos:');
  for (const c of confrontos) {
    const br = c.dataHoraUtc.toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    const flag = c.timesReais ? '✅' : '⚪';
    console.log(
      `  ${flag} #${c.numero} ${c.timeCasa} x ${c.timeVisitante} — ${br} BRT (${c.sede}, ${c.iana})`,
    );
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // 1) Parse + validação (não toca no banco).
  let confrontos: ConfrontoR32[];
  try {
    confrontos = parsearR32(DATA_R32);
  } catch (e) {
    console.error('❌ ' + (e as Error).message);
    process.exit(1);
  }

  imprimirResumo(confrontos);
  const portaoAberto = confrontos.every((c) => c.timesReais);
  console.log(
    `\n🚪 Portão R32: ${portaoAberto ? 'ABERTO (16 jogos com times reais)' : 'FECHADO (ainda há jogos com placeholder — palpite não abre)'}`,
  );
  console.log('🗺️  Chave: ' + FASES_MATA_MATA.map((f) => faseLabel(f)).join(' → '));

  if (dryRun) {
    console.log('\n🧪 --dry-run: nada gravado. Transcrição e fuso validados.');
    return;
  }

  // 2) Grava em todos os bolões ATIVOS. Import dinâmico do banco SÓ aqui — assim
  // o --dry-run (e os testes) não precisam de DATABASE_URL.
  const { prisma, connectDatabase, disconnectDatabase } = await import('../src/config/database.js');
  await connectDatabase();
  const boloes = await prisma.bolao.findMany({ where: { status: 'ATIVO' }, select: { id: true, nome: true } });
  if (boloes.length === 0) {
    console.log('\nℹ Nenhum bolão ATIVO encontrado. Nada a semear.');
    await disconnectDatabase();
    return;
  }

  console.log(`\n💾 Semeando mata-mata em ${boloes.length} bolão(ões) ativo(s)...`);
  let ok = 0;
  for (const b of boloes) {
    try {
      const { portaoAberto: aberto } = await semearBolao(prisma, b.id, confrontos);
      console.log(`  ✅ ${b.nome} — R32 ${aberto ? 'ABERTA (palpites liberados)' : 'FECHADA (aguardando confrontos reais)'}`);
      ok++;
    } catch (e) {
      console.error(`  ❌ ${b.nome}: ${(e as Error).message}`);
    }
  }
  console.log(`\n✅ Concluído: ${ok}/${boloes.length} bolão(ões) semeado(s).`);
  if (portaoAberto) {
    console.log('🔔 Portão aberto — as rodadas R32 estão ABERTAS. O job de palpite-call (se habilitado) avisa os participantes.');
  }
  await disconnectDatabase();
}

// Só roda main() quando chamado direto (não quando importado em teste).
const invocadoDireto =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invocadoDireto) {
  main().catch((err) => {
    console.error('❌ erro fatal:', err);
    process.exit(1);
  });
}
