import { Bot, LayoutDashboard, Send, Users, Zap } from 'lucide-react';
import { useState } from 'react';

import { MassCampaignView, OverviewView, QuickSendView, TeamView } from './components';
import { useAuth, useCampaignManager, useWhatsAppConnection, useWhatsAppContacts } from './useControllers';
import type { UserRole } from './mockData';

type View = 'overview' | 'mass' | 'quick' | 'team';

interface NavItem {
  id: View;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  minRole?: UserRole[];
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Visao Geral', icon: LayoutDashboard },
  { id: 'mass',     label: 'Disparo em Massa', icon: Zap },
  { id: 'quick',    label: 'Envio Rapido', icon: Send },
  { id: 'team',     label: 'Equipe', icon: Users, minRole: ['ADMIN'] },
];

const roleBadgeStyles: Record<UserRole, string> = {
  ADMIN: 'border-[#deff9a]/30 bg-[#deff9a]/10 text-[#deff9a]',
  OPERATOR: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
  VIEWER: 'border-zinc-400/30 bg-zinc-400/10 text-zinc-400',
};

export default function Dashboard() {
  const [currentView, setCurrentView] = useState<View>('overview');

  const {
    currentUser,
    users,
    isLoadingUsers,
    registerUser,
    updateRole,
    deleteUser,
    refreshUsers,
  } = useAuth();

  const userRole: UserRole = currentUser?.role || 'VIEWER';
  const isAdmin = userRole === 'ADMIN';

  const {
    connection,
    iniciarPareamento,
    desconectar,
    selecionarSessao,
    adicionarSessao,
    removerSessao,
  } = useWhatsAppConnection(currentUser?.id);
  const { logs, isSending, progress, dispararCampanha } = useCampaignManager(currentUser?.id);
  const { contacts: contactsList, isLoadingContacts, refreshContacts } = useWhatsAppContacts(
    connection.status,
    connection.activeSessionId
  );

  const visibleNavItems = navItems.filter((item) => {
    if (!item.minRole) return true;
    return item.minRole.includes(userRole);
  });

  return (
    <div className="flex min-h-screen bg-[#050505] text-white">

      {/* ── Desktop Sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden md:flex w-64 flex-col border-r border-white/[0.06] bg-[#050505]">

        {/* Logo */}
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-[#deff9a]/20 bg-[#deff9a]/10 text-[#deff9a] shadow-[0_0_24px_rgba(222,255,154,0.1)]">
            <Bot size={17} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold leading-none tracking-tight text-[#deff9a]">DLM</p>
            <p className="mt-1 text-[10px] leading-none text-zinc-600">Central de Automacao</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 px-3 py-5">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-700">
            Menu
          </p>
          {visibleNavItems.map(({ id, label, icon: Icon }) => {
            const active = currentView === id;
            return (
              <button
                key={id}
                onClick={() => setCurrentView(id)}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
                  active
                    ? 'bg-[#deff9a]/[0.07] text-[#deff9a] ring-1 ring-inset ring-[#deff9a]/10'
                    : 'text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-200'
                }`}
              >
                <Icon size={17} strokeWidth={active ? 2.1 : 1.7} />
                <span className="flex-1 text-left">{label}</span>
                {active && (
                  <span className="h-1.5 w-1.5 rounded-full bg-[#deff9a] shadow-[0_0_8px_#deff9a]" />
                )}
              </button>
            );
          })}
        </nav>

        {/* User badge */}
        {currentUser && (
          <div className="border-t border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 text-xs font-bold text-zinc-300 uppercase">
                {currentUser.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-zinc-300">{currentUser.name}</p>
                <p className="truncate text-[10px] text-zinc-600">{currentUser.email}</p>
              </div>
              <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${roleBadgeStyles[userRole]}`}>
                {userRole}
              </span>
            </div>
          </div>
        )}

        {/* Sidebar footer */}
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-[10px] text-zinc-800">MVP — v2.0.0 (RBAC + Anti-Spam)</p>
        </div>
      </aside>

      {/* ── Mobile Top Header ────────────────────────────────────────── */}
      <div className="fixed top-0 inset-x-0 z-30 flex md:hidden items-center justify-between border-b border-white/[0.06] bg-[#050505]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-[#deff9a]/20 bg-[#deff9a]/10 text-[#deff9a]">
            <Bot size={16} strokeWidth={1.8} aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold leading-none tracking-tight text-[#deff9a]">DLM</p>
            <p className="mt-0.5 text-[9px] leading-none text-zinc-500">Multi-chip</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {currentUser && (
            <span className={`rounded-md border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${roleBadgeStyles[userRole]}`}>
              {userRole}
            </span>
          )}
          <span className={`inline-block h-2 w-2 rounded-full ${connection.status === 'conectado' ? 'bg-[#deff9a]' : 'bg-zinc-600'}`} />
          <span className="text-[11px] font-medium capitalize text-zinc-400">{connection.status}</span>
        </div>
      </div>

      {/* ── Mobile Bottom Navigation ─────────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 z-40 flex md:hidden items-center justify-around border-t border-white/[0.08] bg-[#0c0c0c]/95 px-2 py-2 backdrop-blur-lg">
        {visibleNavItems.map(({ id, label, icon: Icon }) => {
          const active = currentView === id;
          return (
            <button
              key={id}
              onClick={() => setCurrentView(id)}
              className={`flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-all ${
                active ? 'text-[#deff9a]' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={19} strokeWidth={active ? 2.2 : 1.7} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="flex min-h-screen flex-1 flex-col pt-14 pb-20 md:pt-0 md:pb-0 md:ml-64">
        {currentView === 'overview' && (
          <OverviewView
            connection={connection}
            logs={logs}
            onConnect={iniciarPareamento}
            onDisconnect={desconectar}
            onSelectSession={selecionarSessao}
            onAddSession={isAdmin ? adicionarSessao : undefined}
            onRemoveSession={isAdmin ? removerSessao : undefined}
            userRole={userRole}
          />
        )}
        {currentView === 'quick' && (
          <QuickSendView
            sessions={connection.sessions}
            onSend={(destino, message, sessionId) => {
              return dispararCampanha('rapido', destino, {
                numbers: [destino],
                message,
                imageFile: null,
                sessionId,
              });
            }}
            isSending={isSending}
            progress={progress}
            userRole={userRole}
          />
        )}
        {currentView === 'mass' && (
          <MassCampaignView
            sessions={connection.sessions}
            contactsList={contactsList}
            isLoadingContacts={isLoadingContacts}
            onRefreshContacts={refreshContacts}
            onSend={(destino, contacts, image, message, sessionId, intervalSeconds) => {
              return dispararCampanha('massa', destino, {
                numbers: contacts.map((contact) => contact.telefone),
                message,
                imageFile: image,
                contacts,
                sessionId,
                intervalSeconds,
              });
            }}
            isSending={isSending}
            progress={progress}
            userRole={userRole}
          />
        )}
        {currentView === 'team' && isAdmin && (
          <TeamView
            users={users}
            currentUser={currentUser}
            isLoading={isLoadingUsers}
            onRegister={registerUser}
            onUpdateRole={updateRole}
            onDelete={deleteUser}
            onRefresh={refreshUsers}
          />
        )}
      </main>

    </div>
  );
}