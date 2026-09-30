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

  // POST /api/sessions — Cria uma nova sessão
  server.post('/api/sessions', async (req, reply) => {
    const body = (req.body as any) || {};
    const name = body.name;
    const session = baileysManager.createSession(name);
    reply.status(201);
    return { session: session.toJSON() };
  });

  // DELETE /api/sessions/:sessionId — Remove uma sessão
  server.delete('/api/sessions/:sessionId', async (req, reply) => {
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

  // POST /api/connect — Inicia conexão/pareamento
  server.post('/api/connect', async (req) => {
    const { force, sessionId = 'default' } = (req.body as any) || {};
    const session = await baileysManager.connectSession(sessionId, force);
    return { ok: true, status: session.status, session: session.toJSON() };
  });

  // POST /api/disconnect — Desconecta sessão
  server.post('/api/disconnect', async (req, reply) => {
    const body = (req.body as any) || {};
    const query = (req.query as any) || {};
    const sessionId = body.sessionId || query.sessionId || 'default';

    const session = await baileysManager.disconnectSession(sessionId);
    if (!session) {
      return reply.status(404).send({ error: 'Sessão não encontrada.' });
    }

    return { ok: true, status: 'desconectado', session: session.toJSON() };
  });

  // GET /api/contacts — Contatos da sessão conectada (com cache no Redis)
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

    // Tenta pegar do Redis
    if (!forceRefresh) {
      const cached = await RedisService.getContacts(session.id);
      if (cached && cached.length > 0) {
        return { contacts: cached, cached: true };
      }
    }

    // Contatos sincronizados pelo Baileys
    const contactsList = Array.from(session.contacts.values()).sort((a, b) =>
      a.nomeCompleto.localeCompare(b.nomeCompleto, 'pt-BR')
    );

    // Salva no Redis
    if (contactsList.length > 0) {
      await RedisService.setContacts(session.id, contactsList, 600);
    }

    return { contacts: contactsList };
  });

  // POST /api/send — Disparo em massa via BullMQ + Redis com Round-Robin Multi-Chip
  server.post('/api/send', async (req, reply) => {
    const sendSchema = z.object({
      numbers: z.array(z.string()).min(1, 'Pelo menos um número deve ser informado.'),
      message: z.string().min(1, 'Mensagem é obrigatória.'),
      image: z.string().nullable().optional(),
      imageBase64: z.string().nullable().optional(),
      sessionId: z.string().optional(),
    });

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0].message });
    }

    const { numbers, message, image, imageBase64, sessionId } = parsed.data;
    const media = image || imageBase64 || null;

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
      `Disparando campanha ${campaignId} para ${uniqueNumbers.length} contato(s) usando ${availableSessions.length} chip(s) (${availableSessions.map((s) => s.name).join(', ')})`
    );

    // Prepara jobs BullMQ para execução estruturada e resiliente
    const jobsData: { name: string; data: DispatchJobData }[] = uniqueNumbers.map((number, idx) => {
      const activeSession = availableSessions[idx % availableSessions.length];
      return {
        name: `send-${number}`,
        data: {
          campaignId,
          number,
          message,
          image: media,
          sessionId: activeSession.id,
          chipName: activeSession.name,
        },
      };
    });

    // Enfileira em lote no BullMQ
    const enqueuedJobs = await dispatchQueue.addBulk(jobsData);

    // Processa os jobs e acumula resultados para retornar à UI sem travamento
    const results: DispatchResult[] = [];
    for (const job of enqueuedJobs) {
      try {
        const res = await job.waitUntilFinished(dispatchQueueEvents, 60000);
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
