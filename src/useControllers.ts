import { useCallback, useEffect, useRef, useState } from 'react';

import {
  mockConnection,
  type ConnectionState,
  type Contact,
  type DispatchLog,
} from './mockData';

/** Em dev o Vite encaminha /api para o Express na 3001. */
const API_BASE = import.meta.env.VITE_API_BASE ?? '';

type ApiStatus = {
  status?: ConnectionState['status'];
  qrCode?: string | null;
  error?: string | null;
  info?: {
    pushname?: string;
    phone?: string;
  } | null;
};

function applyApiStatus(current: ConnectionState, data: ApiStatus): ConnectionState {
  const nextStatus = data.status ?? 'desconectado';
  const qrFromApi = typeof data.qrCode === 'string' ? data.qrCode : '';
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
        ? data.info?.phone || current.telefone
        : '',
    error: data.error ?? null,
    conectadoEm:
      nextStatus === 'conectado'
        ? current.conectadoEm ?? new Date().toISOString()
        : null,
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

export function useWhatsAppConnection() {
  const [connection, setConnection] =
    useState<ConnectionState>(mockConnection);

  const iniciarPareamento = useCallback(async (force = false) => {
    setConnection((currentConnection) => ({
      ...currentConnection,
      status: 'conectando',
      conectadoEm: null,
      error: null,
    }));

    try {
      await fetch(`${API_BASE}/api/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      });
    } catch {
      setConnection((currentConnection) => ({
        ...currentConnection,
        status: 'desconectado',
        error: 'Nao foi possivel falar com o backend.',
      }));
    }
  }, []);

  const desconectar = useCallback(async () => {
    setConnection((currentConnection) => ({
      ...currentConnection,
      status: 'desconectado',
      conectadoEm: null,
      qrCode: null,
      error: null,
    }));

    try {
      await fetch(`${API_BASE}/api/disconnect`, { method: 'POST' });
    } catch {
      setConnection((currentConnection) => ({
        ...currentConnection,
        error: 'Nao foi possivel desconectar no backend.',
      }));
    }
  }, []);

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
          error: currentConnection.error || 'Backend indisponivel. Verifique se o servidor na porta 3001 esta no ar.',
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
    iniciarPareamento,
    desconectar,
  };
}

export function useWhatsAppContacts(status: ConnectionState['status']) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  useEffect(() => {
    if (status !== 'conectado') {
      setContacts([]);
      return undefined;
    }

    let cancelled = false;
    setIsLoadingContacts(true);

    async function loadContacts() {
      try {
        const response = await fetch(`${API_BASE}/api/contacts`);
        if (!response.ok) throw new Error('Falha ao carregar contatos');
        const data = (await response.json()) as { contacts?: Contact[] };
        if (!cancelled) setContacts(data.contacts ?? []);
      } catch {
        if (!cancelled) setContacts([]);
      } finally {
        if (!cancelled) setIsLoadingContacts(false);
      }
    }

    void loadContacts();

    return () => { cancelled = true; };
  }, [status]);

  return { contacts, isLoadingContacts };
}


type CampaignType = DispatchLog['tipo'];

type MassPayload = {
  numbers: string[];
  message: string;
  imageFile: File | null;
  contacts?: Contact[];
};

export function useCampaignManager() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);
  // Ref síncrono: atualizado imediatamente, sem esperar render do React.
  // Impede envios duplicados por double-click ou chamadas concorrentes.
  const isSendingRef = useRef(false);

  const dispararCampanha = useCallback(
    async (
      tipo: CampaignType,
      destino: string,
      payload?: MassPayload,
    ) => {
      // Guarda síncrono — isSendingRef é imediato, diferente do estado isSending
      if (isSendingRef.current || !destino.trim()) return;
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

        const response = await fetch(`${API_BASE}/api/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ numbers, message, image: imageBase64 }),
        });

        const data = (await response.json()) as {
          enviados?: number;
          falhas?: number;
          error?: string;
          results?: Array<{ number: string; status: 'enviado' | 'falha' }>;
        };

        setProgress(100);

        const now = new Date().toISOString();

        if (data.results && data.results.length > 0) {
          const newLogs: DispatchLog[] = data.results.map((r, i) => ({
            id: `log-${Date.now()}-${i}`,
            tipo,
            destinatario: contactsMap.get(r.number) ?? r.number,
            horario: now,
            resultado: r.status === 'enviado' ? 'sucesso' : 'falha',
          }));
          setLogs((prev) => [...newLogs, ...prev]);
        } else {
          const ok = response.ok && !data.error;
          setLogs((prev) => [
            { id: `log-${Date.now()}`, tipo, destinatario: destino.trim(), horario: now, resultado: ok ? 'sucesso' : 'falha' },
            ...prev,
          ]);
        }
      } catch {
        setLogs((prev) => [
          { id: `log-${Date.now()}`, tipo, destinatario: destino.trim(), horario: new Date().toISOString(), resultado: 'falha' },
          ...prev,
        ]);
      } finally {
        window.setTimeout(() => {
          isSendingRef.current = false;
          setIsSending(false);
          setProgress(0);
        }, 400);
      }
    },
    [], // sem dependência de isSending — usamos a ref que é sempre atual
  );

  return {
    logs,
    isSending,
    progress,
    dispararCampanha,
  };
}
