/**
 * Limpeza mensal da tabela `mensagens_nao_entendidas`.
 *
 * LGPD: dados ficam apenas pelo periodo configurado em
 * `MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS` (default 180 dias). Apos isso,
 * registros sao deletados. WhatsappId ja foi armazenado como hash sha256-16,
 * entao o que sobra agregado nao identifica usuario.
 *
 * Roda 1x por mes (dia 1 as 5h da manha). Idempotente — pode ser disparado
 * varias vezes; o WHERE ja filtra apenas registros velhos.
 */
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';

export async function limparMensagensAntigas(): Promise<{ deletados: number; corteAntes: Date }> {
  const dias = env.MENSAGEM_NAO_ENTENDIDA_RETENCAO_DIAS;
  const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  console.log(
    `[limpar-mensagens-antigas] removendo registros antes de ${corte.toISOString()} (>${dias}d)`,
  );

  const resultado = await prisma.mensagemNaoEntendida.deleteMany({
    where: { criadoEm: { lt: corte } },
  });

  console.log(`[limpar-mensagens-antigas] removidos: ${resultado.count}`);

  return { deletados: resultado.count, corteAntes: corte };
}
