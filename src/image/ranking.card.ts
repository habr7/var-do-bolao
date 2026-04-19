import sharp from 'sharp';

interface RankingCardData {
  nomeBolao: string;
  rodada: number;
  campeonato: string;
  ranking: Array<{
    posicao: number;
    nome: string;
    pontos: number;
  }>;
}

const CORES = {
  verdeGramado: '#1B5E20',
  verdeConexao: '#25D366',
  branco: '#FFFFFF',
  amareloArbitro: '#FFEA00',
  cinzaClaro: '#E0E0E0',
  preto: '#212121',
};

function medalhaTexto(posicao: number): string {
  switch (posicao) {
    case 1: return '1st';
    case 2: return '2nd';
    case 3: return '3rd';
    default: return `${posicao}th`;
  }
}

export async function gerarCardRanking(dados: RankingCardData): Promise<Buffer> {
  const width = 800;
  const linhaAltura = 50;
  const headerHeight = 120;
  const footerHeight = 60;
  const height = headerHeight + dados.ranking.length * linhaAltura + footerHeight + 40;

  // Gera SVG para o card
  const linhas = dados.ranking
    .map((entry, i) => {
      const y = headerHeight + i * linhaAltura + 35;
      const cor = i < 3 ? CORES.amareloArbitro : CORES.branco;
      const peso = i < 3 ? 'bold' : 'normal';
      const pos = medalhaTexto(entry.posicao);

      return `
        <rect x="40" y="${y - 30}" width="720" height="${linhaAltura - 5}" rx="8" fill="rgba(255,255,255,0.08)"/>
        <text x="70" y="${y}" fill="${cor}" font-size="20" font-weight="${peso}" font-family="Arial, sans-serif">${pos}</text>
        <text x="140" y="${y}" fill="${CORES.branco}" font-size="20" font-weight="${peso}" font-family="Arial, sans-serif">${escapeXml(entry.nome)}</text>
        <text x="700" y="${y}" fill="${CORES.verdeConexao}" font-size="20" font-weight="bold" font-family="Arial, sans-serif" text-anchor="end">${entry.pontos} pts</text>
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

      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bg)"/>

      <!-- Linhas de campo decorativas -->
      <line x1="0" y1="${headerHeight}" x2="${width}" y2="${headerHeight}" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>
      <line x1="0" y1="${height - footerHeight}" x2="${width}" y2="${height - footerHeight}" stroke="rgba(255,255,255,0.15)" stroke-width="2"/>

      <!-- Header -->
      <text x="400" y="45" fill="${CORES.amareloArbitro}" font-size="28" font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">RANKING</text>
      <text x="400" y="75" fill="${CORES.branco}" font-size="22" font-weight="bold" font-family="Arial, sans-serif" text-anchor="middle">${escapeXml(dados.nomeBolao)}</text>
      <text x="400" y="105" fill="${CORES.cinzaClaro}" font-size="16" font-family="Arial, sans-serif" text-anchor="middle">Rodada ${dados.rodada} | ${escapeXml(dados.campeonato)}</text>

      <!-- Ranking entries -->
      ${linhas}

      <!-- Footer -->
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
