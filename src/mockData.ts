export interface ConnectionState {
  status: 'conectado' | 'desconectado' | 'aguardando_qr' | 'conectando';
  telefone: string;
  fotoPerfilUrl: string;
  conectadoEm: string | null;
  qrCode: string | null;
  error: string | null;
}

export const mockConnection: ConnectionState = {
  status: 'desconectado',
  telefone: '',
  fotoPerfilUrl: 'https://ui-avatars.com/api/?name=WhatsApp&background=25D366&color=ffffff',
  conectadoEm: null,
  qrCode: null,
  error: null,
};

export interface Contact {
  id: string;
  nomeCompleto: string;
  telefone: string;
}

export const mockContacts: Contact[] = [];

export interface DispatchLog {
  id: string;
  tipo: 'rapido' | 'massa' | 'status';
  destinatario: string;
  horario: string;
  resultado: 'sucesso' | 'falha';
}

export const mockLogs: DispatchLog[] = [];
