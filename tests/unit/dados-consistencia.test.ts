import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { normalizeTeamName } from '../../src/utils/validators.js';
import { getTime } from '../../src/modules/copa-2026/index.js';

/**
 * v3.37.0 — Consistência entre teams.json e fifa-2026-fixtures.json.
 *
 * Bug real (Costa do Marfim x Equador 14/06): o `nome` no teams.json
 * ("Cote d'Ivoire") divergia do nome nos fixtures ("Costa do Marfim").
 * Como o matcher da FIFA faz `fifaCode → teams.json.nome (normalizado) →
 * chave do fixture`, a divergência QUEBRAVA o match e o placar NUNCA
 * atualizava — só nesse jogo. Mesmo problema com "IR Iran" e "Congo DR".
 *
 * Estes testes garantem que TODO nome de time usado nos fixtures resolve
 * no teams.json — se um re-sync reintroduzir a divergência, o build quebra.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'src', 'data');

interface Team { nome: string; nomeIngles?: string; fifaCode: string }
interface Fixture { timeCasa: string; timeVisitante: string; apiJogoId: string }

const teams = (JSON.parse(readFileSync(join(dataDir, 'copa-2026', 'teams.json'), 'utf-8')) as { times: Team[] }).times;
const fixtures = (JSON.parse(readFileSync(join(dataDir, 'fifa-2026-fixtures.json'), 'utf-8')) as { jogos: Fixture[] }).jogos;

describe('consistência teams.json ↔ fixtures (v3.37.0)', () => {
  it('TODO nome de time nos fixtures existe no teams.json (mesmo nome normalizado)', () => {
    const nomesTeams = new Set(teams.map((t) => normalizeTeamName(t.nome)));
    const orfaos = new Set<string>();
    for (const j of fixtures) {
      for (const nome of [j.timeCasa, j.timeVisitante]) {
        if (!nomesTeams.has(normalizeTeamName(nome))) orfaos.add(nome);
      }
    }
    expect([...orfaos], `Times nos fixtures sem nome igual no teams.json (quebra o matcher da FIFA): ${[...orfaos].join(', ')}`).toEqual([]);
  });

  it('o matcher da FIFA (fifaCode → nome → fixture) resolve TODOS os jogos da fase de grupos', () => {
    const code2nome = new Map(teams.filter((t) => t.fifaCode).map((t) => [t.fifaCode.toUpperCase(), normalizeTeamName(t.nome)]));
    const byCodes = new Map(fixtures.map((j) => [`${normalizeTeamName(j.timeCasa)}_${normalizeTeamName(j.timeVisitante)}`, j.apiJogoId]));
    // toda chave de fixture deve ser alcançável a partir de algum par de códigos FIFA
    const nomesValidos = new Set(code2nome.values());
    const inalcancaveis: string[] = [];
    for (const j of fixtures) {
      const c = normalizeTeamName(j.timeCasa);
      const v = normalizeTeamName(j.timeVisitante);
      if (!nomesValidos.has(c) || !nomesValidos.has(v)) inalcancaveis.push(`${j.timeCasa} x ${j.timeVisitante}`);
    }
    expect(inalcancaveis, `Jogos cujo nome não vem de nenhum fifaCode (FIFA nunca casa o placar): ${inalcancaveis.join(' | ')}`).toEqual([]);
    void byCodes;
  });

  it('caso real: Costa do Marfim, Irã e RD Congo resolvem (nome novo e antigo)', () => {
    expect(getTime('Costa do Marfim')?.nome).toBe('Costa do Marfim');
    expect(getTime("Cote d'Ivoire")?.nome).toBe('Costa do Marfim'); // nome FIFA antigo
    expect(getTime('Irã')?.nome).toBe('Irã');
    expect(getTime('IR Iran')?.nome).toBe('Irã');
    expect(getTime('RD Congo')?.nome).toBe('RD Congo');
    expect(getTime('Congo DR')?.nome).toBe('RD Congo');
  });
});
