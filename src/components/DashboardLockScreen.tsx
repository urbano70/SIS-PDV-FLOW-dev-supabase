import React, { useState } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { signInOwner } from '../lib/auth';

const REMEMBER_KEY = 'fechaconta_remembered_email';
const REMEMBER_PWD_KEY = 'fechaconta_remembered_pwd';

interface Props {
  ownerEmail?: string;
  onUnlock: () => void;
}

export default function DashboardLockScreen({ ownerEmail, onUnlock }: Props) {
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) || ownerEmail || '');
  const [password, setPassword] = useState(() => localStorage.getItem(REMEMBER_PWD_KEY) || '');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signInOwner(email.trim(), password);
      localStorage.setItem(REMEMBER_KEY, email.trim());
      localStorage.setItem(REMEMBER_PWD_KEY, password);
      onUnlock();
    } catch {
      setError('Usuário ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#E4E3E0] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-2 mb-8">
          <div className="w-12 h-12 bg-[#141414] rounded-full flex items-center justify-center">
            <Lock size={20} className="text-white" />
          </div>
          <span className="font-serif italic text-2xl font-bold text-[#141414]">Painel bloqueado</span>
          <p className="text-sm text-[#141414]/50 text-center">Informe suas credenciais para continuar</p>
        </div>

        <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#141414]/60 mb-1.5 uppercase tracking-wide">
                E-mail
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
                className="w-full border border-[#141414]/15 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#141414]/20 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#141414]/60 mb-1.5 uppercase tracking-wide">
                Senha
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full border border-[#141414]/15 rounded-xl px-4 py-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-[#141414]/20 bg-white"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#141414]/40 hover:text-[#141414] transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm font-medium">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#141414] text-white rounded-xl py-3 text-sm font-semibold hover:opacity-80 disabled:opacity-50 transition-opacity mt-2"
            >
              {loading ? 'Verificando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
