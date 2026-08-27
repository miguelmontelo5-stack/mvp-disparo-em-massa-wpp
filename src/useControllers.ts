import { useCallback, useEffect, useState } from 'react';

import {
  mockConnection,
  type ConnectionState,
  type Contact,
  type DispatchLog,
} from './mockData';

/** Backend Express (dlm-backend) — porta 3001, nao a 3000 do Vite */
const API_BASE = 'http://localhost:3001';

type ApiStatus = {
  status?: ConnectionState['status'];
  qrCode?: string | null;
  info?: {
    pushname?: string;
    phone?: string;
  } | null;
};

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

  const iniciarPareamento = useCallback(() => {
    setConnection((currentConnection) => ({
      ...currentConnection,
      status: 'aguardando_qr',
      conectadoEm: null,
    }));
  }, []);

  const desconectar = useCallback(() => {
    setConnection((currentConnection) => ({
      ...currentConnection,
      status: 'desconectado',
      conectadoEm: null,
      qrCode: null,
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function pollStatus() {
      try {
        const response = await fetch(`${API_BASE}/api/status`);
        if (!response.ok) {
          throw new Error('Falha ao consultar status');
        }

        const data = (await response.json()) as ApiStatus;
        if (cancelled) {
          return;
        }

        const nextStatus = data.status ?? 'desconectado';
        const qrFromApi = typeof data.qrCode === 'string' ? data.qrCode : '';

        setConnection((currentConnection) => ({
          ...currentConnection,
          status: nextStatus,
          qrCode:
            nextStatus === 'aguardando_qr' && qrFromApi.length > 0
              ? qrFromApi
              : null,
          telefone: data.info?.phone || currentConnection.telefone,
          fotoPerfilUrl: currentConnection.fotoPerfilUrl,
          conectadoEm:
            nextStatus === 'conectado'
              ? currentConnection.conectadoEm ?? new Date().toISOString()
              : null,
        }));
      } catch {
        if (cancelled) {
          return;
        }

        setConnection((currentConnection) => ({
          ...currentConnection,
          status: 'desconectado',
          qrCode: null,
          conectadoEm: null,
        }));
      }
    }

    void pollStatus();
    const intervalId = window.setInterval(() => {
      void pollStatus();
    }, 2_000);

    return () => {
      cancelled = true;
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

  useEffect(() => {
    if (status !== 'conectado') {
      setContacts([]);
      return undefined;
    }

    let cancelled = false;

    async function loadContacts() {
      try {
        const response = await fetch(`${API_BASE}/api/contacts`);
        if (!response.ok) {
          throw new Error('Falha ao carregar contatos');
        }

        const data = (await response.json()) as { contacts?: Contact[] };
        if (!cancelled) {
          setContacts(data.contacts ?? []);
        }
      } catch {
        if (!cancelled) {
          setContacts([]);
        }
      }
    }

    void loadContacts();

    return () => {
      cancelled = true;
    };
  }, [status]);

  return contacts;
}

type CampaignType = DispatchLog['tipo'];

type MassPayload = {
  numbers: string[];
  message: string;
  imageFile: File | null;
};

export function useCampaignManager() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [progress, setProgress] = useState(0);

  const dispararCampanha = useCallback(
    async (
      tipo: CampaignType,
      destino: string,
      payload?: MassPayload,
    ) => {
      if (isSending || !destino.trim()) {
        return;
      }

      const numbers = payload?.numbers?.length
        ? payload.numbers
        : [destino.trim()];
      const message = payload?.message?.trim() || destino.trim();

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
          body: JSON.stringify({
            numbers,
            message,
            imageBase64,
          }),
        });

        const data = (await response.json()) as {
          enviados?: number;
          falhas?: number;
          error?: string;
        };

        setProgress(100);

        const ok = response.ok && (data.falhas ?? 0) === 0 && !data.error;

        setLogs((currentLogs) => [
          {
            id: `log-${Date.now()}`,
            tipo,
            destinatario: destino.trim(),
            horario: new Date().toISOString(),
            resultado: ok ? 'sucesso' : 'falha',
          },
          ...currentLogs,
        ]);
      } catch {
        setLogs((currentLogs) => [
          {
            id: `log-${Date.now()}`,
            tipo,
            destinatario: destino.trim(),
            horario: new Date().toISOString(),
            resultado: 'falha',
          },
          ...currentLogs,
        ]);
      } finally {
        window.setTimeout(() => {
          setIsSending(false);
          setProgress(0);
        }, 400);
      }
    },
    [isSending],
  );

  return {
    logs,
    isSending,
    progress,
    dispararCampanha,
  };
}
