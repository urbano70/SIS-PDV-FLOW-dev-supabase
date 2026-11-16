import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Copy, QrCode, RefreshCcw, UserMinus, UserPlus, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import socket from '../lib/socket';
import type { PlaygroundOperator } from '../lib/playgroundTypes';
import { emitPlaygroundAck, playgroundStatusLabel } from '../lib/playgroundClient';

export default function PlaygroundOperatorAccessCard({ tenantId, enabled }: { tenantId: string; enabled: boolean }) {
  const [operators, setOperators] = useState<PlaygroundOperator[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const url = useMemo(() => `${window.location.origin}/parquinho?tenant=${encodeURIComponent(tenantId)}`, [tenantId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const ack = await emitPlaygroundAck(socket, 'parquinho_get_operators');
    if (ack.ok && Array.isArray(ack.operators)) setOperators(ack.operators);
    else setError(ack.message || 'Não foi possível carregar os operadores.');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void load();
    const onStatus = (payload: { operatorId?: string; status?: PlaygroundOperator['status'] }) => {
      if (!payload?.operatorId || !payload.status) return;
      setOperators(prev => prev.map(operator => operator.id === payload.operatorId ? { ...operator, status: payload.status! } : operator));
    };
    socket.on('parquinho_operator_status', onStatus);
    return () => { socket.off('parquinho_operator_status', onStatus); };
  }, [enabled, load]);

  const setStatus = async (operatorId: string, status: 'approved' | 'inactive' | 'revoke') => {
    const ack = await emitPlaygroundAck(socket, 'parquinho_set_operator_status', { operatorId, status });
    if (!ack.ok) { toast.error(ack.message || 'Não foi possível atualizar o cadastro.'); return; }
    setOperators(prev => status === 'revoke' ? prev.filter(operator => operator.id !== operatorId) : prev.map(operator => operator.id === operatorId ? { ...operator, status } : operator));
    toast.success(status === 'approved' ? 'Operador aprovado.' : status === 'inactive' ? 'Operador inativado.' : 'Cadastro revogado.');
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1_500); }
    catch { toast.error('Não foi possível copiar o endereço.'); }
  };

  return (
    <div className="bg-white rounded-2xl border border-violet-200 shadow-sm p-4 mb-4">
      <div className="flex items-center gap-3 mb-3"><div className="w-9 h-9 bg-violet-100 text-violet-700 rounded-xl flex items-center justify-center"><QrCode size={18} /></div><div className="flex-1"><h3 className="font-serif italic text-lg leading-none">Operador de Parquinho</h3><p className="text-[9px] opacity-50 mt-1">QR por estabelecimento · aprovação real · sem senhas no painel</p></div><button type="button" onClick={() => void load()} disabled={!enabled || loading} className="p-2 rounded-lg hover:bg-violet-50 disabled:opacity-30" title="Atualizar operadores"><RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /></button></div>
      {!enabled ? <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-[10px] text-gray-500">Ative o Modo Parquinho em Configurações → Salão para liberar o QR e os cadastros.</div> : <div className="grid grid-cols-1 md:grid-cols-[190px_minmax(0,1fr)] gap-4"><div className="flex flex-col items-center"><div className="bg-white border border-[#141414]/10 rounded-xl p-2"><QRCodeSVG value={url} size={160} includeMargin /></div><div className="flex gap-1 mt-2 w-full"><code className="min-w-0 flex-1 bg-[#141414]/5 rounded-lg px-2 py-1.5 text-[7px] truncate">{url}</code><button type="button" onClick={() => void copy()} className="p-1.5 bg-[#141414] text-white rounded-lg" title="Copiar QR">{copied ? <CheckCircle size={11} /> : <Copy size={11} />}</button></div></div><div className="min-w-0">{error && <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 text-[9px] mb-2">{error}</p>}{loading && operators.length === 0 ? <p className="text-[10px] opacity-50 py-4">Carregando cadastros…</p> : operators.length === 0 ? <p className="text-[10px] opacity-50 py-4">Nenhum cadastro de operador.</p> : <div className="space-y-1.5 max-h-48 overflow-y-auto">{operators.map(operator => <div key={operator.id} className="flex items-center gap-2 border border-[#141414]/8 rounded-xl px-2.5 py-2"><div className="w-7 h-7 rounded-full bg-[#141414] text-white flex items-center justify-center font-black text-[10px]">{operator.name?.slice(0, 1).toUpperCase() || '?'}</div><div className="flex-1 min-w-0"><p className="text-[10px] font-bold truncate">{operator.name}</p><p className={`text-[8px] font-bold ${operator.status === 'approved' ? 'text-green-600' : operator.status === 'inactive' ? 'text-gray-500' : 'text-amber-600'}`}>{playgroundStatusLabel(operator.status)}</p></div><div className="flex gap-1">{operator.status !== 'approved' && <button type="button" onClick={() => void setStatus(operator.id, 'approved')} className="p-1.5 rounded-lg text-green-600 hover:bg-green-50" title="Aprovar"><UserPlus size={13} /></button>}{operator.status === 'approved' && <button type="button" onClick={() => void setStatus(operator.id, 'inactive')} className="p-1.5 rounded-lg text-amber-600 hover:bg-amber-50" title="Inativar"><UserMinus size={13} /></button>}<button type="button" onClick={() => void setStatus(operator.id, 'revoke')} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50" title="Revogar"><UserX size={13} /></button></div></div>)}</div>}</div></div>}
    </div>
  );
}
