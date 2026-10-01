import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const ADMIN_EMAIL = 'disparomassa21@gmail.com';
export const ADMIN_DEFAULT_PASS = 'abc12345';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http') &&
  !supabaseUrl.includes('seu-projeto')
);

export const supabase: SupabaseClient = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : (null as unknown as SupabaseClient);

export interface AuthUserProfile {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  token: string;
}

/**
 * Autentica usuário via Supabase Auth (ou fallback local de desenvolvimento)
 */
export async function loginUser(email: string, pass: string): Promise<AuthUserProfile> {
  const cleanEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password: pass,
    });

    if (error) {
      throw new Error(error.message || 'Falha ao autenticar.');
    }

    if (!data.user || !data.session) {
      throw new Error('Sessão de usuário não retornada.');
    }

    const isAdmin = cleanEmail === ADMIN_EMAIL.toLowerCase();
    const role = isAdmin
      ? 'ADMIN'
      : (data.user.user_metadata?.role as 'ADMIN' | 'OPERATOR' | 'VIEWER') || 'OPERATOR';

    const name =
      data.user.user_metadata?.name ||
      data.user.user_metadata?.full_name ||
      (isAdmin ? 'Administrador Master' : cleanEmail.split('@')[0]);

    return {
      id: data.user.id,
      email: data.user.email || cleanEmail,
      name,
      role,
      token: data.session.access_token,
    };
  }

  // Fallback dev local (quando Supabase Cloud ainda não foi preenchido com credenciais reais)
  if (cleanEmail === ADMIN_EMAIL.toLowerCase() && pass === ADMIN_DEFAULT_PASS) {
    const devUser: AuthUserProfile = {
      id: 'usr_admin_supabase_01',
      email: ADMIN_EMAIL,
      name: 'Administrador Master',
      role: 'ADMIN',
      token: 'mock-jwt-admin-token',
    };
    localStorage.setItem('dlm_supabase_session', JSON.stringify(devUser));
    return devUser;
  }

  // Verifica no backend se há usuário registrado localmente
  const apiBase = import.meta.env.VITE_API_BASE ?? '';
  try {
    const res = await fetch(`${apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: cleanEmail, password: pass }),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Credenciais inválidas');
    const userProfile: AuthUserProfile = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      token: result.token || result.user.id,
    };
    localStorage.setItem('dlm_supabase_session', JSON.stringify(userProfile));
    return userProfile;
  } catch (err: any) {
    throw new Error(err.message || 'Credenciais inválidas.');
  }
}

/**
 * Cadastra novo usuário via Supabase Auth (ou fallback de desenvolvimento)
 */
export async function registerNewUser(
  email: string,
  pass: string,
  name: string
): Promise<AuthUserProfile> {
  const cleanEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signUp({
      email: cleanEmail,
      password: pass,
      options: {
        data: {
          name,
          full_name: name,
          role: 'OPERATOR', // Usuários comuns entram como OPERATOR
        },
      },
    });

    if (error) {
      throw new Error(error.message || 'Falha ao cadastrar usuário.');
    }

    if (!data.user) {
      throw new Error('Falha ao criar usuário.');
    }

    const token = data.session?.access_token || 'pending_confirmation';
    return {
      id: data.user.id,
      email: data.user.email || cleanEmail,
      name,
      role: 'OPERATOR',
      token,
    };
  }

  // Fallback dev local via backend
  const apiBase = import.meta.env.VITE_API_BASE ?? '';
  const res = await fetch(`${apiBase}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: cleanEmail, password: pass, role: 'OPERATOR' }),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Erro ao cadastrar');
  const userProfile: AuthUserProfile = {
    id: result.user.id,
    email: result.user.email,
    name: result.user.name,
    role: result.user.role,
    token: result.token || result.user.id,
  };
  localStorage.setItem('dlm_supabase_session', JSON.stringify(userProfile));
  return userProfile;
}

/**
 * Logout
 */
export async function logoutUser(): Promise<void> {
  if (isSupabaseConfigured && supabase) {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.warn('Erro ao deslogar do Supabase:', e);
    }
  }
  localStorage.removeItem('dlm_supabase_session');
  localStorage.removeItem('dlm_current_user');
}
