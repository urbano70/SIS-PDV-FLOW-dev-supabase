import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { BellRing, UtensilsCrossed, ClipboardList, Star, CheckCircle, Loader2, Lock } from 'lucide-react';

type SessionState = 'checking' | 'active' | 'inactive';
type CallState = 'idle' | 'loading' | 'sent';

export function ClientePage() {
  const { mesaId } = useParams<{ mesaId: string }>();
  const [session, setSession] = useState<SessionState>('checking');
  const [token, setToken] = useState<string | null>(null);
  const [callState, setCallState] = useState<CallState>('idle');
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const mesaNum = Number(mesaId);

  const checkSession = async () => {
    try {
      const res = await fetch(`/api/cliente-session/${mesaId}`);
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
    if (!mesaNum || isNaN(mesaNum)) return;
    checkSession();
    // Polling a cada 30s para detectar ativação/expiração
    pollRef.current = setInterval(checkSession, 30_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [mesaId]);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('call_waiter_result', ({ success }: { success: boolean }) => {
      if (success) {
        setCallState('sent');
        setTimeout(() => setCallState('idle'), 3 * 60 * 1000);
      } else {
        setCallState('idle');
      }
    });
    return () => { s.disconnect(); };
  }, []);

  const handleCallWaiter = () => {
    if (callState !== 'idle' || !socketRef.current) return;
    setCallState('loading');
    socketRef.current.emit('call_waiter', { tableId: mesaNum, rateLimitMinutes: 3 });
  };

  if (!mesaNum || isNaN(mesaNum)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F4F0]">
        <p className="text-slate-500 text-sm">QR Code inválido.</p>
      </div>
    );
  }

  if (session === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F4F0]">
        <Loader2 className="animate-spin text-[#141414]/40" size={32} />
      </div>
    );
  }

  if (session === 'inactive') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F4F0] p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-white border-2 border-[#141414]/10 flex items-center justify-center mb-6 shadow-sm">
          <Lock size={32} className="text-[#141414]/30" />
        </div>
        <h1 className="font-serif italic text-2xl mb-2">Mesa {mesaNum}</h1>
        <p className="text-sm text-[#141414]/50 max-w-xs">
          Esta mesa ainda não possui uma comanda ativa.<br />
          Aguarde o atendimento do garçom.
        </p>
        <button
          onClick={checkSession}
          className="mt-8 px-6 py-3 bg-[#141414] text-[#E4E3E0] rounded-2xl font-bold text-sm"
        >
          Verificar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F4F0] flex flex-col">
      {/* Header */}
      <div className="bg-[#141414] text-[#E4E3E0] px-6 pt-10 pb-8">
        <p className="text-[10px] uppercase tracking-widest opacity-40 font-bold mb-1">Bem-vindo</p>
        <h1 className="font-serif italic text-3xl">Mesa {mesaNum}</h1>
        <p className="text-xs opacity-40 mt-1">Como posso ajudar?</p>
      </div>

      {/* Menu principal */}
      <div className="flex-1 p-5 space-y-3">

        {/* Chamar Garçom */}
        <button
          onClick={handleCallWaiter}
          disabled={callState !== 'idle'}
          className={`w-full flex items-center gap-4 p-5 rounded-2xl border-2 transition-all active:scale-[0.98] ${
            callState === 'sent'
              ? 'bg-green-50 border-green-300 text-green-700'
              : 'bg-white border-[#141414]/10 text-[#141414] hover:border-[#141414]/30'
          }`}
        >
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${callState === 'sent' ? 'bg-green-100' : 'bg-[#141414]'}`}>
            {callState === 'loading' ? (
              <Loader2 size={22} className="text-white animate-spin" />
            ) : callState === 'sent' ? (
              <CheckCircle size={22} className="text-green-600" />
            ) : (
              <BellRing size={22} className="text-[#E4E3E0]" />
            )}
          </div>
          <div className="text-left">
            <p className="font-bold text-base">
              {callState === 'sent' ? 'Garçom a caminho!' : 'Chamar Garçom'}
            </p>
            <p className="text-xs opacity-50">
              {callState === 'sent' ? 'Aguarde, estamos te atendendo.' : 'Solicitar atendimento na mesa'}
            </p>
          </div>
        </button>

        {/* Cardápio */}
        <button
          onClick={() => setActiveSection(activeSection === 'cardapio' ? null : 'cardapio')}
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-[#141414]/10 bg-white text-[#141414] hover:border-[#141414]/30 transition-all active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-500 flex items-center justify-center shrink-0">
            <UtensilsCrossed size={22} className="text-white" />
          </div>
          <div className="text-left">
            <p className="font-bold text-base">Cardápio Digital</p>
            <p className="text-xs opacity-50">Veja nossos pratos e bebidas</p>
          </div>
        </button>

        {/* Ver Comanda */}
        <button
          onClick={() => setActiveSection(activeSection === 'comanda' ? null : 'comanda')}
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-[#141414]/10 bg-white text-[#141414] hover:border-[#141414]/30 transition-all active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <ClipboardList size={22} className="text-white" />
          </div>
          <div className="text-left">
            <p className="font-bold text-base">Minha Comanda</p>
            <p className="text-xs opacity-50">Veja os itens do seu pedido</p>
          </div>
        </button>

        {/* Avaliação */}
        <button
          onClick={() => setActiveSection(activeSection === 'avaliacao' ? null : 'avaliacao')}
          className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-[#141414]/10 bg-white text-[#141414] hover:border-[#141414]/30 transition-all active:scale-[0.98]"
        >
          <div className="w-12 h-12 rounded-xl bg-yellow-400 flex items-center justify-center shrink-0">
            <Star size={22} className="text-white" />
          </div>
          <div className="text-left">
            <p className="font-bold text-base">Avaliar Atendimento</p>
            <p className="text-xs opacity-50">Sua opinião é muito importante</p>
          </div>
        </button>

        {/* Seção: Comanda */}
        {activeSection === 'comanda' && (
          <ComandaSection mesaId={mesaNum} token={token} />
        )}

        {/* Seção: Avaliação */}
        {activeSection === 'avaliacao' && (
          <AvaliacaoSection mesaId={mesaNum} socketRef={socketRef} />
        )}

        {/* Seção: Cardápio — placeholder */}
        {activeSection === 'cardapio' && (
          <div className="bg-white rounded-2xl border border-[#141414]/10 p-6 text-center">
            <UtensilsCrossed size={32} className="mx-auto mb-3 opacity-20" />
            <p className="text-sm font-bold">Cardápio em breve</p>
            <p className="text-xs opacity-40 mt-1">Peça ao garçom para ver as opções disponíveis.</p>
          </div>
        )}
      </div>

      <p className="text-center text-[9px] opacity-20 pb-6 font-mono">Mesa {mesaNum} · Sessão ativa</p>
    </div>
  );
}

function ComandaSection({ mesaId, token }: { mesaId: number; token: string | null }) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('update_orders', (orders: any[]) => {
      const active = orders.find(
        (o: any) => String(o.tableId) === String(mesaId) && !o.isComanda && o.status !== 'finalizada'
      );
      setOrder(active || null);
      setLoading(false);
    });
    return () => { s.disconnect(); };
  }, [mesaId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin opacity-30" size={24} /></div>;

  if (!order || !(order.items || []).filter((i: any) => !i.removed).length) {
    return (
      <div className="bg-white rounded-2xl border border-[#141414]/10 p-6 text-center">
        <ClipboardList size={32} className="mx-auto mb-3 opacity-20" />
        <p className="text-sm font-bold">Nenhum item ainda</p>
        <p className="text-xs opacity-40 mt-1">Seus pedidos aparecerão aqui.</p>
      </div>
    );
  }

  const items = (order.items || []).filter((i: any) => !i.removed);
  const total = items.reduce((acc: number, i: any) => acc + i.price, 0);

  return (
    <div className="bg-white rounded-2xl border border-[#141414]/10 overflow-hidden">
      <div className="px-5 py-4 border-b border-[#141414]/8">
        <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest">Seus Pedidos</p>
      </div>
      <div className="divide-y divide-[#141414]/5">
        {items.map((item: any, idx: number) => (
          <div key={idx} className="flex justify-between items-center px-5 py-3">
            <div>
              <p className="text-sm font-medium">{item.quantity && item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}</p>
              {item.observations && <p className="text-[10px] text-blue-600 mt-0.5">{item.observations}</p>}
            </div>
            <span className="font-mono text-sm font-bold shrink-0 ml-4">R$ {item.price.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <div className="px-5 py-4 bg-[#141414]/3 border-t border-[#141414]/8 flex justify-between items-center">
        <span className="text-xs font-bold uppercase opacity-50">Total</span>
        <span className="font-mono font-black text-lg">R$ {total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function AvaliacaoSection({ mesaId, socketRef }: { mesaId: number; socketRef: React.MutableRefObject<Socket | null> }) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [sent, setSent] = useState(false);

  const handleSend = () => {
    if (!rating || !socketRef.current) return;
    socketRef.current.emit('cliente_avaliacao', { tableId: mesaId, rating, timestamp: new Date().toISOString() });
    setSent(true);
  };

  if (sent) {
    return (
      <div className="bg-white rounded-2xl border border-[#141414]/10 p-8 text-center">
        <CheckCircle size={40} className="mx-auto mb-3 text-green-500" />
        <p className="font-bold text-base">Obrigado pela avaliação!</p>
        <p className="text-xs opacity-40 mt-1">Seu feedback é muito importante para nós.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-[#141414]/10 p-6">
      <p className="text-sm font-bold mb-1">Como foi seu atendimento?</p>
      <p className="text-xs opacity-40 mb-5">Toque nas estrelas para avaliar</p>
      <div className="flex justify-center gap-3 mb-6">
        {[1, 2, 3, 4, 5].map(star => (
          <button
            key={star}
            onClick={() => setRating(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            className="transition-transform active:scale-90"
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
        className={`w-full py-3 rounded-2xl font-bold text-sm transition-all ${
          rating ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#141414]/10 text-[#141414]/30'
        }`}
      >
        Enviar Avaliação
      </button>
    </div>
  );
}
