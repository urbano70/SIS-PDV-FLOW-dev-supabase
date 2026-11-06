import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import {
  BellRing, UtensilsCrossed, ClipboardList, Star, CheckCircle,
  Loader2, Lock, ChevronRight, CreditCard, ArrowLeft, Search, Sparkles
} from 'lucide-react';

type SessionState = 'checking' | 'active' | 'inactive';
type CallState = 'idle' | 'loading' | 'sent';
type View = 'home' | 'cardapio' | 'comanda' | 'avaliacao';

export function ClientePage() {
  const { tenantId, mesaId } = useParams<{ tenantId: string; mesaId: string }>();
  const [session, setSession] = useState<SessionState>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [view, setView] = useState<View>('home');
  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mesaNum = Number(mesaId);
  const hasSession = session === 'active';

  const checkSession = async () => {
    try {
      const res = await fetch(`/api/cliente-session/${tenantId}/${mesaId}`);
      const data = await res.json();
      if (data.active) {
        setToken(data.token);
        setSession('active');
      } else {
        setToken(null);
        setSession('inactive');
      }
    } catch {
      setSession('inactive');
    }
  };

  useEffect(() => {
    if (!mesaNum || isNaN(mesaNum) || !tenantId) return;
    checkSession();
    pollRef.current = setInterval(checkSession, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [mesaId, tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('connect', () => { s.emit('client_connect', { tenantId }); });
    s.on('call_waiter_result', ({ success }: { success: boolean }) => {
      if (success) {
        setCallState('sent');
        setTimeout(() => setCallState('idle'), 3 * 60 * 1000);
      } else {
        setCallState('idle');
      }
    });
    return () => { s.disconnect(); };
  }, [tenantId]);

  const handleCallWaiter = () => {
    if (callState !== 'idle' || !socketRef.current) return;
    setCallState('loading');
    socketRef.current.emit('call_waiter', { tableId: mesaNum, rateLimitMinutes: 3 });
  };

  if (!mesaNum || isNaN(mesaNum) || !tenantId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F4F0]">
        <p className="text-slate-500 text-sm">QR Code inválido.</p>
      </div>
    );
  }

  if (session === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="animate-spin text-orange-400" size={32} />
      </div>
    );
  }

  if (view === 'cardapio') {
    return <CardapioView mesaNum={mesaNum} onBack={() => setView('home')} />;
  }

  if (view === 'comanda' && hasSession) {
    return <ComandaView mesaId={mesaNum} tenantId={tenantId!} token={token} onBack={() => setView('home')} />;
  }

  if (view === 'avaliacao' && hasSession) {
    return <AvaliacaoView mesaId={mesaNum} socketRef={socketRef} onBack={() => setView('home')} />;
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Hero header */}
      <div className="relative bg-[#1a1a1a] overflow-hidden" style={{ minHeight: 220 }}>
        {/* Gradient overlay background */}
        <div className="absolute inset-0 bg-gradient-to-b from-orange-900/60 via-[#1a1a1a]/80 to-[#1a1a1a]" />
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'radial-gradient(circle at 30% 50%, #f97316 0%, transparent 60%), radial-gradient(circle at 70% 20%, #ea580c 0%, transparent 50%)' }} />

        <div className="relative z-10 flex flex-col items-center pt-10 pb-6 px-5">
          {/* Logo */}
          <div className="w-16 h-16 rounded-full bg-[#2a2a2a] border-2 border-white/20 flex items-center justify-center mb-3 shadow-lg">
            <UtensilsCrossed size={28} className="text-orange-400" />
          </div>

          <h1 className="text-white font-black text-xl tracking-wide uppercase">Meu Restaurante</h1>

          <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
            <span className="bg-white/10 text-white text-[11px] font-bold px-3 py-1 rounded-full border border-white/20">
              Mesa {mesaNum}
            </span>
            {hasSession ? (
              <span className="bg-green-500/20 text-green-300 text-[11px] font-semibold px-3 py-1 rounded-full border border-green-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                Presença confirmada
              </span>
            ) : (
              <span className="bg-white/10 text-white/50 text-[11px] font-semibold px-3 py-1 rounded-full border border-white/10">
                Aguardando atendimento
              </span>
            )}
          </div>

          <p className="text-white/60 text-xs mt-4 text-center">Como podemos ajudar?</p>
          <p className="text-white/40 text-[11px] mt-0.5 text-center">
            Toque no botão abaixo para chamar nossa equipe diretamente até sua mesa.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 pb-8 -mt-2 bg-[#F8F7F4] rounded-t-3xl pt-6 space-y-3">

        {/* Primary CTA: Chamar Garçom */}
        <button
          onClick={handleCallWaiter}
          disabled={callState !== 'idle'}
          className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl transition-all active:scale-[0.98] shadow-sm ${
            callState === 'sent'
              ? 'bg-green-500 text-white'
              : 'bg-orange-500 text-white hover:bg-orange-600'
          }`}
        >
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${callState === 'sent' ? 'bg-green-600' : 'bg-orange-600'}`}>
            {callState === 'loading' ? (
              <Loader2 size={20} className="text-white animate-spin" />
            ) : callState === 'sent' ? (
              <CheckCircle size={20} className="text-white" />
            ) : (
              <BellRing size={20} className="text-white" />
            )}
          </div>
          <div className="text-left flex-1">
            <p className="text-[9px] uppercase tracking-widest font-semibold opacity-70">Ação principal</p>
            <p className="font-black text-base leading-tight">
              {callState === 'sent' ? 'Garçom a caminho!' : 'Chamar garçom'}
            </p>
          </div>
          {callState === 'idle' && <ChevronRight size={18} className="opacity-60 shrink-0" />}
        </button>

        {/* Secondary actions: 2-column grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Ver cardápio */}
          <button
            onClick={() => setView('cardapio')}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-[#141414]/8 hover:border-orange-200 transition-all active:scale-[0.97] shadow-sm"
          >
            <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center">
              <UtensilsCrossed size={20} className="text-rose-500" />
            </div>
            <div className="text-center">
              <p className="font-bold text-sm text-[#141414]">Ver cardápio</p>
              <p className="text-[10px] text-[#141414]/40 mt-0.5">Fotos e preços</p>
            </div>
          </button>

          {/* Pedir a conta / Minha Comanda */}
          {hasSession ? (
            <button
              onClick={() => setView('comanda')}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-[#141414]/8 hover:border-blue-200 transition-all active:scale-[0.97] shadow-sm"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                <ClipboardList size={20} className="text-blue-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-sm text-[#141414]">Minha comanda</p>
                <p className="text-[10px] text-[#141414]/40 mt-0.5">Ver pedidos</p>
              </div>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/60 border border-[#141414]/5 cursor-not-allowed">
              <div className="w-10 h-10 rounded-xl bg-[#141414]/6 flex items-center justify-center">
                <Lock size={18} className="text-[#141414]/25" />
              </div>
              <div className="text-center">
                <p className="font-bold text-sm text-[#141414]/30">Minha comanda</p>
                <p className="text-[10px] text-[#141414]/25 mt-0.5">Ver pedidos</p>
              </div>
            </div>
          )}

          {/* Pedir conta */}
          <button
            onClick={handleCallWaiter}
            disabled={callState !== 'idle'}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-[#141414]/8 hover:border-emerald-200 transition-all active:scale-[0.97] shadow-sm"
          >
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
              <CreditCard size={20} className="text-emerald-600" />
            </div>
            <div className="text-center">
              <p className="font-bold text-sm text-[#141414]">Pedir a conta</p>
              <p className="text-[10px] text-[#141414]/40 mt-0.5">Pagamento na mesa</p>
            </div>
          </button>

          {/* Avaliar */}
          {hasSession ? (
            <button
              onClick={() => setView('avaliacao')}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white border border-[#141414]/8 hover:border-yellow-200 transition-all active:scale-[0.97] shadow-sm"
            >
              <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
                <Star size={20} className="text-yellow-500" />
              </div>
              <div className="text-center">
                <p className="font-bold text-sm text-[#141414]">Avaliar</p>
                <p className="text-[10px] text-[#141414]/40 mt-0.5">Sua opinião</p>
              </div>
            </button>
          ) : (
            <div className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/60 border border-[#141414]/5 cursor-not-allowed">
              <div className="w-10 h-10 rounded-xl bg-[#141414]/6 flex items-center justify-center">
                <Lock size={18} className="text-[#141414]/25" />
              </div>
              <div className="text-center">
                <p className="font-bold text-sm text-[#141414]/30">Avaliar</p>
                <p className="text-[10px] text-[#141414]/25 mt-0.5">Sua opinião</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-[9px] opacity-20 pb-5 font-mono bg-[#F8F7F4]">
        Mesa {mesaNum} · {hasSession ? 'Sessão ativa' : 'Aguardando atendimento'}
      </p>
    </div>
  );
}

function CardapioView({ mesaNum, onBack }: { mesaNum: number; onBack: () => void }) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState('todos');

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-10 pb-3 bg-white border-b border-[#141414]/6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[#141414]/60 text-sm font-medium hover:text-[#141414] transition-colors">
          <ArrowLeft size={16} />
          Voltar para a mesa
        </button>
        <span className="text-[11px] font-semibold text-[#141414]/40 bg-[#141414]/5 px-2.5 py-1 rounded-full">— itens</span>
      </div>

      {/* Restaurant info */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#141414]/6">
        <div className="w-10 h-10 rounded-full bg-[#1a1a1a] flex items-center justify-center shrink-0">
          <UtensilsCrossed size={18} className="text-orange-400" />
        </div>
        <div>
          <p className="font-black text-sm text-[#141414]">Meu Restaurante</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold text-orange-500 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full uppercase tracking-wide">Cardápio</span>
            <span className="text-[10px] text-[#141414]/40">Mesa {mesaNum}</span>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="px-4 py-3 border-b border-[#141414]/6">
        <div className="flex items-center gap-2 bg-[#141414]/5 rounded-xl px-3 py-2.5">
          <Search size={15} className="text-[#141414]/30 shrink-0" />
          <input
            type="text"
            placeholder="Buscar no cardápio..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-transparent text-sm text-[#141414] placeholder:text-[#141414]/30 outline-none flex-1"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto scrollbar-none border-b border-[#141414]/6">
        {[
          { key: 'todos', label: 'Todos' },
          { key: 'destaques', label: 'Destaques', icon: <Sparkles size={11} className="inline mr-1" /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
              activeTab === tab.key
                ? 'bg-[#141414] text-white'
                : 'bg-[#141414]/6 text-[#141414]/60 hover:bg-[#141414]/10'
            }`}
          >
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">
        <UtensilsCrossed size={40} className="mb-4 text-[#141414]/15" />
        <p className="font-bold text-sm text-[#141414]/50">Cardápio em breve</p>
        <p className="text-xs text-[#141414]/30 mt-1 max-w-[220px]">
          Peça ao garçom para ver as opções disponíveis.
        </p>
      </div>
    </div>
  );
}

function ComandaView({ mesaId, tenantId, token, onBack }: { mesaId: number; tenantId: string; token: string | null; onBack: () => void }) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('connect', () => { s.emit('client_connect', { tenantId }); });
    s.on('update_orders', (orders: any[]) => {
      const active = orders.find(
        (o: any) => String(o.tableId) === String(mesaId) && !o.isComanda && o.status !== 'finalizada'
      );
      setOrder(active || null);
      setLoading(false);
    });
    return () => { s.disconnect(); };
  }, [mesaId, tenantId]);

  const items = order ? (order.items || []).filter((i: any) => !i.removed) : [];
  const total = items.reduce((acc: number, i: any) => acc + i.price, 0);

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-10 pb-3 bg-white border-b border-[#141414]/6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[#141414]/60 text-sm font-medium hover:text-[#141414] transition-colors">
          <ArrowLeft size={16} />
          Voltar para a mesa
        </button>
        {items.length > 0 && (
          <span className="text-[11px] font-semibold text-[#141414]/40 bg-[#141414]/5 px-2.5 py-1 rounded-full">{items.length} {items.length === 1 ? 'item' : 'itens'}</span>
        )}
      </div>

      {/* Restaurant info */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-[#141414]/6">
        <div className="w-10 h-10 rounded-full bg-[#1a1a1a] flex items-center justify-center shrink-0">
          <UtensilsCrossed size={18} className="text-orange-400" />
        </div>
        <div>
          <p className="font-black text-sm text-[#141414]">Meu Restaurante</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-bold text-blue-500 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full uppercase tracking-wide">Comanda</span>
            <span className="text-[10px] text-[#141414]/40">Mesa {mesaId}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-orange-400" size={28} /></div>
        ) : !items.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <ClipboardList size={40} className="mb-4 text-[#141414]/15" />
            <p className="font-bold text-sm text-[#141414]/50">Nenhum item ainda</p>
            <p className="text-xs text-[#141414]/30 mt-1">Seus pedidos aparecerão aqui.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#141414]/8 overflow-hidden shadow-sm">
            <div className="divide-y divide-[#141414]/5">
              {items.map((item: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center px-4 py-3.5">
                  <div className="flex-1 mr-4">
                    <p className="text-sm font-semibold text-[#141414]">
                      {item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                    </p>
                    {item.observations && <p className="text-[10px] text-blue-500 mt-0.5">{item.observations}</p>}
                  </div>
                  <span className="font-mono text-sm font-black text-[#141414] shrink-0">R$ {item.price.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="px-4 py-4 bg-[#141414]/3 border-t border-[#141414]/8 flex justify-between items-center">
              <span className="text-xs font-bold uppercase text-[#141414]/40 tracking-widest">Total</span>
              <span className="font-mono font-black text-xl text-[#141414]">R$ {total.toFixed(2)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AvaliacaoView({ mesaId, socketRef, onBack }: { mesaId: number; socketRef: React.MutableRefObject<Socket | null>; onBack: () => void }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!rating || !socketRef.current) return;
    socketRef.current.emit('cliente_avaliacao', { tableId: mesaId, rating, timestamp: new Date().toISOString() });
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-[#F8F7F4] flex flex-col">
      {/* Top bar */}
      <div className="flex items-center px-4 pt-10 pb-3 bg-white border-b border-[#141414]/6">
        <button onClick={onBack} className="flex items-center gap-1.5 text-[#141414]/60 text-sm font-medium hover:text-[#141414] transition-colors">
          <ArrowLeft size={16} />
          Voltar para a mesa
        </button>
      </div>

      <div className="flex-1 p-4 flex flex-col items-center justify-center">
        {sent ? (
          <div className="bg-white rounded-2xl border border-[#141414]/8 p-10 text-center shadow-sm w-full max-w-sm">
            <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
            <p className="font-black text-lg text-[#141414]">Obrigado pela avaliação!</p>
            <p className="text-xs text-[#141414]/40 mt-2">Seu feedback é muito importante para nós.</p>
            <button onClick={onBack} className="mt-6 w-full py-3 rounded-xl bg-[#141414] text-white text-sm font-bold">Voltar para a mesa</button>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-[#141414]/8 p-6 shadow-sm w-full max-w-sm">
            <div className="text-center mb-6">
              <Star size={36} className="mx-auto mb-3 text-yellow-400 fill-yellow-400" />
              <p className="font-black text-lg text-[#141414]">Como foi seu atendimento?</p>
              <p className="text-xs text-[#141414]/40 mt-1">Toque nas estrelas para avaliar</p>
            </div>
            <div className="flex justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map(star => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHovered(star)}
                  onMouseLeave={() => setHovered(0)}
                  className="transition-transform active:scale-90 p-1"
                >
                  <Star
                    size={36}
                    className={`transition-colors ${(hovered || rating) >= star ? 'text-yellow-400 fill-yellow-400' : 'text-[#141414]/15'}`}
                  />
                </button>
              ))}
            </div>
            <button
              onClick={handleSend}
              disabled={!rating}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all ${
                rating ? 'bg-orange-500 text-white hover:bg-orange-600 active:scale-[0.98]' : 'bg-[#141414]/8 text-[#141414]/30 cursor-not-allowed'
              }`}
            >
              Enviar Avaliação
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
