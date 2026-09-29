'use strict';

/**
 * Ciclo de vida do cliente WhatsApp.
 * Isola Puppeteer, QR e reconexao do HTTP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

const AUTH_PATH = path.join(__dirname, '.wwebjs_auth');
const CONNECT_TIMEOUT_MS = 90_000;
const RESTART_BASE_MS = 3_000;
const RESTART_MAX_MS = 30_000;

const events = new EventEmitter();
events.setMaxListeners(100);

let client = null;
let generation = 0;
let qrSeq = 0;
let restartAttempts = 0;
let restartTimer = null;
let connectTimer = null;
let starting = false;
let stopping = false;
let preferNoSandbox = process.env.PUPPETEER_NO_SANDBOX === '1';

/** @type {'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado'} */
let connectionStatus = 'desconectado';
let currentQR = '';
let qrUpdatedAt = null;
let connectedInfo = null;
let lastError = null;

function snapshot() {
  return {
    status: connectionStatus,
    qrCode: currentQR || null,
    qrUpdatedAt,
    info: connectedInfo,
    error: lastError,
  };
}

function emitStatus() {
  events.emit('status', snapshot());
}

function setState(patch) {
  if (patch.status) {
    connectionStatus = patch.status;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'qrCode')) {
    currentQR = patch.qrCode || '';
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'qrUpdatedAt')) {
    qrUpdatedAt = patch.qrUpdatedAt;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'info')) {
    connectedInfo = patch.info;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
    lastError = patch.error;
  }
  emitStatus();
}

function resolveBundledBrowser() {
  const names = ['puppeteer', 'puppeteer-core'];
  for (const name of names) {
    try {
      const mod = require(name);
      if (typeof mod.executablePath !== 'function') {
        continue;
      }
      const bundled = mod.executablePath();
      if (bundled && fs.existsSync(bundled)) {
        return bundled;
      }
    } catch {
      // modulo nao presente neste nivel
    }
  }
  return null;
}

function resolveSystemBrowser() {
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

function resolveBrowserPath() {
  return resolveBundledBrowser() || resolveSystemBrowser();
}

function puppeteerArgs(noSandbox) {
  const args = [
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--password-store=basic',
    '--use-mock-keychain',
    '--log-level=3',
  ];

  // Sandbox so e dispensado em Linux/Docker ou quando o launch falhou com sandbox ativo.
  if (noSandbox) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }

  return args;
}

function shouldUseNoSandbox() {
  if (preferNoSandbox) {
    return true;
  }
  return process.platform !== 'win32' && process.platform !== 'darwin' && typeof process.getuid === 'function' && process.getuid() === 0;
}

function removeStaleLocks(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return;
  }

  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const name of entries) {
      const full = path.join(dir, name);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(full);
        continue;
      }

      if (/^Singleton(Lock|Socket|Cookie)$/i.test(name)) {
        try {
          fs.unlinkSync(full);
          console.log('[DLM] Lock antigo do Chromium removido:', full);
        } catch {
          // processo ainda pode estar usando o arquivo
        }
      }
    }
  };

  walk(rootDir);
}

function clearTimers() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (connectTimer) {
    clearTimeout(connectTimer);
    connectTimer = null;
  }
}

function armConnectTimeout(gen) {
  if (connectTimer) {
    clearTimeout(connectTimer);
  }

  connectTimer = setTimeout(() => {
    if (gen !== generation) {
      return;
    }
    if (connectionStatus === 'conectado' || connectionStatus === 'aguardando_qr') {
      return;
    }

    console.error('[DLM] Timeout ao iniciar o navegador do WhatsApp.');
    lastError = 'Tempo esgotado ao iniciar o WhatsApp. Tentando novamente.';
    void restart({ reason: 'connect-timeout' });
  }, CONNECT_TIMEOUT_MS);
}

function scheduleRestart(reason) {
  if (stopping) {
    return;
  }

  restartAttempts += 1;
  const delay = Math.min(RESTART_MAX_MS, RESTART_BASE_MS * 2 ** Math.min(restartAttempts - 1, 4));
  console.log(`[DLM] Reagendando motor (${reason}) em ${delay}ms (tentativa ${restartAttempts}).`);

  if (restartTimer) {
    clearTimeout(restartTimer);
  }

  restartTimer = setTimeout(() => {
    restartTimer = null;
    void start();
  }, delay);
}

function attachClient(instance, gen) {
  instance.on('qr', async (qr) => {
    if (gen !== generation) {
      return;
    }

    const seq = ++qrSeq;
    restartAttempts = 0;
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }

    setState({
      status: 'aguardando_qr',
      info: null,
      error: null,
    });

    try {
      const dataUrl = await qrcode.toDataURL(qr, {
        margin: 1,
        width: 320,
        errorCorrectionLevel: 'M',
      });

      if (gen !== generation || seq !== qrSeq) {
        return;
      }

      setState({
        status: 'aguardando_qr',
        qrCode: dataUrl,
        qrUpdatedAt: Date.now(),
        error: null,
      });
      console.log('[DLM] QR Code atualizado.');
    } catch (err) {
      if (gen !== generation || seq !== qrSeq) {
        return;
      }
      console.error('[DLM] Falha ao converter QR:', err.message);
      setState({ error: 'Falha ao gerar a imagem do QR Code.' });
    }
  });

  instance.on('loading_screen', (percent, message) => {
    if (gen !== generation) {
      return;
    }
    // Nao rearmar o timeout se o QR ja foi exibido — evita reiniciar a conexao
    // por um loading_screen tardio que chega depois do evento 'qr'.
    if (connectionStatus !== 'aguardando_qr') {
      armConnectTimeout(gen);
    }
    console.log(`[DLM] Carregando WhatsApp Web: ${percent}% ${message || ''}`.trim());
  });

  instance.on('authenticated', () => {
    if (gen !== generation) {
      return;
    }
    restartAttempts = 0;
    console.log('[DLM] Sessao autenticada (LocalAuth).');
  });

  instance.on('ready', () => {
    if (gen !== generation) {
      return;
    }

    restartAttempts = 0;
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }

    let info = { pushname: 'Desconhecido', phone: '' };
    try {
      const clientInfo = instance.info;
      info = {
        pushname: clientInfo.pushname,
        phone: '+' + clientInfo.wid.user,
      };
    } catch {
      // info ainda pode estar incompleto
    }

    setState({
      status: 'conectado',
      qrCode: '',
      qrUpdatedAt: null,
      info,
      error: null,
    });
    console.log(`[DLM] Conectado — ${info.pushname} (${info.phone})`);
  });

  instance.on('auth_failure', (msg) => {
    if (gen !== generation) {
      return;
    }
    console.error('[DLM] Falha de autenticacao:', msg);
    setState({
      status: 'desconectado',
      qrCode: '',
      qrUpdatedAt: null,
      info: null,
      error: 'Falha de autenticacao. Gere um novo QR Code.',
    });
    scheduleRestart('auth_failure');
  });

  instance.on('disconnected', (reason) => {
    if (gen !== generation) {
      return;
    }
    console.log('[DLM] Desconectado:', reason);
    setState({
      status: 'desconectado',
      qrCode: '',
      qrUpdatedAt: null,
      info: null,
      error: reason ? `Desconectado: ${reason}` : 'Sessao encerrada.',
    });
    scheduleRestart('disconnected');
  });
}

async function destroyClient() {
  const instance = client;
  client = null;

  if (!instance) {
    return;
  }

  instance.removeAllListeners();

  try {
    await instance.destroy();
  } catch (err) {
    console.warn('[DLM] destroy():', err.message);
  }
}

function createClient(browserPath, noSandbox) {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: 'dlm',
      dataPath: AUTH_PATH,
    }),
    webVersionCache: {
      type: 'none',
    },
    qrMaxRetries: 0,
    restartOnAuthFail: false,
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    authTimeoutMs: 0,
    puppeteer: {
      executablePath: browserPath,
      headless: true,
      timeout: 120_000,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      args: puppeteerArgs(noSandbox),
    },
  });
}

async function start() {
  if (stopping) {
    return;
  }

  if (starting) {
    return;
  }

  if (client && (connectionStatus === 'conectando' || connectionStatus === 'aguardando_qr' || connectionStatus === 'conectado')) {
    return;
  }

  const browserPath = resolveBrowserPath();
  if (!browserPath) {
    setState({
      status: 'desconectado',
      qrCode: '',
      info: null,
      error: 'Chrome/Edge nao encontrado. Instale o Google Chrome ou defina PUPPETEER_EXECUTABLE_PATH.',
    });
    console.error('[DLM]', lastError);
    return;
  }

  starting = true;
  generation += 1;
  const gen = generation;
  qrSeq = 0;
  clearTimers();
  removeStaleLocks(AUTH_PATH);

  const noSandbox = shouldUseNoSandbox();
  console.log('[DLM] Navegador:', browserPath);
  console.log('[DLM] Sandbox do Chromium:', noSandbox ? 'desativado (fallback)' : 'ativo');

  setState({
    status: 'conectando',
    qrCode: '',
    qrUpdatedAt: null,
    info: null,
    error: null,
  });

  try {
    await destroyClient();
    client = createClient(browserPath, noSandbox);
    attachClient(client, gen);
    armConnectTimeout(gen);

    // initialize() so resolve quando o cliente fica ready (depois do QR).
    // Nao aguardar aqui — senao o HTTP e o restart ficam presos no pareamento.
    client.initialize().catch(async (err) => {
      if (gen !== generation) {
        return;
      }

      const message = err && err.message ? err.message : String(err);
      console.error('[DLM] Falha ao inicializar o WhatsApp:', message);

      const sandboxRelated = /sandbox|target closed|failed to launch|browser/i.test(message);
      if (!noSandbox && sandboxRelated) {
        preferNoSandbox = true;
        console.warn('[DLM] Launch falhou com sandbox. Proxima tentativa usara fallback sem sandbox.');
      }

      await destroyClient();
      setState({
        status: 'desconectado',
        qrCode: '',
        qrUpdatedAt: null,
        info: null,
        error: message,
      });
      scheduleRestart('initialize');
    });
  } finally {
    starting = false;
  }
}

function getClient() {
  return client;
}

async function stop() {
  stopping = true;
  generation += 1;
  clearTimers();
  restartAttempts = 0;

  const instance = client;
  client = null;

  if (instance) {
    instance.removeAllListeners();
    // destroy() primeiro: encerra o Chromium independentemente do estado de auth.
    // logout() so e chamado se houver sessao ativa para limpar no servidor do WA.
    try {
      await instance.destroy();
    } catch (err) {
      console.warn('[DLM] destroy() no stop:', err.message);
    }
    try {
      await instance.logout();
    } catch {
      // ignorado: cliente pode nao estar autenticado
    }
  }

  stopping = false;
  setState({
    status: 'desconectado',
    qrCode: '',
    qrUpdatedAt: null,
    info: null,
    error: null,
  });
  console.log('[DLM] Motor WhatsApp encerrado.');
}

async function restart(options = {}) {
  if (stopping) {
    return;
  }

  const reason = options.reason || 'manual';
  console.log('[DLM] Reiniciando motor:', reason);
  generation += 1;
  clearTimers();
  // Resetar a flag 'starting' garante que start() nao seja ignorado silenciosamente
  // caso uma inicializacao anterior ainda estivesse pendente quando o restart foi chamado.
  starting = false;
  await destroyClient();
  setState({
    status: 'conectando',
    qrCode: '',
    qrUpdatedAt: null,
    info: null,
    error: null,
  });
  await start();
}

function subscribe(listener) {
  events.on('status', listener);
  return () => events.off('status', listener);
}

module.exports = {
  start,
  stop,
  restart,
  snapshot,
  subscribe,
  getClient,
};
