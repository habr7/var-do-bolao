/**
 * REPL interativo para testar o bot localmente, sem precisar de token da
 * Meta Cloud API. Funciona batendo direto em `handleIncomingMessage` do
 * command.router e capturando o que o bot "enviaria" via meta.client
 * (que opera em modo DRY_RUN_META).
 *
 * Uso:
 *   DRY_RUN_META=true npm run sim
 *
 * Comandos do REPL:
 *   /as <nome> <waId>   — troca o "remetente" atual (ex: /as Maria 5511988888888)
 *   /users              — lista usuarios ja criados na sessao
 *   /pix                — forca PAGO em todos os pagamentos pendentes do
 *                         MockPix e roda o job validate-pix (simula deposito)
 *   /tick-results       — roda o job fetch-results
 *   /state              — mostra a sessao FSM do usuario atual
 *   /clear              — limpa fila de mensagens capturadas
 *   /help               — mostra comandos
 *   /quit               — encerra
 *   <qualquer outro>    — envia como mensagem do usuario atual
 *
 * Pre-requisitos:
 *   - docker compose up -d (postgres + redis)
 *   - npx prisma migrate dev
 */
import 'dotenv/config';
import readline from 'node:readline';
import { env } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/config/database.js';
import { disconnectRedis } from '../src/config/redis.js';
import { handleIncomingMessage } from '../src/whatsapp/command.router.js';
import {
  setCaptureListener,
  drainCapturedMessages,
  type CapturedMessage,
} from '../src/whatsapp/meta.client.js';
import { getSession } from '../src/whatsapp/session.manager.js';
import { getPixAdapter } from '../src/modules/pagamento/pix.adapter.js';
import { MockPixAdapter } from '../src/modules/pagamento/pix.adapter.js';
import { validatePixJob } from '../src/jobs/validate-pix.job.js';
import { fetchResultsJob } from '../src/jobs/fetch-results.job.js';

// ANSI colors
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

interface User {
  nome: string;
  waId: string;
}

let currentUser: User = { nome: 'Humberto', waId: '5511999999999' };
const knownUsers = new Map<string, User>([[currentUser.waId, currentUser]]);

// Impressao em tempo real das mensagens enviadas pelo bot
function printBotMessage(m: CapturedMessage) {
  const alvo = knownUsers.get(m.to)?.nome ?? m.to;
  console.log();
  console.log(`${C.green}${C.bold}🤖 bot → ${alvo} (${m.to})${C.reset}`);
  if (m.text) {
    for (const line of m.text.split('\n')) {
      console.log(`  ${C.gray}│${C.reset} ${line}`);
    }
  }
  if (m.imageUrl) {
    console.log(`  ${C.gray}│${C.reset} ${C.magenta}[imagem] ${m.imageUrl}${C.reset}`);
  }
  if (m.caption) {
    console.log(`  ${C.gray}│${C.reset} ${C.dim}legenda:${C.reset} ${m.caption}`);
  }
}

function printSystem(msg: string) {
  console.log(`${C.yellow}» ${msg}${C.reset}`);
}

function printHelp() {
  console.log(`
${C.bold}${C.cyan}╔═══ VAR do Bolão — modo simulacao ═══╗${C.reset}

${C.bold}Comandos:${C.reset}
  ${C.cyan}/as <nome> <waId>${C.reset}   troca o remetente atual
                       ex: ${C.dim}/as Maria 5511988888888${C.reset}
  ${C.cyan}/users${C.reset}             lista usuarios ja criados na sessao
  ${C.cyan}/pix${C.reset}               forca PAGO em todos os pagamentos pendentes
  ${C.cyan}/tick-results${C.reset}      roda job fetch-results manualmente
  ${C.cyan}/state${C.reset}             mostra sessao FSM do usuario atual
  ${C.cyan}/clear${C.reset}             limpa fila de mensagens capturadas
  ${C.cyan}/help${C.reset}              mostra este menu
  ${C.cyan}/quit${C.reset}              sair

${C.bold}Qualquer outra coisa${C.reset} e enviada como mensagem do ${C.bold}${currentUser.nome}${C.reset} (${currentUser.waId}).

${C.dim}Dica: comece com "oi" pra ver o menu do bot.${C.reset}
`);
}

async function handleCommand(cmd: string, args: string[]): Promise<boolean> {
  switch (cmd) {
    case '/help':
      printHelp();
      return true;

    case '/quit':
    case '/exit':
      return false;

    case '/as': {
      if (args.length < 2) {
        printSystem('uso: /as <nome> <waId> — ex: /as Maria 5511988888888');
        return true;
      }
      const nome = args.slice(0, -1).join(' ');
      const waId = args[args.length - 1];
      if (!/^\d{10,15}$/.test(waId)) {
        printSystem('waId deve ser so digitos (10-15 chars, ex: 5511999999999)');
        return true;
      }
      currentUser = { nome, waId };
      knownUsers.set(waId, currentUser);
      printSystem(`agora enviando como ${C.bold}${nome}${C.reset}${C.yellow} (${waId})`);
      return true;
    }

    case '/users': {
      if (knownUsers.size === 0) {
        printSystem('nenhum usuario criado ainda');
      } else {
        printSystem('usuarios conhecidos:');
        for (const u of knownUsers.values()) {
          const marker = u.waId === currentUser.waId ? '→ ' : '  ';
          console.log(`  ${marker}${u.nome} (${u.waId})`);
        }
      }
      return true;
    }

    case '/pix': {
      const adapter = getPixAdapter();
      if (adapter instanceof MockPixAdapter) {
        const n = adapter.forcarTodasPagas();
        printSystem(`${n} cobranca(s) marcada(s) como PAGO no mock`);
      } else {
        printSystem('adapter em uso nao é MockPixAdapter');
      }
      printSystem('rodando job validate-pix...');
      await validatePixJob();
      return true;
    }

    case '/tick-results': {
      printSystem('rodando job fetch-results...');
      await fetchResultsJob();
      return true;
    }

    case '/state': {
      const s = await getSession(currentUser.waId);
      printSystem(`sessao de ${currentUser.nome}:`);
      console.log(`  ${C.gray}state:${C.reset} ${s.state}`);
      if (s.ctx && Object.keys(s.ctx).length > 0) {
        console.log(`  ${C.gray}ctx:${C.reset} ${JSON.stringify(s.ctx, null, 2)}`);
      }
      return true;
    }

    case '/clear': {
      drainCapturedMessages();
      printSystem('fila de mensagens limpa');
      return true;
    }

    default:
      printSystem(`comando desconhecido: ${cmd} — digite /help`);
      return true;
  }
}

async function main() {
  if (!env.DRY_RUN_META) {
    console.error(`${C.red}❌ Ative DRY_RUN_META=true para rodar a simulacao (se deixar off, as mensagens iriam pro WhatsApp real).${C.reset}`);
    process.exit(1);
  }

  console.log(`${C.bold}${C.cyan}⚽ VAR do Bolão — REPL local${C.reset}`);
  console.log(`${C.dim}DRY_RUN_META=${env.DRY_RUN_META} — nenhuma mensagem real eh enviada${C.reset}`);

  await connectDatabase();

  // Listener imprime mensagens em tempo real conforme o bot as "envia"
  setCaptureListener((m) => printBotMessage(m));

  printHelp();
  printSystem(`voce eh ${C.bold}${currentUser.nome}${C.reset}${C.yellow} (${currentUser.waId}) — /as troca`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });

  const prompt = () => {
    if (process.stdin.isTTY) {
      process.stdout.write(`${C.blue}${currentUser.nome}>${C.reset} `);
    }
  };

  async function processLine(rawLine: string): Promise<boolean> {
    const line = rawLine.trim();
    if (!line) return true;

    try {
      if (line.startsWith('/')) {
        const [cmd, ...args] = line.split(/\s+/);
        const keepRunning = await handleCommand(cmd, args);
        if (!keepRunning) return false;
      } else {
        console.log(`${C.blue}${C.bold}👤 ${currentUser.nome}:${C.reset} ${line}`);
        await handleIncomingMessage({
          waId: currentUser.waId,
          messageId: `sim-${Date.now()}`,
          senderName: currentUser.nome,
          text: line,
        });
      }
    } catch (error) {
      console.error(`${C.red}❌ erro:${C.reset}`, (error as Error).message);
    }
    return true;
  }

  prompt();
  for await (const line of rl) {
    const keepRunning = await processLine(line);
    if (!keepRunning) break;
    prompt();
  }

  console.log(`\n${C.dim}encerrando simulacao...${C.reset}`);
  setCaptureListener(null);
  try {
    await disconnectDatabase();
    await disconnectRedis();
  } catch {
    /* ignora erros no shutdown */
  }
  process.exit(0);
}

main().catch((error) => {
  console.error('❌ erro fatal na simulacao:', error);
  process.exit(1);
});
