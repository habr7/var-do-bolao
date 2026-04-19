import sharp from 'sharp';

interface ResultCardData {
  rodada: number;
  campeonato: string;
  jogos: Array<{
    timeCasa: string;
    timeVisitante: string;
    golsCasa: number;
    golsVisitante: number;
  }>;
}

const CORES = {
  verdeGramado: '#1B5E20',
  verdeConexao: '#25D366',
  branco: '#FFFFFF',
  amareloArbitro: '#FFEA00',
};

export async function gerarCardResultados(dados: ResultCardData): Promise<Buffer> {
  const width = 800;
  const linhaAltura = 55;
  const headerHeight = 100;
  const footerHeight = 60;
  const height = headerHeight + dados.jogos.length * linhaAltura + footerHeight + 20;

  const jogosLinhas = dados.jogos
    .map((jogo, i) => {
      const y = headerHeight + i * linhaAltura + 40;

      return `
        <rect x="40" y="${y - 32}" width="720" height="${linhaAltura - 5}" rx="8" fill="rgba(255,255,255,0.08)"/>
        <text x="280" y="${y}" fill="${CORES.branco}" font-size="20" font-family="Arial, sans-serif" text-anchor="end">${escapeXml(jogo.timeCasa)}</text>
        <text x="400" y="${y}" fill="${CORES.amareloArbitro}" font-size="24" font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">${jogo.golsCasa} x ${jogo.golsVisitante}</text>
        <text x="520" y="${y}" fill="${CORES.branco}" font-size="20" font-family="Arial, sans-serif">${escapeXml(jogo.timeVisitante)}</text>
        <text x="720" y="${y}" fill="${CORES.verdeConexao}" font-size="16" font-family="Arial, sans-serif" text-anchor="end">FIM</text>
      `;
    })
    .join('');

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${CORES.verdeGramado}"/>
          <stop offset="100%" stop-color="#0D3B0D"/>
        </linearGradient>
      </defs>

      <rect width="${width}" height="${height}" fill="url(#bg)"/>

      <line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>

      <text x="400" y="40" fill="${CORES.amareloArbitro}" font-size="26" font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">RESULTADOS</text>
      <text x="400" y="75" fill="${CORES.branco}" font-size="18" font-family="Arial, sans-serif" text-anchor="middle">Rodada ${dados.rodada} | ${escapeXml(dados.campeonato)}</text>

      ${jogosLinhas}

      <text x="400" y="${height - 20}" fill="rgba(255,255,255,0.5)" font-size="14" font-family="Arial, sans-serif" text-anchor="middle">VAR do Bolao</text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
