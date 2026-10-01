import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import pino from 'pino';
import { config } from './config.js';
import type { UserRole, SafeUser } from './auth/userManager.js';

const logger = pino({ name: 'supabase-auth', level: config.LOG_LEVEL });

export const ADMIN_EMAIL = 'disparomassa21@gmail.com';
export const ADMIN_DEFAULT_PASS = 'abc12345';

let supabaseClient: SupabaseClient | null = null;

if (config.SUPABASE_URL && (config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_ANON_KEY)) {
  const key = config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_ANON_KEY;
  supabaseClient = createClient(config.SUPABASE_URL, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  logger.info('Supabase client inicializado para autenticação e RBAC.');
} else {
  logger.warn('SUPABASE_URL ou chaves não configuradas no backend. Operando com autenticação local de contingência.');
}

export function getSupabase(): SupabaseClient | null {
  return supabaseClient;
}

/**
 * Garante que o administrador padrão (disparomassa21@gmail.com / abc12345)
 * exista no Supabase Auth com privilégios de ADMIN.
 */
export async function ensureSupabaseAdminUser(): Promise<void> {
  if (!supabaseClient || !config.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  try {
    const { data: usersData, error: listError } = await supabaseClient.auth.admin.listUsers();
    if (listError) {
      logger.warn({ err: listError.message }, 'Não foi possível listar usuários do Supabase no startup.');
      return;
    }

    const existingAdmin = usersData.users.find(
      (u) => u.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase()
    );

    if (!existingAdmin) {
      logger.info(`Criando usuário administrador padrão no Supabase (${ADMIN_EMAIL})...`);
      const { data: created, error: createError } = await supabaseClient.auth.admin.createUser({
        email: ADMIN_EMAIL,
        password: ADMIN_DEFAULT_PASS,
        email_confirm: true,
        user_metadata: {
          role: 'ADMIN',
          name: 'Administrador Master',
          full_name: 'Administrador Master',
        },
      });

      if (createError) {
        logger.error({ err: createError.message }, 'Falha ao criar admin no Supabase');
      } else {
        logger.info(`Admin criado no Supabase com sucesso (ID: ${created.user.id}).`);
      }
    } else {
      // Garante que o role nos metadados seja ADMIN
      const currentRole = existingAdmin.user_metadata?.role;
      if (currentRole !== 'ADMIN') {
        logger.info(`Atualizando role do administrador para ADMIN no Supabase...`);
        await supabaseClient.auth.admin.updateUserById(existingAdmin.id, {
          user_metadata: {
            ...existingAdmin.user_metadata,
            role: 'ADMIN',
          },
        });
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Erro ao sincronizar administrador padrão no Supabase.');
  }
}

/**
 * Valida o JWT do Supabase ou token Bearer e retorna os dados do usuário e sua Role.
 */
export async function authenticateRequestUser(
  tokenOrId: string
): Promise<SafeUser | null> {
  if (!tokenOrId) return null;

  // 1. Se temos Supabase configurado, tentamos validar como JWT via Supabase Auth
  if (supabaseClient) {
    try {
      const { data: authData, error } = await supabaseClient.auth.getUser(tokenOrId);
      if (!error && authData?.user) {
        const u = authData.user;
        const email = u.email || '';
        const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
        const role: UserRole = isAdmin
          ? 'ADMIN'
          : (u.user_metadata?.role as UserRole) || 'OPERATOR';

        const name =
          u.user_metadata?.name ||
          u.user_metadata?.full_name ||
          (isAdmin ? 'Administrador Master' : email.split('@')[0]);

        return {
          id: u.id,
          name,
          email,
          role,
          createdAt: u.created_at,
          updatedAt: u.updated_at || u.created_at,
        };
      }
    } catch (e: any) {
      logger.debug({ err: e.message }, 'Tentativa de validação de token via Supabase falhou.');
    }
  }

  return null;
}
