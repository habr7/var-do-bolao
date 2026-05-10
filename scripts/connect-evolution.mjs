/**
 * Conecta a instance "varbolao" da Evolution API ao WhatsApp via
 * pairing code (8 caracteres digitados no celular). Bypassa o Manager
 * UI, que tem bug de renderizacao do QR na v2.2.3.
 *
 * Uso:
 *   node scripts/connect-evolution.mjs 5511999998888
 *   (numero do bot em formato internacional, somente digitos, sem +)
 *
 * Le EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE do .env.
 * Apaga instance antiga com mesmo nome (clean slate), cria nova com
 * webhook ja apontando pro bot local, imprime pairing code, e polla
 * connection state ate `open`.
 */
import 'dotenv/config';

// ANSI colors
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

const API = (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/+$/, '');
const KEY = process.env.EVOLUTION_API_KEY;
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'varbolao';
const WEBHOOK_URL =
  process.env.WEBHOOK_GLOBAL_URL || 'http://host.docker.internal:3000/webhook/whatsapp';

if (!KEY || KEY === 'dry-run-key') {
  console.error(`${C.red}❌ EVOLUTION_API_KEY nao definido (ou ainda dry-run). Confere o .env.${C.reset}`);
  process.exit(1);
}

const numeroBruto = process.argv[2];
if (!numeroBruto || !/^\d{10,15}$/.test(numeroBruto)) {
  console.error(`${C.red}❌ Uso: node scripts/connect-evolution.mjs 5511999998888${C.reset}`);
  console.error(`   Numero deve ser apenas digitos (10-15), sem + ou espacos.`);
  process.exit(1);
}

const headers = { 'Content-Type': 'application/json', apikey: KEY };

async function req(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

function formatPairingCode(code) {
  // ABCDEFGH -> ABCD - EFGH
  if (typeof code !== 'string') return code;
  const clean = code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (clean.length === 8) return `${clean.slice(0, 4)} - ${clean.slice(4)}`;
  return clean;
}

function findPairingCode(obj) {
  if (!obj || typeof obj !== 'object') return null;
  // procura recursivamente por "pairingCode" ou "pairing_code" string nao-vazia
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && /^[A-Z0-9]{6,10}$/i.test(v) && /pair/i.test(k)) {
      return v;
    }
    if (typeof v === 'object' && v !== null) {
      const nested = findPairingCode(v);
      if (nested) return nested;
    }
  }
  return null;
}

async function main() {
  console.log(`${C.bold}${C.cyan}🔧 Conectando instance '${INSTANCE}' (${numeroBruto})...${C.reset}\n`);

  // 1. Apaga instance antiga com mesmo nome (ignora 404)
  console.log(`${C.dim}1/4 limpando instance antiga (se existir)...${C.reset}`);
  // Primeiro logout, depois delete (algumas builds da Evolution exigem)
  await req('DELETE', `/instance/logout/${INSTANCE}`);
  const del = await req('DELETE', `/instance/delete/${INSTANCE}`);
  if (del.status === 200 || del.status === 201) {
    console.log(`${C.dim}    → deletada${C.reset}`);
  } else if (del.status === 404) {
    console.log(`${C.dim}    → nao existia${C.reset}`);
  } else {
    console.log(`${C.yellow}    → status ${del.status} (seguindo)${C.reset}`);
  }

  // Espera o delete propagar no banco (Evolution as vezes demora ~3s)
  // e poll garantindo que sumiu
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const list = await req('GET', `/instance/fetchInstances`);
    const ainda = Array.isArray(list.json) && list.json.some((x) => x.name === INSTANCE);
    if (!ainda) break;
    if (i === 9) console.log(`${C.yellow}    → ainda aparece no fetch apos 10s, vou prosseguir mesmo assim${C.reset}`);
  }

  // 2. Cria nova instance com webhook configurado + number pra pairing code
  console.log(`${C.dim}2/4 criando instance + webhook...${C.reset}`);
  const create = await req('POST', '/instance/create', {
    instanceName: INSTANCE,
    integration: 'WHATSAPP-BAILEYS',
    number: numeroBruto,
    qrcode: false,
    webhook: {
      url: WEBHOOK_URL,
      byEvents: false,
      base64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
    },
  });

  if (create.status >= 400) {
    console.error(`${C.red}❌ Falha ao criar instance (HTTP ${create.status}):${C.reset}`);
    console.error(JSON.stringify(create.json, null, 2));
    process.exit(1);
  }
  console.log(`${C.green}    ✅ instance criada${C.reset}`);
  console.log(`${C.dim}    webhook: ${WEBHOOK_URL}${C.reset}`);

  // 3. Pega pairing code (vem na resposta de create OU via connect endpoint)
  console.log(`${C.dim}3/4 obtendo codigo de pareamento...${C.reset}`);
  let pairing = findPairingCode(create.json);

  if (!pairing) {
    // tenta via /instance/connect
    await new Promise((r) => setTimeout(r, 1500));
    const connect = await req('GET', `/instance/connect/${INSTANCE}`);
    pairing = findPairingCode(connect.json);
  }

  if (!pairing) {
    // polla por ate 30s
    for (let i = 0; i < 10 && !pairing; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const cn = await req('GET', `/instance/connect/${INSTANCE}`);
      pairing = findPairingCode(cn.json);
    }
  }

  if (!pairing) {
    console.error(`${C.red}❌ Pairing code nao retornado pela Evolution.${C.reset}`);
    console.error(`   Tente o fallback de QR (a implementar com --qr) ou refaca via Manager.`);
    process.exit(1);
  }

  const codeFmt = formatPairingCode(pairing);
  console.log(`\n${C.green}${C.bold}═══════════════════════════════════════════${C.reset}`);
  console.log(`${C.green}${C.bold}      📲 CODIGO DE PAREAMENTO${C.reset}`);
  console.log(`${C.green}${C.bold}═══════════════════════════════════════════${C.reset}\n`);
  console.log(`           ${C.bold}${C.magenta}${codeFmt}${C.reset}\n`);
  console.log(`${C.green}${C.bold}═══════════════════════════════════════════${C.reset}\n`);
  console.log(`${C.cyan}No celular do bot:${C.reset}`);
  console.log(`  1. Abra ${C.bold}WhatsApp${C.reset}`);
  console.log(`  2. Menu (⋮) → ${C.bold}Aparelhos conectados${C.reset}`);
  console.log(`  3. Toque em ${C.bold}"Vincular com numero de telefone"${C.reset}`);
  console.log(`  4. Digite o codigo acima\n`);

  // 4. Polla connection state ate "open" (timeout 3min)
  console.log(`${C.dim}4/4 aguardando conexao...${C.reset}`);
  const inicio = Date.now();
  let lastState = '';
  while (Date.now() - inicio < 180_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const cs = await req('GET', `/instance/connectionState/${INSTANCE}`);
    const state = cs.json?.instance?.state || cs.json?.state || 'unknown';
    if (state !== lastState) {
      const elapsed = Math.round((Date.now() - inicio) / 1000);
      console.log(`${C.dim}[${elapsed}s] state: ${state}${C.reset}`);
      lastState = state;
    }
    if (state === 'open') {
      console.log(`\n${C.green}${C.bold}✅ CONECTADO!${C.reset}`);
      console.log(`${C.cyan}WhatsApp do bot esta logado e Evolution API esta pronta.${C.reset}`);
      console.log(`\nProximo passo: ${C.bold}npm run dev${C.reset} (em outro terminal)\n`);
      process.exit(0);
    }
  }

  console.error(`\n${C.red}⏰ Timeout 3min sem conectar. Codigo provavelmente expirou.${C.reset}`);
  console.error(`   Re-rode o script pra gerar novo codigo.`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`${C.red}❌ Erro:${C.reset}`, err.message);
  process.exit(1);
});
