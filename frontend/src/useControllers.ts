import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mockConnection,
  type ConnectionState,
  type Contact,
  type DispatchLog,
  type SessionItem,
  type User,
  type UserRole,
} from './mockData';
import { logoutUser } from './lib/supabase';

/** Em dev o Vite encaminha /api para o Express na 3001. */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

export function getAuthHeaders(userId?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (userId) {
    headers['x-user-id'] = userId;
  }
  const sessionStr = localStorage.getItem('dlm_supabase_session');
  if (sessionStr) {
    try {
      const session = JSON.parse(sessionStr);
      if (session?.token) {
        headers['Authorization'] = `Bearer ${session.token}`;
      }
      if (!headers['x-user-id'] && session?.id) {
        headers['x-user-id'] = session.id;
      }
    } catch {
      // ignore
    }
  }
  return headers;
}

type ApiStatus = {
  status?: ConnectionState['status'];
  qrCode?: string | null;
  error?: string | null;
  info?: {
    pushname?: string;
    phone?: string;
  } | null;
  sessions?: SessionItem[];
};

function applyApiStatus(current: ConnectionState, data: ApiStatus): ConnectionState {
  const currentActiveId = current.activeSessionId || 'default';
  const incomingSessions: SessionItem[] = Array.isArray(data.sessions) && data.sessions.length > 0
    ? data.sessions
    : current.sessions;

  // Busca a sessão ativa entre as sessões recebidas
  const activeSess = incomingSessions.find((s) => s.id === currentActiveId) || incomingSessions[0];

  const nextStatus = activeSess ? activeSess.status : (data.status ?? 'desconectado');
  const qrFromApi = activeSess ? (activeSess.qrCode || '') : (typeof data.qrCode === 'string' ? data.qrCode : '');

  const keepPreviousQr =
    nextStatus === 'aguardando_qr' &&
    qrFromApi.length === 0 &&
    current.status === 'aguardando_qr' &&
    Boolean(current.qrCode);

  return {
    ...current,
    status: nextStatus,
    qrCode:
      nextStatus === 'aguardando_qr'
        ? qrFromApi || (keepPreviousQr ? current.qrCode : null)
        : null,
    telefone:
      nextStatus === 'conectado'
        ? (activeSess?.telefone || data.info?.phone || current.telefone)
        : '',
    error: activeSess?.error || data.error || null,
    conectadoEm:
      nextStatus === 'conectado'
        ? current.conectadoEm ?? new Date().toISOString()
        : null,
    sessions: incomingSessions,
    activeSessionId: activeSess ? activeSess.id : currentActiveId,
  };
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function useAuth() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    try {
      const supaSaved = localStorage.getItem('dlm_supabase_session');
      if (supaSaved) return JSON.parse(supaSaved);
      const saved = localStorage.getItem('dlm_current_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [users, setUsers] = useState<User[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);

  const logout = useCallback(async () => {
    await logoutUser();
    setCurrentUser(null);
  }, []);

  const fetchUsers = useCallback(async () => {
    if (!currentUser) return;
    setIsLoadingUsers(true);
    try {
      const headers = getAuthHeaders(currentUser?.id);
      const res = await fetch(`${API_BASE}/api/users`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
        if (currentUser && data.users) {
          // Mantém sincronizado se a role mudou no backend
          const updatedSelf = data.users.find(
            (u: User) => u.id === currentUser.id || u.email.toLowerCase() === currentUser.email.toLowerCase()
          );
          if (updatedSelf && updatedSelf.role !== currentUser.role) {
            const updated = { ...currentUser, role: updatedSelf.role };
            setCurrentUser(updated);
            localStorage.setItem('dlm_supabase_session', JSON.stringify(updated));
          }
        }
      }
    } catch (err) {
      console.error('Erro ao carregar usuários:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      void fetchUsers();
    }
  }, [currentUser, fetchUsers]);

  const switchActiveUser = useCallback((user: User) => {
    setCurrentUser(user);
    localStorage.setItem('dlm_supabase_session', JSON.stringify(user));
  }, []);

  const registerUser = useCallback(async (name: string, email: string, role?: UserRole) => {
    const headers: Record<string, string> = {
      ...getAuthHeaders(currentUser?.id),
      'Content-Type': 'application/json',
    };
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, email, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar usuário');
    await fetchUsers();
    return data.user as User;
  }, [currentUser?.id, fetchUsers]);

  const updateRole = useCallback(async (userId: string, newRole: UserRole) => {
    const headers: Record<string, string> = {
      ...getAuthHeaders(currentUser?.id),
      'Content-Type': 'application/json',
    };
    const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}/role`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ role: newRole }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao alterar permissão');
    await fetchUsers();
    if (currentUser?.id === userId) {
      const updated = { ...currentUser, role: newRole };
      setCurrentUser(updated);
      localStorage.setItem('dlm_supabase_session', JSON.stringify(updated));
    }
    return data.user as User;
  }, [currentUser, fetchUsers]);

  const deleteUser = useCallback(async (userId: string) => {
    const headers = getAuthHeaders(currentUser?.id);
    const res = await fetch(`${API_BASE}/api/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao excluir usuário');
    await fetchUsers();
  }, [currentUser?.id, fetchUsers]);

  return {
    currentUser,
    setCurrentUser,
    logout,
    users,
    isLoadingUsers,
    switchActiveUser,
    registerUser,
    updateRole,
    deleteUser,
    refreshUsers: fetchUsers,
  };
}

export function useWhatsAppConnection(currentUserId?: string) {
  const [connection, setConnection] =
    useState<ConnectionState>(mockConnection);

  const selecionarSessao = useCallback((sessionId: string) => {
    setConnection((current) => {
      const target = current.sessions.find((s) => s.id === sessionId);
      if (!target) return current;
      return {
        ...current,
        activeSessionId: sessionId,
        status: target.status,
        qrCode: target.qrCode || null,
        telefone: target.telefone || '',
        error: target.error || null,
      };
    });
  }, []);

  const iniciarPareamento = useCallback(async (force = false, targetSessionId?: string) => {
    let sessId = targetSessionId;
    setConnection((currentConnection) => {
      sessId = sessId || currentConnection.activeSessionId || 'default';
      const updatedSessions = currentConnection.sessions.map((s) =>
        s.id === sessId ? { ...s, status: 'conectando' as const, error: null } : s
      );
      return {
        ...currentConnection,
        status: 'conectando',
        conectadoEm: null,
        error: null,
        sessions: updatedSessions,
      };
    });

    try {
      const headers: Record<string, string> = {
        ...getAuthHeaders(currentUserId),
        'Content-Type': 'application/json',
      };
      const res = await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ force, sessionId: sessId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnection((c) => ({ ...c, error: data.error || 'Acesso negado ou erro ao conectar.' }));
      }
    } catch {
      setConnection((currentConnection) => ({
        ...currentConnection,
        status: 'desconectado',
        error: 'Não foi possível falar com o backend.',
      }));
    }
  }, [currentUserId]);

  const desconectar = useCallback(async (targetSessionId?: string) => {
    let sessId = targetSessionId;
    setConnection((currentConnection) => {
      sessId = sessId || currentConnection.activeSessionId || 'default';
      const updatedSessions = currentConnection.sessions.map((s) =>
        s.id === sessId ? { ...s, status: 'desconectado' as const, qrCode: null, error: null } : s
      );
      return {
        ...currentConnection,
        status: 'desconectado',
        conectadoEm: null,
        qrCode: null,
        error: null,
        sessions: updatedSessions,
      };
    });

    try {
      const headers: Record<string, string> = {
        ...getAuthHeaders(currentUserId),
        'Content-Type': 'application/json',
      };
      const res = await fetch(`${API_BASE}/api/disconnect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId: sessId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setConnection((c) => ({ ...c, error: data.error || 'Acesso negado para desconectar (apenas ADMIN).' }));
      }
    } catch {
      setConnection((currentConnection) => ({
        ...currentConnection,
        error: 'Não foi possível desconectar no backend.',
      }));
    }
  }, [currentUserId]);

  const adicionarSessao = useCallback(async (name?: string) => {
    try {
      const headers: Record<string, string> = {
        ...getAuthHeaders(currentUserId),
        'Content-Type': 'application/json',
      };
      const res = await fetch(`${API_BASE}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.session) {
          setConnection((current) => ({
            ...current,
            sessions: [...current.sessions.filter((s) => s.id !== data.session.id), data.session],
            activeSessionId: data.session.id,
            status: data.session.status,
            qrCode: data.session.qrCode,
            telefone: data.session.telefone || '',
            error: null,
          }));
        }
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Apenas administradores podem cadastrar novos chips.');
      }
    } catch (err) {
      console.error('Erro ao adicionar sessão:', err);
    }
  }, [currentUserId]);

  const removerSessao = useCallback(async (sessionId: string) => {
    try {
      const headers = getAuthHeaders(currentUserId);
      const res = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) {
        setConnection((current) => {
          const remaining = current.sessions.filter((s) => s.id !== sessionId);
          const nextActive = remaining[0]?.id || 'default';
          const target = remaining[0];
          return {
            ...current,
            sessions: remaining,
            activeSessionId: nextActive,
            status: target ? target.status : 'desconectado',
            qrCode: target ? target.qrCode || null : null,
            telefone: target ? target.telefone || '' : '',
          };
        });
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.error || 'Apenas administradores podem excluir chips.');
      }
    } catch (err) {
      console.error('Erro ao remover sessão:', err);
    }
  }, [currentUserId]);

  useEffect(() => {
    let cancelled = false;
    let failCount = 0;

    function ingest(data: ApiStatus) {
      failCount = 0;
      setConnection((currentConnection) => applyApiStatus(currentConnection, data));
    }

    async function pollStatus() {
      try {
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) {
          throw new Error('Falha ao consultar status');
        }

        const data = (await response.json()) as ApiStatus;
        if (!cancelled) {
          ingest(data);
        }
      } catch {
        if (cancelled) {
          return;
        }

        failCount += 1;
        if (failCount < 3) {
          return;
        }

        setConnection((currentConnection) => ({
          ...currentConnection,
          error: currentConnection.error || 'Backend indisponível. Verifique se o servidor na porta 3001 está no ar.',
        }));
      }
    }

    const source = new EventSource(`${API_BASE}/api/events`);
    source.onmessage = (event) => {
      try {
        ingest(JSON.parse(event.data) as ApiStatus);
      } catch {
        // snapshot malformado — o poll cobre
      }
    };

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 4_000);

    return () => {
      cancelled = true;
      source.close();
      window.clearInterval(intervalId);
    };
  }, []);

  return {
    connection,
    selecionarSessao,
    iniciarPareamento,
    desconectar,
    adicionarSessao,
    removerSessao,
  };
}

export function useWhatsAppContacts(status: ConnectionState['status'], sessionId?: string) {
  const [fetchedContacts, setFetchedContacts] = useState<Contact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  const loadContacts = useCallback(async (force = false) => {
    if (status !== 'conectado') {
      setFetchedContacts([]);
      return;
    }

    setIsLoadingContacts(true);
    try {
      const base = sessionId
        ? `${API_BASE}/api/contacts?sessionId=${encodeURIComponent(sessionId)}`
        : `${API_BASE}/api/contacts`;
      const url = force ? `${base}${base.includes('?') ? '&' : '?'}refresh=1` : base;
      const response = await fetch(url, { headers: getAuthHeaders() });
      if (!response.ok) throw new Error('Falha ao carregar contatos');
      const data = (await response.json()) as { contacts?: Contact[] };
      setFetchedContacts(data.contacts ?? []);
    } catch {
      setFetchedContacts([]);
    } finally {
      setIsLoadingContacts(false);
    }
  }, [status, sessionId]);

  useEffect(() => {
    void loadContacts(false);
  }, [loadContacts]);

  return {
    contacts: status === 'conectado' ? fetchedContacts : [],
    isLoadingContacts,
    refreshContacts: () => loadContacts(true),
  };
}


type CampaignType = DispatchLog['tipo'];

type MassPayload = {
  numbers: string[];
  message: string;
  imageFile: File | null;
  contacts?: Contact[];
  sessionId?: string;
  intervalSeconds?: number;
};

export function useCampaignManager(currentUserId?: string) {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const isSendingRef = useRef(false);

  const dispararCampanha = useCallback(
    async (
      tipo: CampaignType,
      destino: string,
      payload?: MassPayload,
    ): Promise<{ success: boolean; message: string; enviados?: number; falhas?: number }> => {
      if (isSendingRef.current || !destino.trim()) {
        return { success: false, message: 'Destino ou mensagem inválidos.' };
      }
      isSendingRef.current = true;

      const numbers = payload?.numbers?.length ? payload.numbers : [destino.trim()];
      const message = payload?.message?.trim() || destino.trim();
      const contactsMap = new Map(
        (payload?.contacts ?? []).map((c) => [c.telefone, c.nomeCompleto])
      );

      setIsSending(true);
      setProgress(20);

      try {
        let imageBase64: string | null = null;
        if (payload?.imageFile) {
          imageBase64 = await fileToBase64(payload.imageFile);
        }

        setProgress(45);

        const headers: Record<string, string> = {
          ...getAuthHeaders(currentUserId),
          'Content-Type': 'application/json',
        };

        const response = await fetch(`${API_BASE}/api/send`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            numbers,
            message,
            image: imageBase64,
            sessionId: payload?.sessionId || 'auto',
            intervalSeconds: payload?.intervalSeconds ?? 5,
          }),
        });

        const data = (await response.json()) as {
          total?: number;
          enviados?: number;
          falhas?: number;
          error?: string;
          results?: Array<{ number: string; status: 'enviado' | 'falha'; chip?: string; error?: string }>;
        };

        if (!response.ok) {
          return {
            success: false,
            message: data.error || `Erro HTTP ${response.status}: Permissão negada ou falha no disparo.`,
          };
        }

        setProgress(100);

        const now = new Date().toISOString();

        if (data.results && data.results.length > 0) {
          const newLogs: DispatchLog[] = data.results.map((r, i) => ({
            id: `log-${Date.now()}-${i}`,
            tipo,
            destinatario: (contactsMap.get(r.number) ?? r.number) + (r.chip ? ` (${r.chip})` : ''),
            horario: now,
            resultado: r.status === 'enviado' ? 'sucesso' : 'falha',
          }));
          setLogs((prev) => [...newLogs, ...prev]);

          if (data.falhas && data.falhas > 0 && data.enviados === 0) {
            const firstErr = data.results.find((r) => r.status === 'falha')?.error;
            return {
              success: false,
              message: firstErr || 'Falha ao enviar mensagem pelo WhatsApp.',
              enviados: data.enviados,
              falhas: data.falhas,
            };
          }

          const chipInfo = data.results[0]?.chip ? ` via ${data.results[0].chip}` : '';
          return {
            success: true,
            message: `Mensagem enviada com sucesso${chipInfo}!`,
            enviados: data.enviados,
            falhas: data.falhas,
          };
        } else {
          const ok = response.ok && !data.error;
          setLogs((prev) => [
            { id: `log-${Date.now()}`, tipo, destinatario: destino.trim(), horario: now, resultado: ok ? 'sucesso' : 'falha' },
            ...prev,
          ]);

          return {
            success: ok,
            message: ok ? 'Mensagem enviada com sucesso!' : data.error || 'Erro ao processar envio.',
          };
        }
      } catch (err: any) {
        setLogs((prev) => [
          { id: `log-${Date.now()}`, tipo, destinatario: destino.trim(), horario: new Date().toISOString(), resultado: 'falha' },
          ...prev,
        ]);
        return {
          success: false,
          message: err?.message || 'Falha de comunicação com o servidor.',
        };
      } finally {
        window.setTimeout(() => {
          isSendingRef.current = false;
          setIsSending(false);
          setProgress(0);
        }, 400);
      }
    },
    [currentUserId],
  );

  return {
    logs,
    isSending,
    progress,
    dispararCampanha,
  };
}
