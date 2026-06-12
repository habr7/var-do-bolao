import { prisma } from '../config/database.js';
import { redis } from '../config/redis.js';
import { sendText } from '../whatsapp/evolution.client.js';
import { env } from '../config/env.js';
import { listaDonos } from '../whatsapp/broadcast.js';
import { paginarBlocos } from '../utils/paginar.js';

/**
 * v3.32.0 — Revisão DIÁRIA das mensagens não-entendidas (loop de melhoria).
 *
 * Pedido do dono: com jogo todo dia, revisar a cada 24h o que o bot não
 * entendeu pra achar melhorias SEM depender de print de usuário.
 *
 * 1x por dia (cron 09:00 BRT), compila as `mensagens_nao_entendidas` das
 * últimas 24h e manda um relatório por WhatsApp pro(s) número(s) dono(s)
 * (OWNER_WHATSAPP_IDS — mesma config do broadcast):
 *   - total por motivo (low_confidence / llm_fail / final_fallback)
 *   - textos deduplicados com a intent que o LLM tentou + confiança
 *
 * Mensagem ADMIN: não conta no MAX_AVISOS_DIA (vai só pro dono).
 * Idempotente por dia (flag Redis). Se não houve miss nas 24h, manda um
 * "tudo limpo" curto (sinal de vida do loop).
 */
export async function revisaoDiariaJob(): Promise<void> {
  if (!env.ENABLE_REVISAO_DIARIA) return;

  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }); // YYYY-MM-DD
  const flag = `revisao-diaria:${hoje}`;
  const claimed = await redis.set(flag, '1', 'EX', 30 * 3600, 'NX');
  if (claimed !== 'OK') return; // já rodou hoje

  const donos = listaDonos(env.OWNER_WHATSAPP_IDS);
  if (donos.length === 0) return;

  const desde = new Date(Date.now() - 24 * 3600_000);
  const misses = await prisma.mensagemNaoEntendida.findMany({
    where: { criadoEm: { gte: desde } },
    orderBy: { criadoEm: 'desc' },
    take: 200,
  });

  if (misses.length === 0) {
    for (const dono of donos) {
      await sendText({
        to: dono,
        text: `🧹 *Revisão diária (24h)*: nenhuma mensagem não-entendida. Bot 100% no controle hoje. ✅`,
      });
    }
    return;
  }

  // Agrega por motivo
  const porMotivo = new Map<string, number>();
  for (const m of misses) porMotivo.set(m.motivo, (porMotivo.get(m.motivo) ?? 0) + 1);
  const resumoMotivos = [...porMotivo.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, n]) => `• ${motivo}: ${n}`)
    .join('\n');

  // Dedup de textos ~iguais (normalizado), contando ocorrências
  const norm = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const agrupados = new Map<string, { texto: string; n: number; intent?: string | null; conf?: number | null }>();
  for (const m of misses) {
    const k = norm(m.texto).slice(0, 120);
    const atual = agrupados.get(k);
    if (atual) {
      atual.n++;
    } else {
      agrupados.set(k, { texto: m.texto.slice(0, 120), n: 1, intent: m.llmIntent, conf: m.llmConfianca });
    }
  }
  const linhas = [...agrupados.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 25)
    .map((g) => {
      const extra =
        g.intent != null
          ? ` _(LLM tentou: ${g.intent}${g.conf != null ? ` @${g.conf.toFixed(2)}` : ''})_`
          : '';
      return `${g.n > 1 ? `${g.n}× ` : ''}"${g.texto}"${extra}`;
    });

  const partes = [
    `🧹 *Revisão diária — mensagens não-entendidas (24h)*\n\nTotal: *${misses.length}*\n${resumoMotivos}`,
    ...linhas.map((l) => `• ${l}`),
    `_Pra corrigir: manda esses casos pro desenvolvimento virar pattern/alias/handler._`,
  ];

  for (const dono of donos) {
    for (const pagina of paginarBlocos(partes, 3500)) {
      await sendText({ to: dono, text: pagina });
    }
  }
  console.log(`[revisao-diaria] relatório enviado: ${misses.length} misses, ${agrupados.size} únicos`);
}
