import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5433/disparo_massa'),
  AUTH_DIR: z.string().default(path.resolve(__dirname, '../../auth_sessions')),
  SEND_DELAY_MS: z.coerce.number().default(800),
  LOG_LEVEL: z.string().default('info'),
  SUPABASE_URL: z.string().optional().default(''),
  SUPABASE_ANON_KEY: z.string().optional().default(''),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default(''),
  CORS_ORIGIN: z.string().default('*'),
});

export const config = envSchema.parse({
  PORT: process.env.PORT,
  HOST: process.env.HOST,
  REDIS_URL: process.env.REDIS_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_DIR: process.env.AUTH_DIR,
  SEND_DELAY_MS: process.env.SEND_DELAY_MS,
  LOG_LEVEL: process.env.LOG_LEVEL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
});
