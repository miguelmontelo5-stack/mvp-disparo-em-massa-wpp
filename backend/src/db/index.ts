import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import pino from 'pino';
import { config } from '../config.js';
import * as schema from './schema.js';

const logger = pino({ name: 'db', level: config.LOG_LEVEL });

let sqlClient: ReturnType<typeof postgres> | null = null;
let dbInstance: ReturnType<typeof drizzle> | null = null;

try {
  sqlClient = postgres(config.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
    onnotice: () => {},
  });

  dbInstance = drizzle(sqlClient, { schema });
  logger.info('Cliente PostgreSQL inicializado com sucesso.');
} catch (err: any) {
  logger.warn({ err: err.message }, 'PostgreSQL indisponível temporariamente. O backend continuará em modo resiliente.');
}

export const db = dbInstance;
export { schema };
