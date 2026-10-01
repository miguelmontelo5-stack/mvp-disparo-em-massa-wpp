import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  CheckCircle2,
  Clock3,
  Layers,
  LogOut,
  MessageSquareText,
  Plus,
  Search,
  Send,
  Smartphone,
  Trash2,
  Unplug,
  Users,
  RotateCw,
  XCircle,
  Zap,
} from 'lucide-react';

import type { ConnectionState, Contact, DispatchLog, SessionItem, User, UserRole } from './mockData';

function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#050505]/80 px-8 py-5 backdrop-blur-xl">
      <h1 className="text-lg font-semibold text-white">{title}</h1>
      <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
    </div>
  );
}

function SendProgress({ progress }: { progress: number }) {
  const normalized = Math.min(100, Math.max(0, progress));
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-4" aria-live="polite">
      <div className="mb-2.5 flex items-center justify-between text-xs font-medium">
        <span className="text-zinc-400">Enviando campanha...</span>
        <span className="tabular-nums text-[#deff9a]">{normalized}%</span>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-zinc-800"
        role="progressbar"
        aria-label="Progresso do envio"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={normalized}
      >
        <div
          className="h-full rounded-full bg-[#deff9a] shadow-[0_0_14px_rgba(222,255,154,0.55)] transition-[width] duration-500 ease-out"
          style={{ width: `${normalized}%` }}
        />
      </div>
    </div>
  );
}
interface ConnectionCardProps {
  connection: ConnectionState;
  onConnect: (force?: boolean, sessionId?: string) => void;
  onDisconnect: (sessionId?: string) => void;
  onSelectSession?: (sessionId: string) => void;
  onAddSession?: (name?: string) => void;
  onRemoveSession?: (sessionId: string) => void;
}

const statusLabel: Record<ConnectionState['status'], string> = {
  conectado: 'Conectado',
  desconectado: 'Desconectado',
  aguardando_qr: 'Aguardando QR',
  conectando: 'Iniciando',
};

export function ConnectionCard({
  connection,
  onConnect,
  onDisconnect,
  onSelectSession,
  onAddSession,
  onRemoveSession,
}: ConnectionCardProps) {
  const currentSession =
    connection.sessions?.find((s) => s.id === connection.activeSessionId) ||
    connection.sessions?.[0] || {
      id: 'default',
      name: 'Chip 1',
      status: connection.status,
      telefone: connection.telefone,
      fotoPerfilUrl: connection.fotoPerfilUrl,
      qrCode: connection.qrCode,
      error: connection.error,
    };

  const isConnected = currentSession.status === 'conectado';
  const isWaitingForQrCode = currentSession.status === 'aguardando_qr';
  const isConnecting = currentSession.status === 'conectando';

  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#121212] p-6 shadow-2xl shadow-black/30">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="text-[#deff9a]" size={16} />
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#deff9a]">WhatsApp Multi-Chip</p>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-white">{currentSession.name}</h2>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${isConnected ? 'border-[#deff9a]/20 bg-[#deff9a]/10 text-[#deff9a]' : isWaitingForQrCode || isConnecting ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-white/10 bg-white/5 text-zinc-400'}`}>
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-[#deff9a] shadow-[0_0_12px_#deff9a]' : isWaitingForQrCode || isConnecting ? 'animate-pulse bg-amber-300' : 'bg-zinc-600'}`} />
          {statusLabel[currentSession.status]}
        </span>
      </header>

      {/* Abas e Seleção de Chips */}
      <div className="mt-5 flex flex-wrap items-center gap-2 border-b border-white/[0.08] pb-4">
        {connection.sessions?.map((sess) => {
          const isSelected = sess.id === currentSession.id;
          const isSessConn = sess.status === 'conectado';
          const isSessWait = sess.status === 'aguardando_qr' || sess.status === 'conectando';

          return (
            <div
              key={sess.id}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') onSelectSession?.(sess.id); }}
              onClick={() => onSelectSession?.(sess.id)}
              className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition cursor-pointer select-none ${
                isSelected
                  ? 'bg-[#deff9a]/15 text-[#deff9a] ring-1 ring-[#deff9a]/40 shadow-[0_0_12px_rgba(222,255,154,0.15)]'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isSessConn
                    ? 'bg-[#deff9a] shadow-[0_0_8px_#deff9a]'
                    : isSessWait
                    ? 'animate-pulse bg-amber-300'
                    : 'bg-zinc-600'
                }`}
              />
              <span>{sess.name}</span>
              {sess.telefone && (
                <span className="hidden text-[10px] text-zinc-500 sm:inline">({sess.telefone})</span>
              )}
              {sess.id !== 'default' && onRemoveSession && (
                <button
                  type="button"
                  title="Remover este chip"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Deseja desconectar e remover o "${sess.name}"?`)) {
                      onRemoveSession(sess.id);
                    }
                  }}
                  className="ml-1 rounded p-0.5 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 transition"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}

        {onAddSession && (
          <button
            type="button"
            onClick={() => {
              const name = window.prompt('Digite o nome para o novo chip (ex: Chip Comercial 2):');
              if (name !== null) {
                onAddSession(name);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-[#deff9a]/40 hover:bg-[#deff9a]/5 hover:text-[#deff9a]"
          >
            <Plus size={13} />
            Novo Chip
          </button>
        )}
      </div>

      <div className="mt-6">
        {currentSession.status === 'desconectado' && (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-6 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-zinc-400">
              <Unplug aria-hidden="true" size={26} />
            </div>
            <p className="mt-4 font-medium text-white">Nenhum aparelho conectado neste chip</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">Inicie o pareamento para vincular o WhatsApp ao {currentSession.name}.</p>
            {currentSession.error && (
              <p className="mt-3 max-w-sm text-xs leading-5 text-red-300">{currentSession.error}</p>
            )}
            <button
              type="button"
              onClick={() => onConnect(false, currentSession.id)}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#deff9a] px-5 py-3 text-sm font-semibold text-black transition hover:bg-[#e7ffb6] focus:outline-none focus:ring-2 focus:ring-[#deff9a]/60 focus:ring-offset-2 focus:ring-offset-[#121212] sm:w-auto"
            >
              <Smartphone aria-hidden="true" size={18} />
              Conectar {currentSession.name}
            </button>
          </div>
        )}
        {currentSession.status === 'conectando' && (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-amber-400/20 bg-black/20 px-6 text-center" aria-live="polite">
            <div className="h-14 w-14 animate-spin rounded-2xl border-2 border-amber-300/20 border-t-amber-300" />
            <p className="mt-4 font-medium text-white">Iniciando {currentSession.name}...</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-zinc-500">O navegador está abrindo em segundo plano. O QR Code aparecerá a seguir.</p>
          </div>
        )}
        {currentSession.status === 'aguardando_qr' && (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-[#deff9a]/25 bg-[#050505] px-6 pb-6 text-center" aria-live="polite">
            <div className="relative grid h-52 w-52 place-items-center overflow-hidden rounded-2xl border-2 border-[#deff9a] bg-[#050505] p-3 shadow-[0_0_36px_rgba(222,255,154,0.45)]">
              {currentSession.qrCode ? (
                <img
                  src={currentSession.qrCode}
                  alt={`QR Code do WhatsApp - ${currentSession.name}`}
                  className="h-full w-full rounded-xl bg-white object-contain p-1"
                />
              ) : (
                <div className="h-full w-full animate-pulse rounded-xl bg-white/5" />
              )}
            </div>
            <p className="mt-5 font-medium text-white">Escaneie o QR Code no WhatsApp</p>
            <p className="mt-1 text-sm text-zinc-500">Vincule o aparelho ao {currentSession.name}.</p>
            <button
              type="button"
              onClick={() => onConnect(true, currentSession.id)}
              className="mt-4 text-xs font-medium text-[#deff9a] transition hover:underline"
            >
              Gerar novo QR Code
            </button>
          </div>
        )}
        {currentSession.status === 'conectado' && (
          <div className="rounded-2xl border border-[#deff9a]/15 bg-gradient-to-br from-[#deff9a]/10 to-transparent p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative shrink-0">
                <img
                  src={currentSession.fotoPerfilUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(currentSession.name)}&background=25D366&color=ffffff`}
                  alt="Foto de perfil"
                  className="h-16 w-16 rounded-2xl border border-white/10 object-cover"
                />
                <span className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-[3px] border-[#121212] bg-[#deff9a]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Número conectado ({currentSession.name})</p>
                <p className="mt-1 truncate text-lg font-semibold text-white">{currentSession.telefone || 'Conectado'}</p>
                {connection.conectadoEm && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
                    <Clock3 aria-hidden="true" size={14} />
                    Conectado em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(connection.conectadoEm))}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDisconnect(currentSession.id)}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:border-red-400/30 hover:bg-red-400/10 hover:text-red-300 focus:outline-none focus:ring-2 focus:ring-red-400/40"
              >
                <LogOut aria-hidden="true" size={17} />
                Desconectar
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

interface HistoryTableProps { logs: DispatchLog[]; }
const dispatchTypeLabels: Record<DispatchLog['tipo'], string> = { rapido: 'Rapido', massa: 'Em massa', status: 'Status' };
function formatDispatchDate(date: string) {
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return date;
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parsedDate);
}

export function HistoryTable({ logs }: HistoryTableProps) {
  return (
    <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#121212] shadow-2xl shadow-black/30">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#deff9a]">Atividade</p>
          <h2 className="mt-1 text-xl font-semibold text-white">Historico de disparos</h2>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-400">
          {logs.length} {logs.length === 1 ? 'registro' : 'registros'}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-white/10 bg-black/20 text-xs uppercase tracking-wider text-zinc-500">
              <th scope="col" className="px-6 py-4 font-medium">Data/Hora</th>
              <th scope="col" className="px-6 py-4 font-medium">Destinatario</th>
              <th scope="col" className="px-6 py-4 font-medium">Tipo</th>
              <th scope="col" className="px-6 py-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {logs.map((log) => {
              const ok = log.resultado === 'sucesso';
              return (
                <tr key={log.id} className="transition hover:bg-white/[0.025]">
                  <td className="whitespace-nowrap px-6 py-4 text-sm text-zinc-400">{formatDispatchDate(log.horario)}</td>
                  <td className="max-w-xs truncate px-6 py-4 text-sm font-medium text-zinc-100">{log.destinatario}</td>
                  <td className="px-6 py-4">
                    <span className="inline-flex rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-300">{dispatchTypeLabels[log.tipo]}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${ok ? 'border-[#deff9a]/20 bg-[#deff9a]/10 text-[#deff9a]' : 'border-red-400/20 bg-red-400/10 text-red-300'}`}>
                      {ok ? <CheckCircle2 aria-hidden="true" size={14} /> : <XCircle aria-hidden="true" size={14} />}
                      {ok ? 'Sucesso' : 'Falha'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {logs.length === 0 && (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center">
            <Clock3 aria-hidden="true" className="text-zinc-700" size={30} />
            <p className="mt-3 text-sm font-medium text-zinc-300">Nenhum disparo registrado</p>
            <p className="mt-1 text-xs text-zinc-600">Os proximos envios aparecerao aqui.</p>
          </div>
        )}
      </div>
    </section>
  );
}

interface OverviewViewProps {
  connection: ConnectionState;
  logs: DispatchLog[];
  onConnect: (force?: boolean, sessionId?: string) => void;
  onDisconnect: (sessionId?: string) => void;
  onSelectSession?: (sessionId: string) => void;
  onAddSession?: (name?: string) => void;
  onRemoveSession?: (sessionId: string) => void;
  userRole?: UserRole;
}

export function OverviewView({
  connection,
  logs,
  onConnect,
  onDisconnect,
  onSelectSession,
  onAddSession,
  onRemoveSession,
  userRole: _userRole = 'VIEWER',
}: OverviewViewProps) {
  return (
    <div className="flex flex-col">
      <PageHeader title="Visão Geral" description="Monitore múltiplos chips WhatsApp conectados e o histórico de disparos em tempo real." />
      <div className="p-8">
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.6fr)]">
          <div className="xl:sticky xl:top-24">
            <ConnectionCard
              connection={connection}
              onConnect={onConnect}
              onDisconnect={onDisconnect}
              onSelectSession={onSelectSession}
              onAddSession={onAddSession}
              onRemoveSession={onRemoveSession}
            />
          </div>
          <HistoryTable logs={logs} />
        </div>
      </div>
    </div>
  );
}

interface QuickSendViewProps {
  sessions?: SessionItem[];
  onSend: (
    destino: string,
    message: string,
    sessionId?: string
  ) => Promise<{ success: boolean; message: string }> | void;
  isSending: boolean;
  progress: number;
  userRole?: UserRole;
}

export function QuickSendView({ sessions, onSend, isSending, progress, userRole = 'VIEWER' }: QuickSendViewProps) {
  const [destination, setDestination] = useState('');
  const [message, setMessage] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('auto');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const isViewer = userRole === 'VIEWER';
  const canSend = !isViewer && destination.trim().length > 0 && message.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSending && canSend) {
      setFeedback(null);
      const res = await onSend(destination.trim(), message.trim(), selectedSessionId);
      if (res) {
        if (res.success) {
          setFeedback({ type: 'success', text: res.message || 'Mensagem enviada com sucesso!' });
          setMessage('');
        } else {
          setFeedback({ type: 'error', text: res.message || 'Falha ao enviar mensagem.' });
        }
      }
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Envio Rápido" description="Envie uma mensagem pontual para um destinatário específico escolhendo o chip de envio." />
      <div className="flex flex-1 items-start justify-center p-4 sm:p-8 lg:pt-12">
        <div className="w-full max-w-xl">
          <section className="rounded-3xl border border-white/10 bg-[#121212] p-5 sm:p-7 shadow-2xl shadow-black/40">
            <header className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#deff9a]/10 text-[#deff9a]">
                <MessageSquareText aria-hidden="true" size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#deff9a]">Novo envio</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Enviar mensagem</h2>
              </div>
            </header>
            <form className="mt-7 space-y-5" onSubmit={handleSubmit}>
              {feedback && (
                <div
                  role="alert"
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-sm transition animate-in fade-in duration-200 ${
                    feedback.type === 'success'
                      ? 'border-[#deff9a]/40 bg-[#deff9a]/10 text-[#deff9a]'
                      : 'border-red-500/40 bg-red-500/10 text-red-400'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 size={20} className="shrink-0 text-[#deff9a] mt-0.5" />
                  ) : (
                    <AlertCircle size={20} className="shrink-0 text-red-400 mt-0.5" />
                  )}
                  <p className="flex-1 font-medium">{feedback.text}</p>
                  <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    className="shrink-0 text-xs opacity-60 hover:opacity-100 transition px-1 py-0.5"
                    aria-label="Fechar notificação"
                  >
                    ✕
                  </button>
                </div>
              )}
              {sessions && sessions.length > 0 && (
                <div>
                  <label htmlFor="qs-chip" className="mb-2 block text-sm font-medium text-zinc-300">
                    Chip de Envio
                  </label>
                  <select
                    id="qs-chip"
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    disabled={isSending}
                    className="w-full rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white outline-none transition focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="auto">⚡ Automático (Rodízio entre chips conectados)</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.telefone ? `(${s.telefone})` : ''} - {s.status === 'conectado' ? '● Conectado' : '○ Desconectado'}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label htmlFor="qs-destination" className="mb-2 block text-sm font-medium text-zinc-300">Número ou destino</label>
                <input id="qs-destination" type="text" value={destination} onChange={(e) => setDestination(e.target.value)} disabled={isSending} placeholder="Ex.: +55 (11) 99999-9999" className="w-full rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10 disabled:cursor-not-allowed disabled:opacity-50" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="qs-message" className="text-sm font-medium text-zinc-300">Mensagem</label>
                  <span className="text-xs text-zinc-600">{message.length} caracteres</span>
                </div>
                <textarea id="qs-message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={isSending} placeholder="Digite a mensagem que será enviada..." rows={5} className="w-full resize-none rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10 disabled:cursor-not-allowed disabled:opacity-50" />
              </div>
              {isSending && <SendProgress progress={progress} />}
              {isViewer && (
                <p className="text-center text-xs text-red-400/80 border border-red-400/20 bg-red-400/5 rounded-xl py-2 px-3">
                  🔒 Você possui nível VIEWER. Solicite ao administrador a permissão de OPERATOR para enviar mensagens.
                </p>
              )}
              <button type="submit" disabled={isSending || !canSend} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#deff9a] px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-[#e7ffb6] focus:outline-none focus:ring-2 focus:ring-[#deff9a]/60 focus:ring-offset-2 focus:ring-offset-[#121212] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
                <Send aria-hidden="true" size={18} />
                {isSending ? 'Enviando...' : isViewer ? '🔒 Sem permissão' : 'Enviar mensagem'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

interface MassCampaignViewProps {
  sessions?: SessionItem[];
  contactsList: Contact[];
  isLoadingContacts?: boolean;
  onRefreshContacts?: () => void;
  onSend: (
    destino: string,
    contacts: Contact[],
    image: File | null,
    message: string,
    sessionId?: string,
    intervalSeconds?: number
  ) => Promise<{ success: boolean; message: string }> | void;
  isSending: boolean;
  progress: number;
  userRole?: UserRole;
}

const INTERVAL_PRESETS = [
  { value: 3,  label: '3s',  desc: 'Moderado', color: 'text-amber-400' },
  { value: 5,  label: '5s',  desc: 'Recomendado', color: 'text-[#deff9a]' },
  { value: 10, label: '10s', desc: 'Seguro', color: 'text-blue-400' },
  { value: 15, label: '15s', desc: 'Ultra Seguro', color: 'text-emerald-400' },
];

export function MassCampaignView({
  sessions,
  contactsList,
  isLoadingContacts = false,
  onRefreshContacts,
  onSend,
  isSending,
  progress,
  userRole = 'VIEWER',
}: MassCampaignViewProps) {
  const [selectedSessionId, setSelectedSessionId] = useState('auto');
  const [imageFile, setImageFile]             = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const imageInputRef  = useRef<HTMLInputElement>(null);
  const listScrollRef  = useRef<HTMLDivElement>(null);
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [searchQuery, setSearchQuery]           = useState('');
  const [filterTab, setFilterTab]               = useState<'todos' | 'salvos' | 'nao_salvos'>('todos');
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const isViewer = userRole === 'VIEWER';

  const totalCount = contactsList.length;
  const salvosCount = contactsList.filter((c) => c.salvo).length;
  const naoSalvosCount = totalCount - salvosCount;

  const filteredContacts = contactsList.filter((c) => {
    // Filtro por categoria (todos, salvos, não salvos)
    if (filterTab === 'salvos' && !c.salvo) return false;
    if (filterTab === 'nao_salvos' && c.salvo) return false;

    const query = searchQuery.toLowerCase();
    if (c.nomeCompleto.toLowerCase().includes(query)) return true;
    
    const queryDigits = query.replace(/\D/g, '');
    if (queryDigits.length > 0 && c.telefone.replace(/\D/g, '').includes(queryDigits)) return true;
    
    return c.telefone.toLowerCase().includes(query);
  });
  const allSelected  = filteredContacts.length > 0 && filteredContacts.every((c) => selectedContacts.includes(c.id));
  const someSelected = filteredContacts.some((c) => selectedContacts.includes(c.id));
  const canSend = !isViewer && selectedContacts.length > 0 && message.trim().length > 0;
  const estimatedDurationSec = selectedContacts.length * intervalSeconds;
  const estimatedMinutes = Math.ceil(estimatedDurationSec / 60);

  // Reseta o scroll do container para o topo sempre que a busca mudar,
  // evitando que itens antigos fiquem visiveis na viewport por causa da posicao de scroll.
  useEffect(() => {
    if (listScrollRef.current) {
      listScrollRef.current.scrollTop = 0;
    }
  }, [searchQuery]);

  useEffect(() => {
    if (!imageFile) { setImagePreviewUrl(null); return; }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  function handleImageChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setImageFile(file);
  }
  function handleRemoveImage() {
    setImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = '';
  }
  function toggleContact(id: string) {
    setSelectedContacts((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  }
  function handleToggleAll() {
    if (allSelected) {
      setSelectedContacts((prev) => prev.filter((id) => !filteredContacts.some((c) => c.id === id)));
    } else {
      const filteredIds = filteredContacts.map((c) => c.id);
      setSelectedContacts((prev) => [...new Set([...prev, ...filteredIds])]);
    }
  }
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isSending && canSend) {
      setFeedback(null);
      const contactObjects = contactsList.filter((c) => selectedContacts.includes(c.id));
      const destino = `${contactObjects.length} contato${contactObjects.length !== 1 ? 's' : ''}`;
      const res = await onSend(destino, contactObjects, imageFile, message.trim(), selectedSessionId, intervalSeconds);
      if (res) {
        if (res.success) {
          setFeedback({ type: 'success', text: res.message || 'Campanha disparada com sucesso!' });
          setMessage('');
          handleRemoveImage();
        } else {
          setFeedback({ type: 'error', text: res.message || 'Falha ao disparar campanha.' });
        }
      }
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Disparo em Massa" description="Selecione contatos, anexe uma imagem e dispare sua campanha." />
      <div className="flex flex-1 items-start justify-center p-4 sm:p-8 lg:pt-10">
        <div className="w-full max-w-2xl">
          <section className="rounded-3xl border border-white/10 bg-[#121212] p-5 sm:p-7 shadow-2xl shadow-black/40">

            <header className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#deff9a]/10 text-[#deff9a]">
                <Zap aria-hidden="true" size={22} />
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#deff9a]">Campanha</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Disparar em massa</h2>
              </div>
            </header>

            <form className="mt-7 space-y-6" onSubmit={handleSubmit}>
              {feedback && (
                <div
                  role="alert"
                  className={`flex items-start gap-3 rounded-2xl border p-4 text-sm transition animate-in fade-in duration-200 ${
                    feedback.type === 'success'
                      ? 'border-[#deff9a]/40 bg-[#deff9a]/10 text-[#deff9a]'
                      : 'border-red-500/40 bg-red-500/10 text-red-400'
                  }`}
                >
                  {feedback.type === 'success' ? (
                    <CheckCircle2 size={20} className="shrink-0 text-[#deff9a] mt-0.5" />
                  ) : (
                    <AlertCircle size={20} className="shrink-0 text-red-400 mt-0.5" />
                  )}
                  <p className="flex-1 font-medium">{feedback.text}</p>
                  <button
                    type="button"
                    onClick={() => setFeedback(null)}
                    className="shrink-0 text-xs opacity-60 hover:opacity-100 transition px-1 py-0.5"
                    aria-label="Fechar notificação"
                  >
                    ✕
                  </button>
                </div>
              )}
              {sessions && sessions.length > 0 && (
                <div>
                  <label htmlFor="mass-chip" className="mb-2 block text-sm font-medium text-zinc-300">
                    Chip de Envio
                  </label>
                  <select
                    id="mass-chip"
                    value={selectedSessionId}
                    onChange={(e) => setSelectedSessionId(e.target.value)}
                    disabled={isSending}
                    className="w-full rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-sm text-white outline-none transition focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="auto">⚡ Automático (Rodízio entre chips conectados)</option>
                    {sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} {s.telefone ? `(${s.telefone})` : ''} - {s.status === 'conectado' ? '● Conectado' : '○ Desconectado'}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    No modo automático, os disparos são balanceados ciclicamente entre todos os números conectados, reduzindo bloqueios.
                  </p>
                </div>
              )}

              {/* 1 - Image upload */}
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-300">
                  Imagem da campanha <span className="font-normal text-zinc-600">(opcional)</span>
                </p>
                {imageFile && imagePreviewUrl ? (
                  <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                    <img src={imagePreviewUrl} alt="Preview da imagem" className="h-[72px] w-[72px] shrink-0 rounded-xl border border-white/10 object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{imageFile.name}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {(imageFile.size / 1024).toFixed(1)} KB - {imageFile.name.split('.').pop()?.toUpperCase()}
                      </p>
                      <button type="button" onClick={() => imageInputRef.current?.click()} className="mt-2 text-xs font-medium text-[#deff9a] transition hover:underline">
                        Trocar imagem
                      </button>
                    </div>
                    <button type="button" onClick={handleRemoveImage} aria-label="Remover imagem" className="shrink-0 rounded-lg p-1.5 text-zinc-600 transition hover:bg-white/10 hover:text-white">
                      <XCircle size={18} />
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => imageInputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/[0.08] bg-black/20 py-8 transition-all hover:border-white/20 hover:bg-white/[0.02] focus:outline-none focus:ring-2 focus:ring-[#deff9a]/30">
                    <div className="grid h-14 w-14 place-items-center rounded-2xl bg-white/5 text-zinc-600">
                      <Camera size={26} strokeWidth={1.4} aria-hidden="true" />
                    </div>
                    <div className="text-center">
                      <p className="font-medium text-zinc-200">Selecionar imagem</p>
                      <p className="mt-1 text-sm text-zinc-600">PNG, JPG ou JPEG</p>
                    </div>
                  </button>
                )}
                <input ref={imageInputRef} type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={handleImageChange} className="sr-only" tabIndex={-1} aria-hidden="true" />
              </div>

              {/* 2 - Contacts selection */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1.5 text-sm font-medium text-zinc-300">
                      <Users size={14} className="text-zinc-500" aria-hidden="true" />
                      Destinatarios
                    </label>
                    {onRefreshContacts && (
                      <button
                        type="button"
                        onClick={onRefreshContacts}
                        disabled={isLoadingContacts}
                        title="Sincronizar e recarregar contatos do chip"
                        className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-zinc-400 transition hover:border-[#deff9a]/30 hover:bg-[#deff9a]/10 hover:text-[#deff9a] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <RotateCw size={11} className={isLoadingContacts ? 'animate-spin text-[#deff9a]' : ''} />
                        <span>Sincronizar</span>
                      </button>
                    )}
                  </div>
                  <span className={`text-xs font-medium transition-colors ${selectedContacts.length > 0 ? 'text-[#deff9a]' : 'text-zinc-600'}`}>
                    {selectedContacts.length} de {contactsList.length} selecionados
                  </span>
                </div>

                {/* Filter Tabs: Todos, Salvos, Não Salvos */}
                {contactsList.length > 0 && (
                  <div className="mb-2.5 flex items-center gap-1.5 rounded-xl border border-white/[0.06] bg-black/40 p-1">
                    <button
                      type="button"
                      onClick={() => setFilterTab('todos')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                        filterTab === 'todos'
                          ? 'bg-white/10 text-white shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <span>Todos</span>
                      <span className="rounded-md bg-white/10 px-1.5 py-0.2 text-[10px] text-zinc-300">
                        {totalCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterTab('salvos')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                        filterTab === 'salvos'
                          ? 'bg-[#deff9a]/10 text-[#deff9a] ring-1 ring-inset ring-[#deff9a]/20'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <span>Salvos</span>
                      <span className="rounded-md bg-[#deff9a]/10 px-1.5 py-0.2 text-[10px] text-[#deff9a]">
                        {salvosCount}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFilterTab('nao_salvos')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-all ${
                        filterTab === 'nao_salvos'
                          ? 'bg-white/10 text-zinc-200 shadow-sm'
                          : 'text-zinc-500 hover:text-zinc-300'
                      }`}
                    >
                      <span>Não salvos</span>
                      <span className="rounded-md bg-white/10 px-1.5 py-0.2 text-[10px] text-zinc-400">
                        {naoSalvosCount}
                      </span>
                    </button>
                  </div>
                )}

                <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                  {/* Search */}
                  <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
                    <Search size={14} className="shrink-0 text-zinc-600" aria-hidden="true" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={isLoadingContacts ? 'Carregando contatos...' : 'Buscar por nome ou numero...'}
                      disabled={isLoadingContacts}
                      className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-600 disabled:cursor-wait"
                    />
                    {searchQuery && (
                      <button type="button" onClick={() => setSearchQuery('')} aria-label="Limpar busca" className="text-zinc-600 transition hover:text-zinc-300">
                        <XCircle size={14} />
                      </button>
                    )}
                  </div>
                  {/* Select-all */}
                  {!isLoadingContacts && filteredContacts.length > 0 && (
                    <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2.5">
                      <button type="button" onClick={handleToggleAll} className="flex items-center gap-2.5 text-xs font-medium text-zinc-400 transition-colors hover:text-zinc-200">
                        <span className={`flex h-4 w-4 items-center justify-center rounded border transition-colors ${allSelected ? 'border-[#deff9a] bg-[#deff9a]' : someSelected ? 'border-white/30 bg-white/10' : 'border-white/20 bg-transparent'}`}>
                          {allSelected && <Check size={10} className="text-black" strokeWidth={3} />}
                          {someSelected && !allSelected && <span className="block h-[5px] w-[5px] rounded-[1px] bg-zinc-300" />}
                        </span>
                        Selecionar {filterTab === 'salvos' ? 'salvos' : filterTab === 'nao_salvos' ? 'não salvos' : 'todos'} ({filteredContacts.length})
                      </button>
                      {filteredContacts.length !== contactsList.length && (
                        <span className="text-xs text-zinc-700">{filteredContacts.length} exibido{filteredContacts.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  )}
                  {/* Rows */}
                  <div ref={listScrollRef} className="max-h-56 divide-y divide-white/[0.04] overflow-y-auto" role="group" aria-label="Lista de contatos">
                    {isLoadingContacts ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
                        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-[#deff9a]" />
                        <p className="text-sm text-zinc-500">Carregando contatos e conversas do chip...</p>
                      </div>
                    ) : filteredContacts.length === 0 ? (
                      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                        <Search size={22} className="text-zinc-800" />
                        <p className="text-sm text-zinc-600">
                          {contactsList.length === 0
                            ? 'Conecte o WhatsApp para carregar contatos salvos e conversas.'
                            : 'Nenhum contato encontrado nesta categoria ou busca.'}
                        </p>
                      </div>
                    ) : (
                      filteredContacts.map((contact) => {
                        const isSelected = selectedContacts.includes(contact.id);
                        return (
                          <div
                            key={contact.id}
                            role="checkbox"
                            aria-checked={isSelected}
                            tabIndex={0}
                            onClick={() => toggleContact(contact.id)}
                            onKeyDown={(e) => { if (e.key === ' ') { e.preventDefault(); toggleContact(contact.id); } }}
                            className={`flex cursor-pointer select-none items-center gap-3 px-3 py-3 transition-colors ${isSelected ? 'bg-[#deff9a]/[0.05]' : 'hover:bg-white/[0.02]'}`}
                          >
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${isSelected ? 'border-[#deff9a] bg-[#deff9a]' : 'border-white/20 bg-transparent'}`}>
                              {isSelected && <Check size={10} className="text-black" strokeWidth={3} />}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-sm font-medium transition-colors ${isSelected ? 'text-zinc-100' : 'text-zinc-400'}`}>{contact.nomeCompleto}</p>
                              <p className="text-xs text-zinc-600">{contact.telefone}</p>
                            </div>
                            <span
                              className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium border transition-colors ${
                                contact.salvo
                                  ? 'border-[#deff9a]/20 bg-[#deff9a]/10 text-[#deff9a]'
                                  : 'border-white/10 bg-white/5 text-zinc-400'
                              }`}
                            >
                              {contact.salvo ? 'Salvo' : 'Não salvo'}
                            </span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* 3 - Message */}
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="mass-message" className="text-sm font-medium text-zinc-300">Mensagem da campanha</label>
                  <span className="text-xs text-zinc-600">{message.length} caracteres</span>
                </div>
                <textarea id="mass-message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={isSending} placeholder="Digite a mensagem que sera disparada para os contatos selecionados..." rows={4} className="w-full resize-none rounded-xl border border-white/10 bg-[#050505] px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-600 focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10 disabled:cursor-not-allowed disabled:opacity-50" />
              </div>

              {/* 4 - Anti-Spam Interval Selector */}
              <div>
                <p className="mb-2 text-sm font-medium text-zinc-300">Intervalo entre envios (Anti-Spam)</p>
                <div className="grid grid-cols-4 gap-2">
                  {INTERVAL_PRESETS.map((preset) => {
                    const isActive = intervalSeconds === preset.value;
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => setIntervalSeconds(preset.value)}
                        disabled={isSending}
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-3 text-center transition-all ${
                          isActive
                            ? 'border-[#deff9a]/40 bg-[#deff9a]/10 ring-1 ring-[#deff9a]/20 shadow-[0_0_12px_rgba(222,255,154,0.12)]'
                            : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-white/[0.03]'
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <span className={`text-base font-bold ${isActive ? 'text-[#deff9a]' : 'text-zinc-300'}`}>
                          {preset.label}
                        </span>
                        <span className={`text-[10px] font-medium ${isActive ? preset.color : 'text-zinc-600'}`}>
                          {preset.desc}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {selectedContacts.length > 0 && (
                  <div className="mt-2.5 flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/30 px-3 py-2">
                    <span className="text-xs text-zinc-500">Duração estimada</span>
                    <span className="text-xs font-medium text-zinc-300">
                      {selectedContacts.length} contato{selectedContacts.length !== 1 ? 's' : ''} × {intervalSeconds}s ≈{' '}
                      <span className="text-[#deff9a]">{estimatedMinutes} min</span>
                    </span>
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-zinc-600">
                  ⏱ Intervalos maiores reduzem o risco de bloqueio pelo WhatsApp. O sistema aplica variação aleatória (jitter) automaticamente.
                </p>
              </div>

              {isSending && <SendProgress progress={progress} />}

              {isViewer && (
                <p className="text-center text-xs text-red-400/80 border border-red-400/20 bg-red-400/5 rounded-xl py-2 px-3">
                  🔒 Você possui nível VIEWER. Solicite ao administrador a permissão de OPERATOR para disparar campanhas.
                </p>
              )}
              <button type="submit" disabled={isSending || !canSend} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#deff9a] px-5 py-3.5 text-sm font-semibold text-black transition hover:bg-[#e7ffb6] focus:outline-none focus:ring-2 focus:ring-[#deff9a]/60 focus:ring-offset-2 focus:ring-offset-[#121212] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500">
                <Zap aria-hidden="true" size={18} />
                {isSending ? 'Disparando...' : isViewer ? '🔒 Sem permissão' : selectedContacts.length > 0 ? `Disparar para ${selectedContacts.length} contato${selectedContacts.length !== 1 ? 's' : ''}` : 'Disparar campanha'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}

/* ── TeamView — Gestão de Equipe (Apenas ADMIN) ────────────────────── */

interface TeamViewProps {
  users: User[];
  currentUser: User | null;
  isLoading: boolean;
  onRegister: (name: string, email: string, role?: UserRole) => Promise<User>;
  onUpdateRole: (userId: string, newRole: UserRole) => Promise<User>;
  onDelete: (userId: string) => Promise<void>;
  onRefresh: () => void;
}

const ROLE_OPTIONS: { value: UserRole; label: string; desc: string }[] = [
  { value: 'ADMIN', label: 'Admin', desc: 'Acesso total: chips, disparos, equipe' },
  { value: 'OPERATOR', label: 'Operador', desc: 'Conecta chips e realiza disparos' },
  { value: 'VIEWER', label: 'Visualizador', desc: 'Apenas visualiza dados e histórico' },
];

const roleBadgeColors: Record<UserRole, string> = {
  ADMIN: 'border-[#deff9a]/30 bg-[#deff9a]/10 text-[#deff9a]',
  OPERATOR: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  VIEWER: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-400',
};

export function TeamView({
  users,
  currentUser,
  isLoading,
  onRegister,
  onUpdateRole,
  onDelete,
  onRefresh,
}: TeamViewProps) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('OPERATOR');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newName.trim() || !newEmail.trim()) return;
    setFormError(null);
    setFormSuccess(null);
    setIsSubmitting(true);
    try {
      const user = await onRegister(newName.trim(), newEmail.trim(), newRole);
      setFormSuccess(`Usuário "${user.name}" cadastrado com sucesso como ${user.role}.`);
      setNewName('');
      setNewEmail('');
      setNewRole('OPERATOR');
      setShowForm(false);
    } catch (err: any) {
      setFormError(err.message || 'Erro ao cadastrar usuário.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRoleChange(userId: string, role: UserRole) {
    try {
      await onUpdateRole(userId, role);
    } catch (err: any) {
      alert(err.message || 'Erro ao alterar permissão.');
    }
  }

  async function handleDelete(userId: string, userName: string) {
    if (!window.confirm(`Deseja realmente remover o usuário "${userName}"? Esta ação é irreversível.`)) return;
    try {
      await onDelete(userId);
    } catch (err: any) {
      alert(err.message || 'Erro ao excluir usuário.');
    }
  }

  return (
    <div className="flex flex-col">
      <PageHeader title="Equipe" description="Gerencie os membros da sua equipe e seus níveis de acesso." />
      <div className="flex flex-1 items-start justify-center p-4 sm:p-8 lg:pt-10">
        <div className="w-full max-w-2xl space-y-6">

          {/* Feedback messages */}
          {formSuccess && (
            <div className="flex items-start gap-3 rounded-2xl border border-[#deff9a]/40 bg-[#deff9a]/10 p-4 text-sm text-[#deff9a]">
              <CheckCircle2 size={20} className="shrink-0 mt-0.5" />
              <p className="flex-1 font-medium">{formSuccess}</p>
              <button type="button" onClick={() => setFormSuccess(null)} className="text-xs opacity-60 hover:opacity-100">✕</button>
            </div>
          )}
          {formError && (
            <div className="flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400">
              <AlertCircle size={20} className="shrink-0 mt-0.5" />
              <p className="flex-1 font-medium">{formError}</p>
              <button type="button" onClick={() => setFormError(null)} className="text-xs opacity-60 hover:opacity-100">✕</button>
            </div>
          )}

          {/* Header + Add Button */}
          <section className="rounded-3xl border border-white/10 bg-[#121212] shadow-2xl shadow-black/40">
            <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="grid h-11 w-11 place-items-center rounded-xl bg-[#deff9a]/10 text-[#deff9a]">
                  <Users size={22} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#deff9a]">Equipe</p>
                  <h2 className="mt-1 text-xl font-semibold text-white">Membros ({users.length})</h2>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-[#deff9a]/30 hover:bg-[#deff9a]/10 hover:text-[#deff9a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCw size={13} className={isLoading ? 'animate-spin' : ''} />
                  Atualizar
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(!showForm)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#deff9a] px-4 py-2 text-xs font-semibold text-black transition hover:bg-[#e7ffb6]"
                >
                  <Plus size={14} />
                  Novo Membro
                </button>
              </div>
            </header>

            {/* New member form */}
            {showForm && (
              <div className="border-b border-white/10 bg-black/20 px-6 py-5">
                <form className="space-y-4" onSubmit={handleRegister}>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="team-name" className="mb-1.5 block text-xs font-medium text-zinc-400">Nome</label>
                      <input
                        id="team-name"
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Ex.: João Silva"
                        className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10"
                      />
                    </div>
                    <div>
                      <label htmlFor="team-email" className="mb-1.5 block text-xs font-medium text-zinc-400">E-mail</label>
                      <input
                        id="team-email"
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="joao@empresa.com"
                        className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2.5 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10"
                      />
                    </div>
                  </div>
                  <div>
                    <label htmlFor="team-role" className="mb-1.5 block text-xs font-medium text-zinc-400">Nível de Acesso</label>
                    <select
                      id="team-role"
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as UserRole)}
                      className="w-full rounded-xl border border-white/10 bg-[#050505] px-3 py-2.5 text-sm text-white outline-none transition focus:border-[#deff9a]/60 focus:ring-4 focus:ring-[#deff9a]/10"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={isSubmitting || !newName.trim() || !newEmail.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#deff9a] px-5 py-2.5 text-sm font-semibold text-black transition hover:bg-[#e7ffb6] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                    >
                      {isSubmitting ? 'Cadastrando...' : 'Cadastrar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="text-xs font-medium text-zinc-500 transition hover:text-zinc-300"
                    >
                      Cancelar
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Users list */}
            <div className="divide-y divide-white/[0.06]">
              {isLoading && users.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-[#deff9a]" />
                  <p className="text-sm text-zinc-500">Carregando equipe...</p>
                </div>
              ) : users.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Users size={28} className="text-zinc-800" />
                  <p className="text-sm text-zinc-600">Nenhum membro cadastrado.</p>
                </div>
              ) : (
                users.map((user) => {
                  const isSelf = currentUser?.id === user.id;
                  return (
                    <div key={user.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-sm font-bold text-zinc-300 uppercase">
                        {user.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-sm font-medium text-white">
                          {user.name}
                          {isSelf && <span className="text-[10px] text-zinc-500">(você)</span>}
                        </p>
                        <p className="truncate text-xs text-zinc-600">{user.email}</p>
                      </div>
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as UserRole)}
                        disabled={isSelf}
                        className={`rounded-lg border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider outline-none transition ${roleBadgeColors[user.role]} ${isSelf ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:opacity-80'}`}
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                      {!isSelf && (
                        <button
                          type="button"
                          onClick={() => handleDelete(user.id, user.name)}
                          title="Remover membro"
                          className="rounded-lg p-1.5 text-zinc-600 transition hover:bg-red-500/20 hover:text-red-400"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </section>

          {/* Role legend */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0a0a0a] px-5 py-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-zinc-600">Legenda de Permissões</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {ROLE_OPTIONS.map((r) => (
                <div key={r.value} className="flex items-center gap-2.5">
                  <span className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadgeColors[r.value]}`}>
                    {r.label}
                  </span>
                  <span className="text-[11px] text-zinc-500">{r.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
