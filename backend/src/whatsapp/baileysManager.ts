import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type Contact as BaileysContact,
} from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import pino from 'pino';
import { EventEmitter } from 'events';
import { config } from '../config.js';
import { RedisService } from '../redis.js';

const logger = pino({ name: 'baileys-manager', level: config.LOG_LEVEL });

export interface SessionData {
  id: string;
  name: string;
  status: 'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado';
  qrCode: string | null;
  info: { pushname?: string; phone?: string } | null;
  error: string | null;
  telefone: string;
  fotoPerfilUrl: string;
}

export interface SessionContact {
  id: string;
  nomeCompleto: string;
  telefone: string;
  salvo: boolean;
}

export class WhatsAppSession {
  public id: string;
  public name: string;
  public status: 'desconectado' | 'conectando' | 'aguardando_qr' | 'conectado' = 'desconectado';
  public qrCode: string | null = null;
  public info: { pushname?: string; phone?: string } | null = null;
  public error: string | null = null;
  public telefone: string = '';
  public socket: WASocket | null = null;
  public contacts: Map<string, SessionContact> = new Map();
  public isStarting: boolean = false;
  private saveContactsTimeout: NodeJS.Timeout | null = null;

  constructor(id: string, name?: string) {
    this.id = id;
    this.name = name || (id === 'default' ? 'Chip 1' : id);
  }

  public loadContactsFromDisk(sessionPath: string) {
    try {
      const contactsFile = path.join(sessionPath, 'contacts.json');
      if (fs.existsSync(contactsFile)) {
        const raw = fs.readFileSync(contactsFile, 'utf-8');
        const list: SessionContact[] = JSON.parse(raw);
        if (Array.isArray(list)) {
          for (const item of list) {
            const digits = item.telefone.replace(/\D/g, '');
            if (digits) {
              this.contacts.set(digits, {
                id: item.id || `${digits}@s.whatsapp.net`,
                nomeCompleto: item.nomeCompleto || `+${digits}`,
                telefone: `+${digits}`,
                salvo: Boolean(item.salvo),
              });
            }
          }
          logger.info(`[${this.name}] ${this.contacts.size} contatos carregados do cache local (salvos e não salvos).`);
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, `[${this.name}] Erro ao ler contacts.json do disco`);
    }
  }

  public scheduleSaveContacts(sessionPath: string) {
    if (this.saveContactsTimeout) return;
    this.saveContactsTimeout = setTimeout(() => {
      this.saveContactsTimeout = null;
      try {
        const contactsFile = path.join(sessionPath, 'contacts.json');
        const array = Array.from(this.contacts.values());
        fs.writeFileSync(contactsFile, JSON.stringify(array, null, 2), 'utf-8');
      } catch (e: any) {
        logger.warn({ err: e.message }, `[${this.name}] Erro ao persistir contacts.json`);
      }
    }, 1500);
  }

  public registerContact(
    jid: string | undefined | null,
    opts: {
      name?: string | null;
      notify?: string | null;
      isSaved?: boolean;
    }
  ): boolean {
    if (!jid || typeof jid !== 'string') return false;

    // Ignora grupos, canais, status do WhatsApp, broadcasts
    if (
      jid.includes('@g.us') ||
      jid.includes('@broadcast') ||
      jid.includes('@newsletter') ||
      jid.includes('@lid') ||
      jid.includes('status@broadcast')
    ) {
      return false;
    }

    const digits = jid.split('@')[0].split(':')[0].replace(/\D/g, '');
    if (!digits || digits.length < 8) return false;

    // Não registra o próprio número do chip
    const myDigits = this.telefone ? this.telefone.replace(/\D/g, '') : '';
    if (myDigits && digits === myDigits) return false;

    const existing = this.contacts.get(digits);
    const formattedPhone = '+' + digits;

    let isSaved = opts.isSaved ?? false;
    let nomeCompleto = '';

    const cleanName = opts.name && opts.name.trim() && opts.name.trim() !== digits ? opts.name.trim() : null;
    const cleanNotify = opts.notify && opts.notify.trim() && opts.notify.trim() !== digits ? opts.notify.trim() : null;

    if (cleanName) {
      nomeCompleto = cleanName;
      isSaved = true;
    } else if (existing?.salvo && existing.nomeCompleto && existing.nomeCompleto !== formattedPhone) {
      nomeCompleto = existing.nomeCompleto;
      isSaved = true;
    } else if (cleanNotify) {
      nomeCompleto = cleanNotify;
      isSaved = existing?.salvo ?? false;
    } else if (existing?.nomeCompleto && existing.nomeCompleto !== formattedPhone) {
      nomeCompleto = existing.nomeCompleto;
      isSaved = existing.salvo ?? false;
    } else {
      nomeCompleto = formattedPhone;
      isSaved = existing?.salvo ?? false;
    }

    if (existing?.salvo) {
      isSaved = true;
    }

    const updatedContact: SessionContact = {
      id: `${digits}@s.whatsapp.net`,
      nomeCompleto,
      telefone: formattedPhone,
      salvo: isSaved,
    };

    if (
      !existing ||
      existing.nomeCompleto !== updatedContact.nomeCompleto ||
      existing.salvo !== updatedContact.salvo
    ) {
      this.contacts.set(digits, updatedContact);
      return true;
    }

    return false;
  }

  toJSON(): SessionData {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      qrCode: this.status === 'aguardando_qr' ? this.qrCode : null,
      info: this.info,
      error: this.error,
      telefone: this.telefone,
      fotoPerfilUrl: `https://ui-avatars.com/api/?name=${encodeURIComponent(this.name)}&background=25D366&color=ffffff`,
    };
  }
}

class BaileysManager extends EventEmitter {
  private sessions: Map<string, WhatsAppSession> = new Map();

  constructor() {
    super();
    this.ensureAuthDir();
    this.initDefaultSessions();
  }

  private ensureAuthDir() {
    if (!fs.existsSync(config.AUTH_DIR)) {
      fs.mkdirSync(config.AUTH_DIR, { recursive: true });
    }
  }

  private initDefaultSessions() {
    // Carrega default
    if (!this.sessions.has('default')) {
      this.sessions.set('default', new WhatsAppSession('default', 'Chip 1'));
    }

    // Carrega sessões existentes no disco
    try {
      const entries = fs.readdirSync(config.AUTH_DIR, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isDirectory()) {
          const id = ent.name;
          if (!this.sessions.has(id)) {
            const num = this.sessions.size + 1;
            this.sessions.set(id, new WhatsAppSession(id, id === 'default' ? 'Chip 1' : `Chip ${num}`));
          }
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, 'Erro ao descobrir sessões prévias');
    }
  }

  public getSession(sessionId: string): WhatsAppSession | undefined {
    return this.sessions.get(sessionId);
  }

  public getAllSessions(): WhatsAppSession[] {
    return Array.from(this.sessions.values());
  }

  public createSession(name?: string): WhatsAppSession {
    const num = this.sessions.size + 1;
    const id = `chip_${Date.now()}`;
    const sessionName = (name && typeof name === 'string' && name.trim()) ? name.trim() : `Chip ${num}`;
    const session = new WhatsAppSession(id, sessionName);
    this.sessions.set(id, session);
    this.broadcast(session);
    return session;
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.socket) {
      try {
        await session.socket.logout().catch(() => {});
        session.socket.end(new Error('Sessão encerrada pelo usuário'));
      } catch {}
      session.socket = null;
    }

    const sessionDir = path.join(config.AUTH_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch {}
    }

    this.sessions.delete(sessionId);
    await RedisService.deleteSession(sessionId);
    this.broadcast();
    return true;
  }

  public async connectSession(sessionId: string, force = false): Promise<WhatsAppSession> {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new WhatsAppSession(sessionId, sessionId === 'default' ? 'Chip 1' : `Chip ${sessionId}`);
      this.sessions.set(sessionId, session);
    }

    if (!force && ['conectando', 'aguardando_qr', 'conectado'].includes(session.status)) {
      return session;
    }

    if (session.isStarting) {
      return session;
    }

    if (session.socket) {
      try {
        session.socket.ev.removeAllListeners('connection.update');
        session.socket.ev.removeAllListeners('creds.update');
        session.socket.ev.removeAllListeners('contacts.upsert');
        session.socket.ev.removeAllListeners('contacts.update');
        session.socket.ev.removeAllListeners('chats.upsert');
        session.socket.ev.removeAllListeners('chats.update');
        session.socket.ev.removeAllListeners('messages.upsert');
        session.socket.ev.removeAllListeners('messaging-history.set');
        session.socket.end(undefined);
      } catch {}
      session.socket = null;
    }

    session.isStarting = true;
    session.status = 'conectando';
    session.error = null;
    this.broadcast(session);

    const sessionPath = path.join(config.AUTH_DIR, session.id);
    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    // Carrega contatos já cacheados em disco
    session.loadContactsFromDisk(sessionPath);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
      let version: [number, number, number] = [2, 3000, 1015901307];
      try {
        const vInfo = await fetchLatestBaileysVersion();
        version = vInfo.version;
      } catch {}

      const silentLogger = pino({ level: 'silent' });

      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
        },
        logger: silentLogger,
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: true, // Sincroniza histórico completo para importar contatos salvos e conversas (não salvos)
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
      });

      session.socket = sock;

      sock.ev.on('creds.update', saveCreds);

      // ── 1. Histórico Completo (Contatos Salvos + Conversas + Mensagens) ────
      sock.ev.on('messaging-history.set', ({ chats, contacts, messages }) => {
        let changed = false;

        // Contatos da agenda
        if (Array.isArray(contacts)) {
          for (const c of contacts) {
            const hasName = Boolean(c.name && c.name.trim());
            if (session.registerContact(c.id, { name: c.name || c.verifiedName, notify: c.notify, isSaved: hasName })) {
              changed = true;
            }
          }
        }

        // Conversas ativas (inclui números não salvos)
        if (Array.isArray(chats)) {
          for (const chat of chats) {
            if (session.registerContact(chat.id, { name: chat.name, isSaved: false })) {
              changed = true;
            }
          }
        }

        // Mensagens recebidas/enviadas
        if (Array.isArray(messages)) {
          for (const m of messages) {
            const remoteJid = m.key?.remoteJid;
            if (remoteJid && session.registerContact(remoteJid, { notify: m.pushName })) {
              changed = true;
            }
          }
        }

        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
          logger.info(`[${session.name}] Histórico sincronizado: ${session.contacts.size} contatos importados.`);
        }
      });

      // ── 2. Contatos da Agenda (Upsert e Update) ───────────────────────────
      sock.ev.on('contacts.upsert', (newContacts: BaileysContact[]) => {
        let changed = false;
        for (const c of newContacts) {
          const hasName = Boolean(c.name && c.name.trim());
          if (session.registerContact(c.id, { name: c.name || c.verifiedName, notify: c.notify, isSaved: hasName })) {
            changed = true;
          }
        }
        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
        }
      });

      sock.ev.on('contacts.update', (updates) => {
        let changed = false;
        for (const c of updates) {
          const hasName = Boolean(c.name && c.name.trim());
          if (session.registerContact(c.id, { name: c.name || c.verifiedName, notify: c.notify, isSaved: hasName })) {
            changed = true;
          }
        }
        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
        }
      });

      // ── 3. Conversas / Chats (Contatos Não Salvos) ────────────────────────
      sock.ev.on('chats.upsert', (newChats) => {
        let changed = false;
        for (const chat of newChats) {
          if (session.registerContact(chat.id, { name: chat.name, isSaved: false })) {
            changed = true;
          }
        }
        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
        }
      });

      sock.ev.on('chats.update', (updates) => {
        let changed = false;
        for (const chat of updates) {
          if (chat.id && session.registerContact(chat.id, { name: chat.name, isSaved: false })) {
            changed = true;
          }
        }
        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
        }
      });

      // ── 4. Mensagens (Captura pushName / números de conversas recentes) ────
      sock.ev.on('messages.upsert', ({ messages }) => {
        let changed = false;
        for (const m of messages) {
          const remoteJid = m.key?.remoteJid;
          if (remoteJid && session.registerContact(remoteJid, { notify: m.pushName })) {
            changed = true;
          }
        }
        if (changed) {
          session.scheduleSaveContacts(sessionPath);
          RedisService.setContacts(session.id, Array.from(session.contacts.values()), 86400);
        }
      });

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          session.status = 'aguardando_qr';
          session.error = null;
          try {
            session.qrCode = await qrcode.toDataURL(qr);
          } catch {
            session.qrCode = null;
          }
          logger.info(`[${session.name}] Novo QR Code gerado.`);
          qrcodeTerminal.generate(qr, { small: true });
          await RedisService.setSession(session.id, session.toJSON());
          this.broadcast(session);
        }

        if (connection === 'open') {
          session.status = 'conectado';
          session.qrCode = null;
          session.error = null;
          const userJid = sock.user?.id || '';
          const digits = userJid.split(':')[0].split('@')[0];
          session.telefone = digits ? '+' + digits : '';
          session.info = {
            pushname: sock.user?.name || session.name,
            phone: session.telefone,
          };

          logger.info(`[${session.name}] Conectado com sucesso: ${session.telefone}`);
          await RedisService.setSession(session.id, session.toJSON());
          this.broadcast(session);
        }

        if (connection === 'close') {
          const err = lastDisconnect?.error as any;
          const statusCode = err?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut;

          logger.warn(`[${session.name}] Conexão fechada. Motivo statusCode: ${statusCode} (${err?.message || 'Sem mensagem'})`);

          // 1. Desconexão definitiva pelo celular
          if (isLoggedOut) {
            session.status = 'desconectado';
            session.qrCode = null;
            session.socket = null;
            session.error = 'Sessão desconectada no aparelho celular.';
            try {
              fs.rmSync(sessionPath, { recursive: true, force: true });
            } catch {}
            await RedisService.deleteSession(session.id);
            this.broadcast(session);
            return;
          }

          // 2. Stream Errored (restart required) — 515
          // Sinalização natural do WhatsApp pós-pareamento para carregar credenciais autenticadas
          if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
            logger.info(`[${session.name}] Pareamento reconhecido pelo WhatsApp (515: restart required). Reconectando sessão autenticada...`);
            session.status = 'conectando';
            session.error = null;
            session.qrCode = null;
            session.socket = null;
            await RedisService.setSession(session.id, session.toJSON());
            this.broadcast(session);

            setTimeout(() => {
              this.connectSession(session.id, true).catch((e) => {
                logger.error({ err: e.message }, `Erro ao reconectar [${session.name}] pós-515`);
              });
            }, 1000);
            return;
          }

          // 3. Queda transitória de conexão (reconexão automática com backoff)
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          if (shouldReconnect) {
            logger.info(`[${session.name}] Conexão oscilou (código ${statusCode}). Tentando reconectar em 2s...`);
            session.status = 'conectando';
            session.error = null;
            session.socket = null;
            await RedisService.setSession(session.id, session.toJSON());
            this.broadcast(session);

            setTimeout(() => {
              this.connectSession(session.id, true).catch((e) => {
                logger.error({ err: e.message }, `Erro na reconexão [${session.name}]`);
              });
            }, 2000);
            return;
          }

          // 4. Outros casos
          session.status = 'desconectado';
          session.qrCode = null;
          session.socket = null;
          session.error = err?.message || 'Conexão encerrada.';
          await RedisService.setSession(session.id, session.toJSON());
          this.broadcast(session);
        }
      });
    } catch (err: any) {
      logger.error({ err: err.message }, `Erro ao iniciar sessão Baileys [${session.name}]`);
      session.status = 'desconectado';
      session.error = err.message;
      session.socket = null;
      this.broadcast(session);
    } finally {
      session.isStarting = false;
    }

    return session;
  }

  public async disconnectSession(sessionId: string): Promise<WhatsAppSession | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'desconectado';
    session.qrCode = null;
    session.info = null;
    session.error = null;

    if (session.socket) {
      try {
        await session.socket.logout().catch(() => {});
        session.socket.end(new Error('Desconectado manualmente'));
      } catch {}
      session.socket = null;
    }

    await RedisService.setSession(session.id, session.toJSON());
    this.broadcast(session);
    return session;
  }

  public async resolveJid(
    socket: WASocket,
    phone: string
  ): Promise<{ jid: string; cleanPhone: string } | null> {
    let clean = phone.replace(/\D/g, '');
    if (!clean) return null;

    // Se o usuário digitou sem DDI (10 ou 11 dígitos, ex: 11999998888 ou 6291119274), adiciona DDI 55 (Brasil)
    if (clean.length === 10 || clean.length === 11) {
      clean = '55' + clean;
    }

    // Se o usuário está enviando para o próprio número do chip conectado
    const myPhone = socket.user?.id ? socket.user.id.split(':')[0].split('@')[0] : '';
    if (myPhone && (clean === myPhone || clean.endsWith(myPhone) || myPhone.endsWith(clean))) {
      return { jid: `${myPhone}@s.whatsapp.net`, cleanPhone: myPhone };
    }

    // Candidatos para checagem no WhatsApp
    const candidates: string[] = [clean];

    // Regra do 9º dígito no Brasil (DDI 55 + DDD de 2 dígitos)
    if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) {
      const ddd = clean.substring(2, 4);
      const rest = clean.substring(4);

      if (clean.length === 13 && rest.startsWith('9')) {
        // 13 dígitos: 55 + DDD + 9xxxxxxxx -> testa sem o 9 (55 + DDD + xxxxxxxx)
        candidates.push('55' + ddd + rest.substring(1));
      } else if (clean.length === 12) {
        // 12 dígitos: 55 + DDD + xxxxxxxx -> testa com o 9 (55 + DDD + 9xxxxxxxx)
        candidates.push('55' + ddd + '9' + rest);
      }
    }

    try {
      const results = await socket.onWhatsApp(...candidates);
      if (Array.isArray(results) && results.length > 0) {
        const found = results.find((r) => r && r.exists && r.jid);
        if (found) {
          return { jid: found.jid, cleanPhone: found.jid.split('@')[0] };
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message }, `Aviso ao consultar onWhatsApp para ${clean}`);
    }

    // Fallback: se a consulta falhar ou não retornar, usa o clean com JID padrão
    return { jid: `${clean}@s.whatsapp.net`, cleanPhone: clean };
  }

  public async sendMessage(
    sessionId: string,
    phone: string,
    message: string,
    image?: string | null
  ): Promise<{ ok: boolean; error?: string; messageId?: string | null }> {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'conectado' || !session.socket) {
      return { ok: false, error: `Sessão [${sessionId}] não está conectada.` };
    }

    const resolved = await this.resolveJid(session.socket, phone);
    if (!resolved) {
      return { ok: false, error: `Número de telefone inválido: "${phone}"` };
    }

    const { jid, cleanPhone } = resolved;
    logger.info(`[${session.name}] Disparando para ${phone} -> JID oficial resolvido: ${jid}`);

    try {
      let result;
      if (image) {
        let base64Data = image;
        let mime = 'image/jpeg';
        if (image.startsWith('data:')) {
          const match = image.match(/^data:([^;]+);base64,(.+)$/s);
          if (match) {
            mime = match[1];
            base64Data = match[2];
          }
        }
        const buffer = Buffer.from(base64Data, 'base64');
        result = await session.socket.sendMessage(jid, {
          image: buffer,
          caption: message,
          mimetype: mime,
        });
      } else {
        result = await session.socket.sendMessage(jid, { text: message });
      }

      logger.info(`[${session.name}] Mensagem enviada com sucesso para ${jid}. ID: ${result?.key?.id}`);
      return { ok: true, messageId: result?.key?.id ?? null };
    } catch (err: any) {
      logger.error({ err: err.message }, `[${session.name}] Erro ao enviar mensagem para ${jid}`);
      return { ok: false, error: err.message };
    }
  }

  public broadcast(session?: WhatsAppSession) {
    const defaultSession = this.sessions.get('default') || Array.from(this.sessions.values())[0];
    const allSessions = Array.from(this.sessions.values()).map((s) => s.toJSON());

    const payload = {
      status: defaultSession ? defaultSession.status : 'desconectado',
      qrCode: defaultSession && defaultSession.status === 'aguardando_qr' ? defaultSession.qrCode : null,
      info: defaultSession ? defaultSession.info : null,
      error: defaultSession ? defaultSession.error : null,
      sessions: allSessions,
    };

    this.emit('state', payload);
  }
}

export const baileysManager = new BaileysManager();
