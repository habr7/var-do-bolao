/**
 * v3.16.0 — tabela canônica de tradução EN→PT de seleções da Copa 2026.
 *
 * **Fonte única da verdade**: igual ao dicionário `PT_BR` em
 * `scripts/sync-copa-2026.mjs`. Quando sincronizar fixtures, o sync
 * usa essa tabela; quando o fetcher de placares (openfootball) puxa
 * os jogos, traduz EN→PT pela MESMA tabela antes de casar com o
 * fixture local.
 *
 * Por que existe: o JSON local `fifa-2026-fixtures.json` tem times
 * em PT-BR (`"México"`, `"Bélgica"`). O openfootball/worldcup.json
 * retorna em inglês (`"Mexico"`, `"Belgium"`). Sem tabela, jogo
 * nunca casava — bug latente do `mapFifaApiIdToOurId` antigo.
 *
 * Manter sincronizado com `scripts/sync-copa-2026.mjs:PT_BR`. Se
 * adicionar/mudar tradução num lugar, refletir no outro.
 */

export const PT_BR_TIMES: Readonly<Record<string, string>> = {
  Algeria: 'Argélia',
  Argentina: 'Argentina',
  Australia: 'Austrália',
  Austria: 'Áustria',
  Belgium: 'Bélgica',
  Bolivia: 'Bolívia',
  'Bosnia & Herzegovina': 'Bósnia e Herzegovina',
  Brazil: 'Brasil',
  Canada: 'Canadá',
  'Cape Verde': 'Cabo Verde',
  Colombia: 'Colômbia',
  Croatia: 'Croácia',
  Curaçao: 'Curaçao',
  Czechia: 'República Tcheca',
  'Czech Republic': 'República Tcheca',
  'DR Congo': 'RD Congo',
  Ecuador: 'Equador',
  Egypt: 'Egito',
  England: 'Inglaterra',
  France: 'França',
  Germany: 'Alemanha',
  Ghana: 'Gana',
  Haiti: 'Haiti',
  Iran: 'Irã',
  Iraq: 'Iraque',
  Italy: 'Itália',
  'Ivory Coast': 'Costa do Marfim',
  Jamaica: 'Jamaica',
  Japan: 'Japão',
  Jordan: 'Jordânia',
  'Korea Republic': 'Coreia do Sul',
  Mexico: 'México',
  Morocco: 'Marrocos',
  Netherlands: 'Holanda',
  'New Caledonia': 'Nova Caledônia',
  'New Zealand': 'Nova Zelândia',
  Norway: 'Noruega',
  Panama: 'Panamá',
  Paraguay: 'Paraguai',
  Portugal: 'Portugal',
  Qatar: 'Catar',
  'Republic of Ireland': 'Irlanda',
  Ireland: 'Irlanda',
  'Saudi Arabia': 'Arábia Saudita',
  Scotland: 'Escócia',
  Senegal: 'Senegal',
  'South Africa': 'África do Sul',
  'South Korea': 'Coreia do Sul',
  Spain: 'Espanha',
  Suriname: 'Suriname',
  Sweden: 'Suécia',
  Switzerland: 'Suíça',
  Tunisia: 'Tunísia',
  Turkey: 'Turquia',
  Türkiye: 'Turquia',
  USA: 'Estados Unidos',
  'United States': 'Estados Unidos',
  Uruguay: 'Uruguai',
  Uzbekistan: 'Uzbequistão',
  Wales: 'País de Gales',
};

/** Traduz nome em inglês pra PT-BR. Se não conhece, retorna o input. */
export function traduzirTime(nomeEn: string): string {
  return PT_BR_TIMES[nomeEn] ?? nomeEn;
}
