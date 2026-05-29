import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { signInOwner, signUpOwner, sendPasswordReset, updateUserPassword } from '../lib/auth';
import { Eye, EyeOff } from 'lucide-react';

const REMEMBER_KEY     = 'fechaconta_remembered_email';
const REMEMBER_PWD_KEY = 'fechaconta_remembered_pwd';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReset = searchParams.get('mode') === 'reset';

  const [mode, setMode] = useState<'login' | 'signup' | 'forgot' | 'reset'>(
    isReset ? 'reset' : 'login'
  );
  const [email, setEmail] = useState(() => localStorage.getItem(REMEMBER_KEY) || '');
  const [password, setPassword] = useState(() => localStorage.getItem(REMEMBER_PWD_KEY) || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [establishmentName, setEstablishmentName] = useState('');
  const [remember, setRemember] = useState(() => !!localStorage.getItem(REMEMBER_KEY));
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (isReset) setMode('reset');
  }, [isReset]);

  const reset = () => { setError(''); setSuccessMsg(''); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setLoading(true);
    try {
      if (mode === 'login') {
        await signInOwner(email, password);
        if (remember) {
          localStorage.setItem(REMEMBER_KEY, email);
          localStorage.setItem(REMEMBER_PWD_KEY, password);
        } else {
          localStorage.removeItem(REMEMBER_KEY);
          localStorage.removeItem(REMEMBER_PWD_KEY);
        }
        navigate('/portal');

      } else if (mode === 'signup') {
        await signUpOwner(email, password, establishmentName);
        setSuccessMsg('Verifique seu e-mail para confirmar o cadastro antes de entrar.');

      } else if (mode === 'forgot') {
        await sendPasswordReset(email);
        setSuccessMsg('E-mail de recuperação enviado! Verifique sua caixa de entrada.');

      } else if (mode === 'reset') {
        if (newPassword !== confirmPassword) {
          setError('As senhas não coincidem.');
          return;
        }
        if (newPassword.length < 6) {
          setError('A senha deve ter pelo menos 6 caracteres.');
          return;
        }
        await updateUserPassword(newPassword);
        setSuccessMsg('Senha alterada com sucesso!');
        setTimeout(() => navigate('/portal'), 2000);
      }
    } catch (err: any) {
      setError(err?.message || 'Ocorreu um erro. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const titles: Record<string, string> = {
    login: 'Entrar',
    signup: 'Criar conta',
    forgot: 'Recuperar senha',
    reset: 'Nova senha',
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-9 h-9 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-3xl font-bold text-[#141414]">FechaConta</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-8">
          {/* Toggle — only for login/signup */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="flex rounded-xl bg-[#E4E3E0] p-1 mb-8">
              <button
                type="button"
                onClick={() => { setMode('login'); reset(); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  mode === 'login' ? 'bg-white text-[#141414] shadow-sm' : 'text-[#141414]/50'
                }`}
              >
                Entrar
              </button>
              <button
                type="button"
                onClick={() => { setMode('signup'); reset(); }}
                className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  mode === 'signup' ? 'bg-white text-[#141414] shadow-sm' : 'text-[#141414]/50'
                }`}
              >
                Criar conta
              </button>
            </div>
          )}

          {/* Forgot/Reset heading */}
          {(mode === 'forgot' || mode === 'reset') && (
            <h2 className="font-serif italic text-2xl font-bold text-[#141414] mb-6">
              {titles[mode]}
            </h2>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Signup: establishment name */}
            {mode === 'signup' && (
              <div>
                <label className="block text-sm font-semibold text-[#141414] mb-1">
                  Nome do estabelecimento
                </label>
                <input
                  type="text"
                  value={establishmentName}
                  onChange={e => setEstablishmentName(e.target.value)}
                  placeholder="Ex: Pizzaria do João"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                />
              </div>
            )}

            {/* Email — shown in all modes except reset */}
            {mode !== 'reset' && (
              <div>
                <label className="block text-sm font-semibold text-[#141414] mb-1">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                />
              </div>
            )}

            {/* Password — login and signup */}
            {(mode === 'login' || mode === 'signup') && (
              <div>
                <label className="block text-sm font-semibold text-[#141414] mb-1">Senha</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full px-4 py-3 pr-11 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#141414]/40 hover:text-[#141414]/70"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            {/* New password fields — reset mode */}
            {mode === 'reset' && (
              <>
                <div>
                  <label className="block text-sm font-semibold text-[#141414] mb-1">Nova senha</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full px-4 py-3 pr-11 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                    />
                    <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#141414]/40 hover:text-[#141414]/70">
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-[#141414] mb-1">Confirmar senha</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-[#141414] placeholder-[#141414]/30 focus:outline-none focus:ring-2 focus:ring-[#141414]/20"
                  />
                </div>
              </>
            )}

            {/* Remember me + Forgot password row — login only */}
            {mode === 'login' && (
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={e => setRemember(e.target.checked)}
                    className="w-4 h-4 rounded border-[#141414]/30 accent-[#141414]"
                  />
                  <span className="text-sm text-[#141414]/60">Memorizar</span>
                </label>
                <button
                  type="button"
                  onClick={() => { setMode('forgot'); reset(); }}
                  className="text-sm text-[#141414]/50 hover:text-[#141414] underline underline-offset-2 transition-colors"
                >
                  Esqueci a senha
                </button>
              </div>
            )}

            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}

            {successMsg && (
              <div className="px-4 py-3 rounded-xl bg-green-50 border border-green-200 text-green-700 text-sm">
                {successMsg}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-[#141414] text-[#E4E3E0] rounded-xl font-bold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Aguarde...' : titles[mode]}
            </button>
          </form>

          {/* Back to login link */}
          {(mode === 'forgot' || mode === 'reset') && (
            <button
              type="button"
              onClick={() => { setMode('login'); reset(); }}
              className="w-full mt-4 text-sm text-[#141414]/50 hover:text-[#141414] transition-colors text-center underline underline-offset-2"
            >
              Voltar ao login
            </button>
          )}
        </div>

        <p className="text-center text-[#141414]/40 text-sm mt-6">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="underline underline-offset-2 hover:text-[#141414] transition-colors"
          >
            Voltar ao início
          </button>
        </p>
      </div>
    </div>
  );
}
