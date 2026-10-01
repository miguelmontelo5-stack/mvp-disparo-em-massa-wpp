import { Queue, Worker, QueueEvents, type Job } from 'bullmq';
import pino from 'pino';
import { config } from '../config.js';
import { redis, RedisService } from '../redis.js';
import { baileysManager } from '../whatsapp/baileysManager.js';

const logger = pino({ name: 'bullmq-dispatch', level: config.LOG_LEVEL });

export interface DispatchJobData {
  campaignId: string;
  number: string;
  message: string;
  image?: string | null;
  sessionId: string;
  chipName: string;
  delayMs?: number;
}

export interface DispatchResult {
  number: string;
  chatId: string;
  status: 'enviado' | 'falha';
  chip: string;
  error?: string;
}

// Fila BullMQ
export const dispatchQueue = new Queue<DispatchJobData, DispatchResult>('campaign-dispatch', {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 500 },
  },
});

export const dispatchQueueEvents = new QueueEvents('campaign-dispatch', {
  connection: redis,
});

// Worker para processamento assíncrono e controlado
export const dispatchWorker = new Worker<DispatchJobData, DispatchResult>(
  'campaign-dispatch',
  async (job: Job<DispatchJobData, DispatchResult>) => {
    const { campaignId, number, message, image, sessionId, chipName, delayMs } = job.data;
    const digits = number.replace(/\D/g, '');
    const chatId = `${digits}@c.us`;

    logger.info(`[Job ${job.id}] Enviando para ${digits} via chip ${chipName} (${sessionId})...`);

    // Adquire lock por sessão para garantir exclusão mútua por chip
    const lockKey = `session:${sessionId}`;
    const acquired = await RedisService.acquireLock(lockKey, 15);

    try {
      const res = await baileysManager.sendMessage(sessionId, digits, message, image);

      if (!res.ok) {
        throw new Error(res.error || 'Falha ao enviar mensagem');
      }

      logger.info(`[Job ${job.id}] Sucesso para ${digits} via ${chipName}`);
      return {
        number: digits,
        chatId,
        status: 'enviado',
        chip: chipName,
      };
    } catch (err: any) {
      logger.error(`[Job ${job.id}] Falha para ${digits}: ${err.message}`);
      return {
        number: digits,
        chatId,
        status: 'falha',
        chip: chipName,
        error: err.message,
      };
    } finally {
      if (acquired) {
        await RedisService.releaseLock(lockKey);
      }
      // Intervalo de segurança anti-spam com variação humana (jitter)
      const baseDelay = delayMs && delayMs >= 1000 ? delayMs : (config.SEND_DELAY_MS || 4000);
      const jitter = Math.floor(Math.random() * (baseDelay * 0.25));
      const actualDelay = baseDelay + jitter;
      logger.info(`[Anti-Spam] Pausa de ${(actualDelay / 1000).toFixed(1)}s no chip ${chipName} para evitar bloqueios...`);
      await new Promise((r) => setTimeout(r, actualDelay));
    }
  },
  {
    connection: redis,
    concurrency: 5, // Processa até 5 envios concorrentes respeitando os locks por chip
  }
);

dispatchWorker.on('completed', (job, returnvalue) => {
  logger.debug({ jobId: job.id, result: returnvalue }, 'Job concluído com sucesso');
});

dispatchWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, 'Job falhou na fila BullMQ');
});
