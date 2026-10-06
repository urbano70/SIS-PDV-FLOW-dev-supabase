import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { io, Socket } from 'socket.io-client';
import { BellRing, CheckCircle, XCircle, Loader2 } from 'lucide-react';

type Status = 'idle' | 'loading' | 'success' | 'error';

export function ChamarGarcomPage() {
  const { tableId } = useParams<{ tableId: string }>();
  const [status, setStatus] = useState<Status>('idle');
  const [rateLimitMinutes, setRateLimitMinutes] = useState(3);
  const rateLimitRef = useRef(3);
  const socketRef = useRef<Socket | null>(null);

  const tableNum = Number(tableId);

  useEffect(() => {
    // Lê rate limit do QR (query param opcional)
    const params = new URLSearchParams(window.location.search);
    const rl = Number(params.get('rl'));
    if (rl > 0) { setRateLimitMinutes(rl); rateLimitRef.current = rl; }

    const s = io({ transports: ['websocket', 'polling'] });
    socketRef.current = s;

    s.on('call_waiter_result', ({ success }: { success: boolean }) => {
      if (success) {
        setStatus('success');
        setTimeout(() => setStatus('idle'), rateLimitRef.current * 60 * 1000);
      } else {
        setStatus('error');
      }
    });

    return () => { s.disconnect(); };
  }, []);

  const handleCall = () => {
    if (status === 'loading' || status === 'success') return;
    if (!socketRef.current) return;
    setStatus('loading');
    socketRef.current.emit('call_waiter', { tableId: tableNum, rateLimitMinutes });
  };

  if (!tableNum || isNaN(tableNum)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F4F0]">
        <p className="text-slate-500 text-sm">QR Code inválido.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F4F0] px-6">
      <div className="w-full max-w-xs flex flex-col items-center gap-8">

        {/* Logo / cabeçalho */}
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#141414] flex items-center justify-center shadow-lg">
            <BellRing className="text-white" size={26} />
          </div>
          <p className="text-[11px] uppercase tracking-widest text-slate-400 font-semibold mt-1">Atendimento</p>
          <h1 className="text-3xl font-black tracking-tight text-[#141414]">
            Mesa <span className="text-orange-500">{tableNum}</span>
          </h1>
        </div>

        {/* Botão / feedback */}
        {status === 'idle' && (
          <button
            onClick={handleCall}
            className="w-full py-4 rounded-2xl bg-[#141414] text-white text-sm font-bold uppercase tracking-widest shadow-lg active:scale-95 transition-transform"
          >
            Chamar Garçom
          </button>
        )}

        {status === 'loading' && (
          <div className="flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={32} className="animate-spin text-[#141414]" />
            <p className="text-xs">Enviando solicitação...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <CheckCircle size={44} className="text-emerald-500" />
            <p className="text-base font-bold text-[#141414]">Garçom a caminho!</p>
            <p className="text-xs text-slate-400">Aguarde um momento, por favor.</p>
            <p className="text-[10px] text-slate-300 mt-1">
              Você poderá chamar novamente em alguns instantes.
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <XCircle size={44} className="text-slate-300" />
            <p className="text-sm text-slate-500 leading-relaxed">
              Desculpe, por algum motivo não foi possível registrar sua solicitação.
            </p>
            <button
              onClick={() => setStatus('idle')}
              className="px-5 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-500 hover:bg-slate-100 transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
