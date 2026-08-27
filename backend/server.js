'use strict';

/**
 * DLM Backend — Motor WhatsApp
 * Express + CORS + whatsapp-web.js (LocalAuth) + QR em Base64
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

function resolveBrowserPath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

const browserPath = resolveBrowserPath();

if (!browserPath) {
  console.error('[DLM] Chrome/Edge nao encontrado. Instale o Google Chrome ou defina PUPPETEER_EXECUTABLE_PATH.');
  process.exit(1);
}

console.log('[DLM] Navegador para o WhatsApp Web:', browserPath);

const PORT = Number(process.env.PORT) || 3001;
const SEND_DELAY_MS = 1500;

/** @type {'desconectado' | 'aguardando_qr' | 'conectado'} */
let connectionStatus = 'desconectado';
let currentQR = '';
let connectedInfo = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toChatId(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return `${digits}@c.us`;
}

function parseBase64Image(imageStr, fallbackMime = 'image/jpeg') {
  if (!imageStr || typeof imageStr !== 'string') {
    return null;
  }

  if (imageStr.startsWith('data:')) {
    const match = imageStr.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      return { mimeType: match[1], data: match[2] };
    }
  }

  return { mimeType: fallbackMime, data: imageStr };
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
  puppeteer: {
    executablePath: browserPath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
    ],
  },
});

client.on('qr', async (qr) => {
  connectionStatus = 'aguardando_qr';
  connectedInfo = null;

  try {
    currentQR = await qrcode.toDataURL(qr);
    console.log('[DLM] QR Code convertido para imagem Base64 e pronto para o front-end.');
  } catch (err) {
    currentQR = '';
    console.error('[DLM] Falha ao converter QR para Base64:', err.message);
  }
});

client.on('authenticated', () => {
  console.log('[DLM] Sessao autenticada (LocalAuth).');
});

client.on('ready', async () => {
  connectionStatus = 'conectado';
  currentQR = '';

  try {
    const info = client.info;
    connectedInfo = {
      pushname: info.pushname,
      phone: '+' + info.wid.user,
    };
    console.log(`[DLM] Conectado — ${connectedInfo.pushname} (${connectedInfo.phone})`);
  } catch {
    connectedInfo = { pushname: 'Desconhecido', phone: '' };
  }
});

client.on('auth_failure', (msg) => {
  connectionStatus = 'desconectado';
  currentQR = '';
  connectedInfo = null;
  console.error('[DLM] Falha de autenticacao:', msg);
});

client.on('disconnected', (reason) => {
  connectionStatus = 'desconectado';
  currentQR = '';
  connectedInfo = null;
  console.log('[DLM] Desconectado:', reason);
});

console.log('[DLM] Inicializando motor WhatsApp com LocalAuth...');
client.initialize();

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: '50mb' }));

app.get('/api/status', (req, res) => {
  res.json({
    status: connectionStatus,
    qrCode: currentQR,
    info: connectedInfo,
  });
});

app.get('/api/contacts', async (req, res) => {
  if (connectionStatus !== 'conectado') {
    return res.status(503).json({ error: 'WhatsApp nao esta conectado.' });
  }

  try {
    const rawContacts = await client.getContacts();

    const contacts = rawContacts
      .filter((contact) => contact.isUser && contact.isMyContact)
      .map((contact) => ({
        id: contact.id._serialized,
        nomeCompleto: contact.name || contact.pushname || contact.id.user || 'Sem nome',
        telefone: '+' + contact.id.user,
      }))
      .sort((a, b) => a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR'));

    res.json({ contacts });
  } catch (err) {
    console.error('[DLM] Erro ao listar contatos:', err.message);
    res.status(500).json({ error: 'Erro ao buscar contatos: ' + err.message });
  }
});

app.post('/api/send', async (req, res) => {
  if (connectionStatus !== 'conectado') {
    return res.status(503).json({ error: 'WhatsApp nao esta conectado.' });
  }

  const { numbers, message, imageBase64 } = req.body || {};

  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ error: 'Campo "numbers" deve ser um array nao vazio.' });
  }

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Campo "message" e obrigatorio.' });
  }

  let media = null;
  const parsedImage = parseBase64Image(imageBase64);

  if (parsedImage) {
    const extension = (parsedImage.mimeType.split('/')[1] || 'jpg').split('+')[0];
    media = new MessageMedia(parsedImage.mimeType, parsedImage.data, `campanha.${extension}`);
  }

  const results = [];
  console.log(`[DLM] Disparo iniciado para ${numbers.length} numero(s).`);

  for (let index = 0; index < numbers.length; index += 1) {
    const number = numbers[index];
    const chatId = toChatId(number);

    try {
      if (media) {
        await client.sendMessage(chatId, media, { caption: message });
      } else {
        await client.sendMessage(chatId, message);
      }

      results.push({ number, chatId, status: 'enviado' });
      console.log(`[DLM] OK ${chatId}`);
    } catch (err) {
      results.push({
        number,
        chatId,
        status: 'falha',
        error: err.message,
      });
      console.error(`[DLM] FALHA ${chatId} — ${err.message}`);
    }

    if (index < numbers.length - 1) {
      await sleep(SEND_DELAY_MS);
    }
  }

  const enviados = results.filter((item) => item.status === 'enviado').length;
  const falhas = results.filter((item) => item.status === 'falha').length;

  console.log(`[DLM] Disparo concluido: ${enviados} enviados, ${falhas} falhas.`);

  res.json({
    total: results.length,
    enviados,
    falhas,
    results,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `Rota nao encontrada: ${req.method} ${req.path}` });
});

app.use((err, req, res, _next) => {
  console.error('[DLM] Erro nao tratado:', err.message);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`[DLM] Servidor Express em http://localhost:${PORT}`);
});
