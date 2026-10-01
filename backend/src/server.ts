import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { z } from 'zod';
import pino from 'pino';
import { config } from './config.js';
import { redis, RedisService } from './redis.js';
import { baileysManager, type WhatsAppSession } from './whatsapp/baileysManager.js';
import {
  dispatchQueue,
  dispatchQueueEvents,
  type DispatchJobData,
  type DispatchResult,
} from './queues/dispatchQueue.js';
import { userManager, type UserRole, type SafeUser } from './auth/userManager.js';

const logger = pino({
  level: config.LOG_LEVEL,
  transport: {
    target: 'pino-pretty',
    options: { colorize: true },
  },
});

const server = Fastify({
  loggerInstance: logger,
  bodyLimit: 50 * 1024 * 1024, // 50MB para suportar imagens em base64
});

// Clientes SSE ativos
const sseClients = new Set<any>();

// Clientes WebSocket ativos
const wsClients = new Set<any>();

// Função de broadcast unificada
function broadcastToAll(data: any) {
  const json = JSON.stringify(data);
  const sseChunk = `data: ${json}\n\n`;

  // Envia para SSE
  for (const res of sseClients) {
    try {
      res.raw.write(sseChunk);
    } catch {
      sseClients.delete(res);
    }
  }

  // Envia para WebSocket
  for (const client of wsClients) {
    try {
      if (client.readyState === 1) {
        client.send(json);
      }
    } catch {
      wsClients.delete(client);
    }
  }
}

// Ouve eventos do motor Baileys
baileysManager.on('state', (state) => {
  broadcastToAll(state);
});

async function main() {
  // CORS
  await server.register(cors, {
    origin: ['http://localhost:5173', 'http://localhost:4173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', 'Cache-Control'],
  });

  // WebSocket
  await server.register(fastifyWebsocket);

  server.get('/ws', { websocket: true }, (socket) => {
    wsClients.add(socket);
    logger.info('Cliente conectado via WebSocket nativo.');

    // Envia estado inicial
    const defaultSession = baileysManager.getSession('default') || baileysManager.getAllSessions()[0];
    const allSessions = baileysManager.getAllSessions().map((s) => s.toJSON());
    socket.send(
      JSON.stringify({
        status: defaultSession ? defaultSession.status : 'desconectado',
        qrCode: defaultSession && defaultSession.status === 'aguardando_qr' ? defaultSession.qrCode : null,
        info: defaultSession ? defaultSession.info : null,
        error: defaultSession ? defaultSession.error : null,
        sessions: allSessions,
      })
    );

    socket.on('close', () => {
      wsClients.delete(socket);
    });
  });

  // ── Helpers de RBAC & Autenticação ──────────────────────────────────────────
  function getCurrentUser(req: any): SafeUser {
    const userId = req.headers['x-user-id'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (userId) {
      const u = userManager.getById(String(userId));
      if (u) return u;
    }
    // Fallback: seleciona o primeiro admin padrão
    const all = userManager.getAll();
    return all.find((u) => u.role === 'ADMIN') || all[0];
  }

  function checkRole(req: any, allowedRoles: UserRole[], reply: any): boolean {
    const user = getCurrentUser(req);
    if (!user || !allowedRoles.includes(user.role)) {
      reply.status(403).send({
        error: `Acesso negado. Ação restrita para papéis: [${allowedRoles.join(', ')}]. Seu papel atual é [${user?.role || 'DESCONHECIDO'}].`,
      });
      return false;
    }
    return true;
  }

  // ── Rotas de Autenticação e Gestão de Usuários (RBAC) ───────────────────────

  // GET /api/auth/me — Obtém dados do usuário atual e seus privilégios
  server.get('/api/auth/me', async (req) => {
    const user = getCurrentUser(req);
    return { user };
  });

  // POST /api/auth/login — Login ou troca de usuário ativo
  server.post('/api/auth/login', async (req, reply) => {
    const schema = z.object({
      email: z.string().email('E-mail inválido'),
      password: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    const user = userManager.authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ error: 'Credenciais inválidas.' });
    }

    return { ok: true, user, token: user.id };
  });

  // POST /api/auth/register — Cadastro de novos usuários (Por padrão recebem nível OPERATOR)
  server.post('/api/auth/register', async (req, reply) => {
    const schema = z.object({
      name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres.'),
      email: z.string().email('E-mail inválido.'),
      password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres.').optional(),
      role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    try {
      const caller = getCurrentUser(req);
      // Novos usuários cadastrados por padrão recebem OPERATOR. Apenas ADMIN pode especificar outro papel.
      const assignedRole = (caller.role === 'ADMIN' && parsed.data.role) ? parsed.data.role : 'OPERATOR';
      const user = userManager.register(parsed.data.name, parsed.data.email, parsed.data.password, assignedRole);
      reply.status(201);
      return { ok: true, user, token: user.id };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // GET /api/users — Lista todos os usuários e seus níveis de acesso
  server.get('/api/users', async (req) => {
    const users = userManager.getAll();
    const currentUser = getCurrentUser(req);
    return { users, currentUser };
  });

  // PATCH /api/users/:id/role — Atualiza o nível de acesso de um usuário (Exclusivo ADMIN)
  server.patch('/api/users/:id/role', async (req, reply) => {
    if (!checkRole(req, ['ADMIN'], reply)) return;

    const { id } = req.params as { id: string };
    const schema = z.object({
      role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    try {
      const caller = getCurrentUser(req);
      const updated = userManager.updateRole(id, parsed.data.role, caller.id);
      return { ok: true, user: updated };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // DELETE /api/users/:id — Remove um usuário da plataforma (Exclusivo ADMIN)
  server.delete('/api/users/:id', async (req, reply) => {
    if (!checkRole(req, ['ADMIN'], reply)) return;

    const { id } = req.params as { id: string };
    try {
      const caller = getCurrentUser(req);
      const ok = userManager.deleteUser(id, caller.id);
      if (!ok) {
        return reply.status(404).send({ error: 'Usuário não encontrado.' });
      }
      return { ok: true, removed: id };
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // ── Rotas REST ─────────────────────────────────────────────────────────────

  // GET /api/health — Métricas de performance e memória
  server.get('/api/health', async () => {
    const memory = process.memoryUsage();
    const queueWaiting = await dispatchQueue.getWaitingCount();
    const queueActive = await dispatchQueue.getActiveCount();

    return {
      status: 'healthy',
      uptime: process.uptime(),
      memory: {
        rssMB: Math.round(memory.rss / 1024 / 1024),
        heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memory.heapTotal / 1024 / 1024),
      },
      queue: {
        waiting: queueWaiting,
        active: queueActive,
      },
      sessionsTotal: baileysManager.getAllSessions().length,
      sessionsConnected: baileysManager.getAllSessions().filter((s) => s.status === 'conectado').length,
    };
  });

  // GET /api/events — SSE em tempo real (compatível com a UI existente)
  server.get('/api/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    sseClients.add(reply);

    const defaultSess = baileysManager.getSession('default') || baileysManager.getAllSessions()[0];
    const allSessions = baileysManager.getAllSessions().map((s) => s.toJSON());

    const initialPayload = JSON.stringify({
      status: defaultSess ? defaultSess.status : 'desconectado',
      qrCode: defaultSess && defaultSess.status === 'aguardando_qr' ? defaultSess.qrCode : null,
      info: defaultSess ? defaultSess.info : null,
      error: defaultSess ? defaultSess.error : null,
      sessions: allSessions,
    });

    reply.raw.write(`data: ${initialPayload}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {}
    }, 25000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(reply);
    });
  });

  // GET /api/sessions — Lista todas as sessões/chips
  server.get('/api/sessions', async () => {
    return {
      sessions: baileysManager.getAllSessions().map((s) => s.toJSON()),
    };
  });

  // POST /api/sessions — Cria uma nova sessão (Exclusivo ADMIN)
  server.post('/api/sessions', async (req, reply) => {
    if (!checkRole(req, ['ADMIN'], reply)) return;

    const body = (req.body as any) || {};
    const name = body.name;
    const session = baileysManager.createSession(name);
    reply.status(201);
    return { session: session.toJSON() };
  });

  // DELETE /api/sessions/:sessionId — Remove uma sessão (Exclusivo ADMIN)
  server.delete('/api/sessions/:sessionId', async (req, reply) => {
    if (!checkRole(req, ['ADMIN'], reply)) return;

    const { sessionId } = req.params as { sessionId: string };
    if (sessionId === 'default') {
      return reply.status(400).send({ error: 'O Chip principal (default) não pode ser excluído.' });
    }

    const removed = await baileysManager.deleteSession(sessionId);
    if (!removed) {
      return reply.status(404).send({ error: 'Sessão não encontrada.' });
    }

    return { ok: true, removed: sessionId };
  });

  // GET /api/status — Status da sessão ativa
  server.get('/api/status', async (req) => {
    const query = req.query as { sessionId?: string };
    const sessionId = query.sessionId || 'default';
    const session = baileysManager.getSession(sessionId) || baileysManager.getSession('default') || baileysManager.getAllSessions()[0];
    const allSessions = baileysManager.getAllSessions().map((s) => s.toJSON());

    return {
      status: session ? session.status : 'desconectado',
      qrCode: session && session.status === 'aguardando_qr' ? session.qrCode : null,
      info: session ? session.info : undefined,
      error: session ? session.error : undefined,
      sessions: allSessions,
    };
  });

  // GET /api/qr — QR Code da sessão
  server.get('/api/qr', async (req, reply) => {
    const query = req.query as { sessionId?: string };
    const sessionId = query.sessionId || 'default';
    const session = baileysManager.getSession(sessionId) || baileysManager.getSession('default');

    if (!session || !session.qrCode) {
      return reply.status(404).send({ error: 'QR Code não disponível para a sessão solicitada.' });
    }

    return { qr: session.qrCode, sessionId: session.id };
  });

  // POST /api/connect — Inicia conexão/pareamento (ADMIN e OPERATOR)
  server.post('/api/connect', async (req, reply) => {
    if (!checkRole(req, ['ADMIN', 'OPERATOR'], reply)) return;

    const { force, sessionId = 'default' } = (req.body as any) || {};
    const session = await baileysManager.connectSession(sessionId, force);
    return { ok: true, status: session.status, session: session.toJSON() };
  });

  // POST /api/disconnect — Desconecta sessão (Exclusivo ADMIN)
  server.post('/api/disconnect', async (req, reply) => {
    if (!checkRole(req, ['ADMIN'], reply)) return;

    const body = (req.body as any) || {};
    const query = (req.query as any) || {};
    const sessionId = body.sessionId || query.sessionId || 'default';

    const session = await baileysManager.disconnectSession(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada.' });
    }

    return { ok: true, status: 'desconectado', session: session.toJSON() };
  });

  // GET /api/contacts — Contatos da sessão conectada (salvos e não salvos com cache no Redis)
  server.get('/api/contacts', async (req, reply) => {
    const query = req.query as { sessionId?: string; refresh?: string };
    const sessionId = query.sessionId;

    let session: WhatsAppSession | undefined = sessionId ? baileysManager.getSession(sessionId) : undefined;
    if (!session) {
      session = baileysManager.getAllSessions().find((s) => s.status === 'conectado');
    }

    if (!session || session.status !== 'conectado' || !session.socket) {
      return reply.status(503).send({ error: 'Nenhum WhatsApp conectado para carregar contatos.' });
    }

    const forceRefresh = query.refresh === '1';

    // Tenta pegar do Redis se não for refresh forçado
    if (!forceRefresh) {
      const cached = await RedisService.getContacts(session.id);
      if (cached && cached.length > 0) {
        const salvosCount = cached.filter((c: any) => c.salvo).length;
        return {
          contacts: cached,
          total: cached.length,
          salvos: salvosCount,
          naoSalvos: cached.length - salvosCount,
          cached: true,
        };
      }
    }

    // Contatos sincronizados pelo Baileys (salvos da agenda + não salvos de conversas)
    const contactsList = Array.from(session.contacts.values()).sort((a, b) => {
      // Prioriza contatos salvos no topo
      if (a.salvo !== b.salvo) {
        return a.salvo ? -1 : 1;
      }
      return a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR');
    });

    // Salva no Redis (cache de 24h)
    if (contactsList.length > 0) {
      await RedisService.setContacts(session.id, contactsList, 86400);
    }

    const salvosCount = contactsList.filter((c) => c.salvo).length;

    return {
      contacts: contactsList,
      total: contactsList.length,
      salvos: salvosCount,
      naoSalvos: contactsList.length - salvosCount,
    };
  });

  // POST /api/send — Disparo em massa via BullMQ + Redis com Round-Robin Multi-Chip e Anti-Spam
  server.post('/api/send', async (req, reply) => {
    // Permite apenas ADMIN e OPERATOR realizarem envios (VIEWER apenas visualiza)
    if (!checkRole(req, ['ADMIN', 'OPERATOR'], reply)) return;

    const sendSchema = z.object({
      numbers: z.array(z.string()).min(1, 'Pelo menos um número deve ser informado.'),
      message: z.string().min(1, 'Mensagem é obrigatória.'),
      image: z.string().nullable().optional(),
      imageBase64: z.string().nullable().optional(),
      sessionId: z.string().optional(),
      intervalSeconds: z.coerce.number().min(1).max(120).default(5).optional(),
    });

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    const { numbers, message, image, imageBase64, sessionId, intervalSeconds = 5 } = parsed.data;
    const media = image || imageBase64 || null;
    const delayMs = intervalSeconds * 1000;

    let availableSessions: WhatsAppSession[] = [];
    if (sessionId && sessionId !== 'auto') {
      const chosen = baileysManager.getSession(sessionId);
      if (!chosen || chosen.status !== 'conectado' || !chosen.socket) {
        return reply.status(503).send({ error: `O chip "${sessionId}" não está conectado.` });
      }
      availableSessions = [chosen];
    } else {
      availableSessions = baileysManager.getAllSessions().filter((s) => s.status === 'conectado' && s.socket);
    }

    if (availableSessions.length === 0) {
      return reply.status(503).send({ error: 'Nenhum WhatsApp conectado para realizar o envio.' });
    }

    const uniqueNumbers = [...new Set(numbers.map((n) => n.replace(/\D/g, '')))];
    const campaignId = `camp_${Date.now()}`;

    logger.info(
      `Disparando campanha ${campaignId} para ${uniqueNumbers.length} contato(s) usando ${availableSessions.length} chip(s) com intervalo anti-spam de ${intervalSeconds}s`
    );

    // Prepara jobs BullMQ para execução estruturada e escalonada contra spam
    const jobsData: { name: string; data: DispatchJobData; opts?: any }[] = uniqueNumbers.map((number, idx) => {
      const activeSession = availableSessions[idx % availableSessions.length];
      const stepIndex = Math.floor(idx / Math.max(1, availableSessions.length));
      return {
        name: `send-${number}`,
        data: {
          campaignId,
          number,
          message,
          image: media,
          sessionId: activeSession.id,
          chipName: activeSession.name,
          delayMs,
        },
        opts: {
          delay: stepIndex * delayMs,
        },
      };
    });

    // Enfileira em lote no BullMQ
    const enqueuedJobs = await dispatchQueue.addBulk(jobsData);

    // Processa os jobs e acumula resultados para retornar à UI sem travamento
    const waitTimeoutMs = Math.max(90000, Math.ceil(uniqueNumbers.length / Math.max(1, availableSessions.length)) * delayMs + 30000);
    const results: DispatchResult[] = [];
    for (const job of enqueuedJobs) {
      try {
        const res = await job.waitUntilFinished(dispatchQueueEvents, waitTimeoutMs);
        results.push(res);
      } catch (err: any) {
        results.push({
          number: job.data.number,
          chatId: `${job.data.number}@c.us`,
          status: 'falha',
          chip: job.data.chipName,
          error: err.message,
        });
      }
    }

    const enviados = results.filter((r) => r.status === 'enviado').length;
    const falhas = results.filter((r) => r.status === 'falha').length;

    return {
      total: results.length,
      enviados,
      falhas,
      results,
    };
  });

  // Inicialização do servidor Fastify
  try {
    await server.listen({ port: config.PORT, host: config.HOST });
    logger.info(`🚀 Servidor Fastify rodando na porta ${config.PORT} (${config.HOST})`);
    logger.info(`✨ Stack ativa: Fastify + Baileys + BullMQ + Redis`);

    // Inicia sessão default automaticamente
    const defSession = baileysManager.getSession('default');
    if (defSession) {
      baileysManager.connectSession('default').catch((err) => {
        logger.error({ err: err.message }, 'Falha no boot da sessão default');
      });
    }
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

main();

// Graceful Shutdown
const shutdown = async () => {
  logger.info('Encerrando servidor...');
  await server.close();
  await dispatchQueueEvents.close();
  await dispatchQueue.close();
  await redis.quit();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
