import IORedis, { Redis } from 'ioredis';
import pino from 'pino';
import { config } from './config.js';

const logger = pino({ name: 'redis', level: config.LOG_LEVEL });

const RedisClientClass = (IORedis as any).default || IORedis;

export const redis: Redis = new RedisClientClass(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times: number) {
    const delay = Math.min(times * 100, 3000);
    logger.warn(`Redis desconectado. Tentando reconectar em ${delay}ms (tentativa ${times})...`);
    return delay;
  },
});

redis.on('connect', () => {
  logger.info('Conexão com Redis estabelecida com sucesso.');
});

redis.on('error', (err: any) => {
  logger.error({ err: err.message }, 'Erro no cliente Redis');
});

// Cache e Locks distribuídos
export const RedisService = {
  async setSession(sessionId: string, data: Record<string, any>, ttlSeconds = 86400) {
    try {
      await redis.set(`session:${sessionId}:state`, JSON.stringify(data), 'EX', ttlSeconds);
    } catch (err: any) {
      logger.warn({ err: err.message }, `Falha ao salvar sessão ${sessionId} no Redis`);
    }
  },

  async getSession(sessionId: string): Promise<Record<string, any> | null> {
    try {
      const data = await redis.get(`session:${sessionId}:state`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async deleteSession(sessionId: string) {
    try {
      await redis.del(`session:${sessionId}:state`);
      await redis.del(`session:${sessionId}:contacts`);
      await redis.del(`session:${sessionId}:lock`);
    } catch (err: any) {
      logger.warn({ err: err.message }, `Falha ao deletar dados de sessão ${sessionId}`);
    }
  },

  async setContacts(sessionId: string, contacts: any[], ttlSeconds = 600) {
    try {
      await redis.set(`session:${sessionId}:contacts`, JSON.stringify(contacts), 'EX', ttlSeconds);
    } catch {}
  },

  async getContacts(sessionId: string): Promise<any[] | null> {
    try {
      const data = await redis.get(`session:${sessionId}:contacts`);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  /**
   * Lock distribuído atômico usando SET NX EX
   */
  async acquireLock(lockKey: string, ttlSeconds = 30): Promise<boolean> {
    try {
      const res = await redis.set(`lock:${lockKey}`, '1', 'EX', ttlSeconds, 'NX');
      return res === 'OK';
    } catch {
      return true; // Se redis falhar, prossegue
    }
  },

  async releaseLock(lockKey: string): Promise<void> {
    try {
      await redis.del(`lock:${lockKey}`);
    } catch {}
  },

  /**
   * Rate Limiter com janela deslizante simples
   */
  async checkRateLimit(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
    try {
      const current = await redis.incr(`ratelimit:${key}`);
      if (current === 1) {
        await redis.expire(`ratelimit:${key}`, windowSeconds);
      }
      return current <= limit;
    } catch {
      return true;
    }
  },
};
