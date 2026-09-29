'use strict';

/**
 * DLM Backend - Motor WhatsApp (v2 - Otimizado)
 * Correcoes: SSE em tempo real, rotas connect/disconnect, ciclo de vida estavel
 */

const express        = require('express');
const cors           = require('cors');
const qrcode         = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

// ── Configuracoes ─────────────────────────────────────────────────────────────

const PORT = 3001;

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
];

const SEND_DELAY_MS = 800;     // Reduzido de 1500ms: mais rapido sem arriscar ban
const CONTACTS_CACHE_TTL = 5 * 60 * 1000; // 5 minutos de cache para contatos

// ── Estado global ─────────────────────────────────────────────────────────────

/** @type {'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado'} */
let clientStatus    = 'desconectado';
let qrDataUrl       = null;
let connectedInfo   = null;
let clientInitialized = false;

// Cache de contatos: evita chamar getContacts() (lento) a cada request
let contactsCache   = null;
let contactsCacheAt = 0;

// Clientes SSE conectados (Set de objetos Response do Express)
const sseClients = new Set();

// ── Utilitarios ───────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toChatId(phone) {
  const digits = phone.replace(/\D/g, '');
  return digits + '@c.us';
}

function parseBase64Image(imageStr, fallbackMime = 'image/jpeg') {
  if (imageStr.startsWith('data:')) {
    const match = imageStr.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: fallbackMime, data: imageStr };
}

function clearConsole() {
  process.stdout.write(
    process.platform === 'win32' ? '\x1B[2J\x1B[0f' : '\x1B[2J\x1B[3J\x1B[H'
  );
}

/**
 * Empurra o estado atual para TODOS os clientes SSE conectados.
 * Chamada sempre que status, QR ou info mudarem.
 */
function broadcastState() {
  const payload = JSON.stringify({
    status:  clientStatus,
    qrCode:  qrDataUrl ?? null,
    info:    connectedInfo ?? null,
    error:   null,
  });
  const chunk = `data: ${payload}\n\n`;
  for (const res of sseClients) {
    try { res.write(chunk); } catch { sseClients.delete(res); }
  }
}

// ── WhatsApp Client ───────────────────────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--ignore-certificate-errors',
      '--log-level=3',
    ],
  },
});

// -- Eventos do cliente -------------------------------------------------------

client.on('qr', async (qr) => {
  clientStatus = 'aguardando_qr';
  connectedInfo = null;

  clearConsole();
  console.log('╔═════════════════════════════════════╗');
  console.log('║   DLM - Motor WhatsApp              ║');
  console.log('║   Escaneie o QR Code no WhatsApp    ║');
  console.log('╚═════════════════════════════════════╝\n');
  qrcodeTerminal.generate(qr, { small: true });

  try {
    qrDataUrl = await qrcode.toDataURL(qr);
  } catch {
    qrDataUrl = null;
  }

  // Empurra QR instantaneamente para todos os browsers abertos
  broadcastState();
});

client.on('authenticated', () => {
  clearConsole();
  console.log('[DLM] Sessao autenticada. Carregando...');
});

client.on('ready', async () => {
  clientStatus = 'conectado';
  qrDataUrl    = null;

  try {
    const info = client.info;
    connectedInfo = {
      pushname: info.pushname,
      phone: '+' + info.wid.user,
    };
    console.log(`[DLM] WhatsApp conectado: ${connectedInfo.pushname} (${connectedInfo.phone})`);
  } catch {
    connectedInfo = { pushname: 'Desconhecido', phone: '' };
  }

  broadcastState();
});

client.on('auth_failure', (msg) => {
  console.error('[DLM] Falha de autenticacao:', msg);
  clientStatus    = 'desconectado';
  qrDataUrl       = null;
  connectedInfo   = null;
  clientInitialized = false;
  broadcastState();
});

// CORRECAO Bug 4: removemos client.initialize() aqui para evitar loop de instancias.
// O destroy() limpa o Chrome; a reconexao fica a cargo do usuario via POST /api/connect.
client.on('disconnected', async (reason) => {
  console.log('[DLM] Aparelho desconectado:', reason);
  clientStatus    = 'desconectado';
  qrDataUrl       = null;
  connectedInfo   = null;
  contactsCache   = null;   // invalida cache ao desconectar
  contactsCacheAt = 0;
  broadcastState();

  try { await client.destroy(); } catch { /* ignorar erro no destroy */ }
  clientInitialized = false;
  console.log('[DLM] Clique em "Conectar" no painel para iniciar nova sessao.');
});

// ── Inicializacao automatica (sessoes salvas reconectam sem QR) ────────────────
// Se nao houver sessao salva, dispara o evento 'qr' automaticamente.
console.log('[DLM] Inicializando motor do WhatsApp...');
clientStatus      = 'conectando';
clientInitialized = true;
client.initialize();


// ── Express App ───────────────────────────────────────────────────────────────

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origem nao permitida: ' + origin));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Cache-Control'],
}));

app.use(express.json({ limit: '50mb' }));

// ── Rotas ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/events  — Server-Sent Events (SSE)
 * CORRECAO Bug 1: Esta rota estava ausente, impossibilitando entrega em tempo real.
 * O browser abre UMA conexao e recebe pushes sempre que o estado muda.
 */
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Envia estado atual imediatamente ao conectar
  const current = JSON.stringify({
    status:  clientStatus,
    qrCode:  qrDataUrl ?? null,
    info:    connectedInfo ?? null,
    error:   null,
  });
  res.write(`data: ${current}\n\n`);

  sseClients.add(res);

  // Heartbeat a cada 25s para manter a conexao viva atraves de proxies
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client desconectou */ }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

/**
 * GET /api/status
 * MELHORIA: agora inclui qrCode para o poll de fallback tambem funcionar.
 */
app.get('/api/status', (req, res) => {
  res.json({
    status:  clientStatus,
    qrCode:  clientStatus === 'aguardando_qr' ? qrDataUrl : null,
    info:    connectedInfo ?? undefined,
  });
});

/**
 * GET /api/qr  — QR Code avulso (compatibilidade)
 */
app.get('/api/qr', (req, res) => {
  if (!qrDataUrl) {
    return res.status(404).json({ error: 'QR Code nao disponivel. Status: ' + clientStatus });
  }
  res.json({ qr: qrDataUrl });
});

/**
 * POST /api/connect
 * CORRECAO Bug 3: Rota estava ausente. O botao "Conectar" nao fazia nada.
 * Inicializa o cliente se estiver desconectado.
 */
app.post('/api/connect', async (req, res) => {
  if (['conectando', 'aguardando_qr', 'conectado'].includes(clientStatus)) {
    return res.json({ ok: true, status: clientStatus });
  }

  if (clientInitialized) {
    return res.json({ ok: true, status: clientStatus });
  }

  clientStatus      = 'conectando';
  clientInitialized = true;
  broadcastState();

  client.initialize().catch((err) => {
    console.error('[DLM] Erro ao inicializar:', err.message);
    clientStatus      = 'desconectado';
    clientInitialized = false;
    broadcastState();
  });

  res.json({ ok: true, status: 'conectando' });
});

/**
 * POST /api/disconnect
 * CORRECAO Bug 3: Rota estava ausente. O botao "Desconectar" nao fazia nada.
 * Faz logout (remove sessao salva) e destroi o Chrome.
 */
app.post('/api/disconnect', async (req, res) => {
  if (clientStatus === 'desconectado') {
    return res.json({ ok: true, status: 'desconectado' });
  }

  try { await client.logout(); } catch { /* sessao pode ja estar invalida */ }
  try { await client.destroy(); } catch { /* ignora erro no destroy */ }

  clientStatus      = 'desconectado';
  qrDataUrl         = null;
  connectedInfo     = null;
  clientInitialized = false;
  broadcastState();

  res.json({ ok: true, status: 'desconectado' });
});


/**
 * GET /api/contacts
 * Usa cache de 5 minutos para evitar chamar getContacts() (lento) a cada request.
 * Passe ?refresh=1 para forcar atualizacao.
 */
app.get('/api/contacts', async (req, res) => {
  if (clientStatus !== 'conectado') {
    return res.status(503).json({ error: 'WhatsApp nao esta conectado.' });
  }

  const forceRefresh = req.query.refresh === '1';
  const cacheValid = contactsCache && (Date.now() - contactsCacheAt < CONTACTS_CACHE_TTL);

  if (!forceRefresh && cacheValid) {
    return res.json({ contacts: contactsCache, cached: true });
  }

  try {
    const rawContacts = await client.getContacts();

    // Mapeamos e depois deduplicamos por telefone (whatsapp-web.js pode retornar
    // o mesmo numero com IDs diferentes quando salvo em mais de um lugar).
    const seen = new Set();
    const contacts = rawContacts
      .filter((c) => c.isUser && !c.isMe && c.id.server === 'c.us')
      .map((c) => ({
        id:           c.id._serialized,
        nomeCompleto: c.name || c.pushname || c.id.user || 'Sem nome',
        telefone:     '+' + c.id.user,
      }))
      .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR'))
      .filter((c) => {
        if (seen.has(c.telefone)) return false;
        seen.add(c.telefone);
        return true;
      });

    contactsCache   = contacts;
    contactsCacheAt = Date.now();

    res.json({ contacts });
  } catch (err) {
    console.error('[DLM] Erro ao buscar contatos:', err.message);
    res.status(500).json({ error: 'Erro ao buscar contatos: ' + err.message });
  }
});

/**
 * POST /api/send
 * CORRECAO Bug 2: Frontend enviava campo "imageBase64" mas aqui esperavamos "image".
 * Agora aceitamos AMBOS os nomes para maior robustez.
 */
app.post('/api/send', async (req, res) => {
  if (clientStatus !== 'conectado') {
    return res.status(503).json({ error: 'WhatsApp nao esta conectado.' });
  }

  const { numbers, message, image, imageBase64, mimeType, filename } = req.body;
  const imageData = image || imageBase64 || null; // aceita ambos os campos

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Campo "numbers" deve ser um array nao vazio.' });
  }
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "message" e obrigatorio.' });
  }

  let media = null;
  if (imageData) {
    const { mimeType: detectedMime, data } = parseBase64Image(imageData, mimeType || 'image/jpeg');
    const fname = filename || ('campanha.' + (detectedMime.split('/')[1] || 'jpg'));
    media = new MessageMedia(detectedMime, data, fname);
  }

  const results = [];
  // Deduplicar numeros: evita enviar duas vezes para o mesmo destinatario
  const uniqueNumbers = [...new Set(numbers.map((n) => n.replace(/\D/g, '')))];
  console.log(`\n[DLM] Iniciando disparo para ${uniqueNumbers.length} contato(s) (${numbers.length} recebidos, ${numbers.length - uniqueNumbers.length} duplicatas removidas)...`);

  for (let i = 0; i < uniqueNumbers.length; i++) {
    const number = uniqueNumbers[i];
    const chatId = toChatId(number);
    try {
      if (media) {
        await client.sendMessage(chatId, media, { caption: message });
      } else {
        await client.sendMessage(chatId, message);
      }
      console.log(`[DLM] OK: ${chatId}`);
      results.push({ number, chatId, status: 'enviado' });
    } catch (err) {
      console.error(`[DLM] FALHA: ${chatId} - ${err.message}`);
      results.push({ number, chatId, status: 'falha', error: err.message });
    }
    if (i < uniqueNumbers.length - 1) await sleep(SEND_DELAY_MS);
  }

  const enviados = results.filter((r) => r.status === 'enviado').length;
  const falhas   = results.filter((r) => r.status === 'falha').length;
  console.log(`[DLM] Concluido: ${enviados} ok, ${falhas} falhas.\n`);

  res.json({ total: results.length, enviados, falhas, results });
});

app.use((req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));
app.use((err, req, res, _next) => res.status(500).json({ error: err.message }));

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[DLM] Servidor API em http://localhost:${PORT}`);
  console.log('[DLM] Aguarde o QR Code aparecer na tela e no painel web...\n');
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT', async () => {
  console.log('\n[DLM] Encerrando (Ctrl+C). Fechando Chrome...');
  try { await client.destroy(); } catch { /* ignora */ }
  process.exit(0);
});
