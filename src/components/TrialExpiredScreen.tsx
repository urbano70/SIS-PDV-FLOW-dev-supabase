import { signOutOwner } from '../lib/auth';

interface TrialExpiredScreenProps {
  plan?: string;
}

export default function TrialExpiredScreen({ plan }: TrialExpiredScreenProps) {
  const handleLogout = async () => {
    try { await signOutOwner(); } catch {}
    window.location.href = '/login';
  };

  const handleSubscribe = () => {
    window.location.href = '/login?plan=pro';
  };

  const isPro = plan === 'premium';

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4 font-sans text-[#141414]">
      <div className="max-w-md w-full">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-2xl font-bold">FechaConta</span>
        </div>

        <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-8 text-center">
          <div className="w-16 h-16 bg-green-50 border border-green-200 rounded-full flex items-center justify-center mx-auto mb-6">
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </div>

          <h2 className="font-serif italic text-2xl font-bold mb-4">
            Período de avaliação encerrado
          </h2>

          <p className="text-[#141414]/70 text-base leading-relaxed mb-8">
            Obrigado por utilizar nossos serviços durante esses dias. Saiba que ficaremos muito felizes por ter você como nosso cliente. <strong>Continue com a gente!</strong>
          </p>

          {!isPro && (
            <button
              onClick={handleSubscribe}
              className="w-full py-4 bg-[#141414] text-[#E4E3E0] rounded-xl font-bold text-base hover:opacity-90 transition-opacity mb-3 flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3l14 9-14 9V3z" />
              </svg>
              Assinar Plano Pro
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full py-2 text-sm text-[#141414]/40 hover:text-[#141414]/70 transition-colors"
          >
            Sair da conta
          </button>
        </div>

        <p className="text-center text-[#141414]/30 text-xs mt-6">
          © {new Date().getFullYear()} FechaConta. Todos os direitos reservados.
        </p>
      </div>
    </div>
  );
}
