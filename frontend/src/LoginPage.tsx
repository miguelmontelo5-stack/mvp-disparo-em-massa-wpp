import React, { useState } from 'react';
import { Bot, Lock, Mail, User as UserIcon, ArrowRight, ShieldCheck, Eye, EyeOff, Sparkles, AlertCircle } from 'lucide-react';
import { loginUser, registerNewUser, ADMIN_EMAIL, ADMIN_DEFAULT_PASS, type AuthUserProfile } from './lib/supabase';

interface LoginPageProps {
  onLoginSuccess: (user: AuthUserProfile) => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Preenche dados do admin com 1 clique para facilidade e validação imediata
  const fillAdminCredentials = () => {
    setEmail(ADMIN_EMAIL);
    setPassword(ADMIN_DEFAULT_PASS);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!email || !password) {
      setError('Por favor, informe e-mail e senha.');
      return;
    }

    if (mode === 'register' && !name.trim()) {
      setError('Por favor, informe seu nome completo.');
      return;
    }

    setIsLoading(true);

    try {
      if (mode === 'login') {
        const user = await loginUser(email, password);
        onLoginSuccess(user);
      } else {
        const user = await registerNewUser(email, password, name);
        setSuccessMsg('Conta criada com sucesso! Acesse a plataforma com suas credenciais.');
        setMode('login');
        if (user.token && user.token !== 'pending_confirmation') {
          onLoginSuccess(user);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Falha ao autenticar.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full bg-[#050505] text-white flex flex-col justify-center items-center px-4 py-8 sm:px-6 lg:px-8 selection:bg-[#deff9a] selection:text-black">
      {/* Background Glow Elements */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 h-[450px] w-[500px] rounded-full bg-gradient-to-b from-[#deff9a]/15 to-transparent blur-[120px]" />
        <div className="absolute -bottom-40 right-1/4 h-[350px] w-[350px] rounded-full bg-gradient-to-t from-emerald-500/10 to-transparent blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md mx-auto">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="relative mb-3 group">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-[#deff9a]/40 to-emerald-500/30 blur-md opacity-75 group-hover:opacity-100 transition duration-500" />
            <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-[#deff9a]/30 bg-[#0d0d0d] text-[#deff9a] shadow-xl">
              <Bot size={28} strokeWidth={1.9} />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            DLM WhatsApp
            <span className="inline-flex items-center rounded-full border border-[#deff9a]/30 bg-[#deff9a]/10 px-2 py-0.5 text-[10px] font-semibold text-[#deff9a]">
              SaaS v2.0
            </span>
          </h1>
          <p className="mt-1 text-xs text-zinc-400 max-w-xs">
            Central Multi-Chip Ultra-Leve & Disparos em Massa com Inteligência Anti-Spam
          </p>
        </div>

        {/* Auth Card */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0c0c0c]/90 p-6 sm:p-8 backdrop-blur-xl shadow-2xl">
          {/* Mode Tabs */}
          <div className="grid grid-cols-2 p-1 mb-6 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <button
              type="button"
              onClick={() => { setMode('login'); setError(null); }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'login'
                  ? 'bg-[#deff9a] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(null); }}
              className={`py-2 text-xs font-semibold rounded-lg transition-all ${
                mode === 'register'
                  ? 'bg-[#deff9a] text-black shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Criar Conta
            </button>
          </div>

          {/* Alerts */}
          {error && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300 animate-fadeIn">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[#deff9a]/30 bg-[#deff9a]/10 p-3 text-xs text-[#deff9a] animate-fadeIn">
              <ShieldCheck size={16} className="shrink-0 mt-0.5" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-[11px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                  Nome Completo
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                    <UserIcon size={16} />
                  </div>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Seu nome"
                    className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-[#deff9a] focus:outline-none focus:ring-1 focus:ring-[#deff9a] transition"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                E-mail de Acesso
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                  <Mail size={16} />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="exemplo@dlm.com"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-[#deff9a] focus:outline-none focus:ring-1 focus:ring-[#deff9a] transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-zinc-400 mb-1.5 uppercase tracking-wider">
                Senha
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500">
                  <Lock size={16} />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] pl-10 pr-10 py-2.5 text-sm text-white placeholder-zinc-600 focus:border-[#deff9a] focus:outline-none focus:ring-1 focus:ring-[#deff9a] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-zinc-500 hover:text-zinc-300 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <p className="text-[11px] text-zinc-500">
                Novos usuários cadastrados recebem permissão de <strong className="text-zinc-300">OPERADOR</strong> por padrão para envio e gestão de campanhas.
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#deff9a] px-4 py-3 text-xs font-bold uppercase tracking-wider text-black shadow-[0_0_20px_rgba(222,255,154,0.15)] hover:bg-[#cbf77d] active:scale-[0.99] transition disabled:opacity-50 disabled:pointer-events-none mt-2"
            >
              {isLoading ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
              ) : (
                <>
                  <span>{mode === 'login' ? 'Acessar Plataforma' : 'Finalizar Cadastro'}</span>
                  <ArrowRight size={16} strokeWidth={2.4} />
                </>
              )}
            </button>
          </form>

          {/* Quick Admin Access Button (Configurado conforme requisito: disparomassa21@gmail.com / abc12345) */}
          <div className="mt-6 pt-5 border-t border-white/[0.06]">
            <p className="text-center text-[11px] text-zinc-500 mb-2.5">
              Acesso Rápido Master (Admin configurado):
            </p>
            <button
              type="button"
              onClick={fillAdminCredentials}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-[#deff9a]/20 bg-[#deff9a]/5 px-3 py-2 text-xs font-medium text-[#deff9a] hover:bg-[#deff9a]/10 hover:border-[#deff9a]/40 transition"
            >
              <Sparkles size={14} />
              <span>Preencher credenciais do Administrador</span>
            </button>
          </div>
        </div>

        {/* Security Footer */}
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-2 px-2 text-[11px] text-zinc-600">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-[#deff9a]" />
            <span>Autenticação Supabase RLS & RBAC</span>
          </div>
          <span>Frontend Cloudflare Pages • VPS Node.js</span>
        </div>
      </div>
    </div>
  );
}
