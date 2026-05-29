import { useNavigate } from 'react-router-dom';

interface LandingPageProps {
  ownerUser?: any;
}

export default function LandingPage({ ownerUser }: LandingPageProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-[#141414]/10 bg-[#E4E3E0]">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-2xl font-bold">FechaConta</span>
        </div>
        <button
          onClick={() => navigate(ownerUser ? '/portal' : '/login')}
          className="px-5 py-2 rounded-xl border border-[#141414] text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors font-semibold"
        >
          {ownerUser ? 'Painel' : 'Entrar'}
        </button>
      </header>

      {/* Hero */}
      <section className="flex flex-col items-center justify-center text-center px-6 pt-24 pb-20">
        <h1 className="font-serif italic text-5xl md:text-6xl font-bold max-w-3xl leading-tight mb-6">
          O sistema PDV que seu restaurante merece
        </h1>
        <p className="text-[#141414]/60 text-lg max-w-xl mb-10">
          Gerencie mesas, comandas, pedidos e estoque em tempo real. Simples, rápido e feito para restaurantes modernos.
        </p>
        <button
          onClick={() => navigate(ownerUser ? '/portal' : '/login')}
          className="px-8 py-4 bg-[#141414] text-[#E4E3E0] rounded-xl text-lg font-bold hover:opacity-90 transition-opacity"
        >
          {ownerUser ? 'Ir para o Painel' : 'Começar gratuitamente'}
        </button>
      </section>

      {/* Feature Cards */}
      <section className="px-6 pb-20">
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl p-8 border border-[#141414]/10 shadow-sm">
            <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-[#E4E3E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 0v10m0 0a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
              </svg>
            </div>
            <h3 className="font-serif italic text-xl font-bold mb-2">Mesas em tempo real</h3>
            <p className="text-[#141414]/60">
              Visualize o status de todas as mesas e comandas instantaneamente. Nada fica desatualizado.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 border border-[#141414]/10 shadow-sm">
            <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-[#E4E3E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h3 className="font-serif italic text-xl font-bold mb-2">App do garçom</h3>
            <p className="text-[#141414]/60">
              Garçons lançam pedidos diretamente pelo celular. Sem papel, sem atraso, sem erro.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 border border-[#141414]/10 shadow-sm">
            <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center mb-5">
              <svg className="w-6 h-6 text-[#E4E3E0]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="font-serif italic text-xl font-bold mb-2">Relatórios e estoque</h3>
            <p className="text-[#141414]/60">
              Acompanhe vendas, movimentação de estoque e desempenho dos garçons em um só lugar.
            </p>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 pb-24 bg-white">
        <div className="max-w-4xl mx-auto pt-20">
          <h2 className="font-serif italic text-4xl font-bold text-center mb-4">Preços simples</h2>
          <p className="text-center text-[#141414]/60 mb-14">Sem surpresas. Comece de graça, cresça quando precisar.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Free */}
            <div className="rounded-2xl border border-[#141414]/10 p-8">
              <p className="font-semibold text-[#141414]/50 mb-2 uppercase text-sm tracking-widest">Gratuito</p>
              <p className="font-serif italic text-5xl font-bold mb-1">R$ 0</p>
              <p className="text-[#141414]/50 mb-8">para sempre</p>
              <ul className="space-y-3 mb-8">
                {['Até 10 mesas', '1 usuário admin', 'Cardápio digital', 'App do garçom'].map(f => (
                  <li key={f} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-[#141414]/10 flex items-center justify-center text-[#141414] text-xs font-bold">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate(ownerUser ? '/portal' : '/login')}
                className="w-full py-3 rounded-xl border border-[#141414] text-[#141414] font-semibold hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors"
              >
                {ownerUser ? 'Acessar meu Painel' : 'Começar grátis'}
              </button>
            </div>

            {/* Pro */}
            <div className="rounded-2xl bg-[#141414] text-[#E4E3E0] p-8">
              <p className="font-semibold text-[#E4E3E0]/50 mb-2 uppercase text-sm tracking-widest">Pro</p>
              <p className="font-serif italic text-5xl font-bold mb-1">R$ 99</p>
              <p className="text-[#E4E3E0]/50 mb-8">por mês</p>
              <ul className="space-y-3 mb-8">
                {['Mesas ilimitadas', 'Múltiplos garçons', 'Relatórios avançados', 'Controle de estoque', 'Suporte prioritário'].map(f => (
                  <li key={f} className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full bg-[#E4E3E0]/20 flex items-center justify-center text-[#E4E3E0] text-xs font-bold">✓</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => navigate(ownerUser ? '/portal' : '/login')}
                className="w-full py-3 rounded-xl bg-[#E4E3E0] text-[#141414] font-semibold hover:opacity-90 transition-opacity"
              >
                {ownerUser ? 'Upgrade no Painel' : 'Assinar Pro'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-8 py-8 border-t border-[#141414]/10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-lg font-bold">FechaConta</span>
        </div>
        <p className="text-[#141414]/40 text-sm">© {new Date().getFullYear()} FechaConta. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}
