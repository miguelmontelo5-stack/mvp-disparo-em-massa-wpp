import { Bot, LayoutDashboard, Send, Zap } from 'lucide-react';
import { useState } from 'react';

import { MassCampaignView, OverviewView, QuickSendView } from './components';
import { useCampaignManager, useWhatsAppConnection, useWhatsAppContacts } from './useControllers';

type View = 'overview' | 'mass' | 'quick';

interface NavItem {
  id: View;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

const navItems: NavItem[] = [
  { id: 'overview', label: 'Visao Geral', icon: LayoutDashboard },
  { id: 'mass',     label: 'Disparo em Massa', icon: Zap },
  { id: 'quick',    label: 'Envio Rapido', icon: Send },
];

export default function Dashboard() {
  const [currentView, setCurrentView] = useState<View>('overview');

  const { connection, iniciarPareamento, desconectar } = useWhatsAppConnection();
  const { logs, isSending, progress, dispararCampanha } = useCampaignManager();
  const { contacts: contactsList, isLoadingContacts } = useWhatsAppContacts(connection.status);

  return (
    <div className="flex min-h-screen bg-[#050505] text-white">

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-white/[0.06] bg-[#050505]">

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
          {navItems.map(({ id, label, icon: Icon }) => {
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

        {/* Sidebar footer */}
        <div className="border-t border-white/[0.06] px-5 py-4">
          <p className="text-[10px] text-zinc-800">MVP — v1.0.0</p>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────── */}
      <main className="ml-64 flex min-h-screen flex-1 flex-col">
        {currentView === 'overview' && (
          <OverviewView
            connection={connection}
            logs={logs}
            onConnect={iniciarPareamento}
            onDisconnect={desconectar}
          />
        )}
        {currentView === 'quick' && (
          <QuickSendView
            onSend={(destino, message) => {
              void dispararCampanha('rapido', destino, {
                numbers: [destino],
                message,
                imageFile: null,
              });
            }}
            isSending={isSending}
            progress={progress}
          />
        )}
        {currentView === 'mass' && (
          <MassCampaignView
            contactsList={contactsList}
            isLoadingContacts={isLoadingContacts}
            onSend={(destino, contacts, image, message) => {
              void dispararCampanha('massa', destino, {
                numbers: contacts.map((contact) => contact.telefone),
                message,
                imageFile: image,
                contacts,
              });
            }}
            isSending={isSending}
            progress={progress}
          />
        )}
      </main>

    </div>
  );
}