import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, CircleUserRound, Clock3, LogIn, LogOut, Plus, RefreshCcw, Send, ShieldCheck, Wifi, WifiOff, X } from 'lucide-react';
import { toast } from 'sonner';
import type { PlaygroundData, PlaygroundOperator } from '../lib/playgroundTypes';
import {
  clearPendingPlaygroundForm,
  clearPlaygroundToken,
  createPlaygroundSocket,
  createRequestId,
  emitPlaygroundAck,
  formatPlaygroundMoney,
  getPlaygroundLaunchError,
  makePlaygroundLaunch,
  readPendingPlaygroundForm,
  readPlaygroundToken,
  trimChildName,
  writePendingPlaygroundForm,
  writePlaygroundToken,
  type PlaygroundPendingForm,
  type PlaygroundSocket,
} from '../lib/playgroundClient';

interface PlaygroundTerminalProps {
  tenantId: string;
  buildId?: string;
}

type AuthMode = 'login' | 'register';
type ScreenState = 'loading' | 'auth' | 'pending' | 'terminal';

const initialAuthForm = { name: '', password: '', phone: '', cpf: '', birthDate: '' };

function safeStatus(operator?: PlaygroundOperator | null): PlaygroundOperator['status'] | null {
  return operator?.status === 'approved' || operator?.status === 'inactive' ? operator.status : operator ? 'pending' : null;
}

function authMessage(status: PlaygroundOperator['status']): string {
  if (status === 'approved') return 'Acesso aprovado.';
  if (status === 'inactive') return 'Este cadastro está inativo. Fale com o gerente.';
  return 'Cadastro enviado. Aguarde a aprovação do gerente.';
}

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider ${connected ? 'text-green-300' : 'text-red-300'}`}>
      {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
      {connected ? 'Conectado' : 'Desconectado'}
    </span>
  );
}

export default function PlaygroundTerminal({ tenantId, buildId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : undefined }: PlaygroundTerminalProps) {
  const socketRef = useRef<PlaygroundSocket | null>(null);
  const resumeAttemptRef = useRef<string | null>(null);
  const pendingRef = useRef<PlaygroundPendingForm | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [screen, setScreen] = useState<ScreenState>('loading');
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authForm, setAuthForm] = useState(initialAuthForm);
  const [operator, setOperator] = useState<PlaygroundOperator | null>(null);
  const [data, setData] = useState<PlaygroundData | null>(null);
  const [authError, setAuthError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [childNames, setChildNames] = useState<string[]>(['']);
  const [showTablePopup, setShowTablePopup] = useState(false);
  const [pending, setPending] = useState<PlaygroundPendingForm | null>(null);
  const [resuming, setResuming] = useState(false);

  const currentToken = useCallback(() => readPlaygroundToken(tenantId), [tenantId]);

  const requestData = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    const ack = await emitPlaygroundAck(socket, 'parquinho_request_data');
    if (!ack.ok) {
      setSubmitError(ack.message || 'Não foi possível sincronizar o Parquinho.');
      return;
    }
    if (ack.data) setData(ack.data);
  }, []);

  const resumeSession = useCallback(async () => {
    const socket = socketRef.current;
    const token = currentToken();
    if (!socket || !socket.connected || !token || resumeAttemptRef.current === socket.id) return;
    resumeAttemptRef.current = socket.id || '__pending__';
    setResuming(true);
    const ack = await emitPlaygroundAck(socket, 'parquinho_resume', { tenantId, token });
    setResuming(false);
    if (!ack.ok) {
      setAuthError(ack.message || 'Não foi possível retomar a sessão.');
      if ((ack.message || '').toLowerCase().includes('token') || (ack.message || '').toLowerCase().includes('sessão')) {
        clearPlaygroundToken(tenantId);
        setScreen('auth');
      }
      return;
    }
    setAuthError('');
    if (ack.operator) setOperator(ack.operator);
    if (ack.data) setData(ack.data);
    if (ack.operator?.status === 'approved') {
      setScreen('terminal');
      if (!ack.data) void requestData();
    } else if (ack.operator) {
      setScreen('pending');
    }
  }, [currentToken, requestData, tenantId]);

  useEffect(() => {
    if (!tenantId) {
      setAuthError('Estabelecimento não informado no QR Code.');
      setScreen('auth');
      return;
    }
    const socket = createPlaygroundSocket(tenantId);
    socketRef.current = socket;
    const savedForm = readPendingPlaygroundForm(tenantId);
    if (savedForm) {
      pendingRef.current = savedForm;
      setPending(savedForm);
      setSelectedTableId(savedForm.tableId);
      setChildNames([savedForm.childName]);
      setShowTablePopup(true);
    }

    const onConnect = () => {
      setSocketConnected(true);
      resumeAttemptRef.current = null;
      if (currentToken()) void resumeSession();
      else setScreen('auth');
    };
    const onDisconnect = () => setSocketConnected(false);
    const onData = (snapshot: PlaygroundData) => {
      if (!snapshot || snapshot.tenantId !== tenantId) return;
      setData(snapshot);
      if (snapshot.ready && operator?.status === 'approved') setScreen('terminal');
    };
    const onOperatorStatus = (payload: { operatorId?: string; status?: PlaygroundOperator['status']; message?: string }) => {
      if (!payload?.status) return;
      setOperator(previous => previous && (!payload.operatorId || previous.id === payload.operatorId)
        ? { ...previous, status: payload.status! }
        : previous);
      if (payload.status === 'approved') {
        setAuthError('');
        if (currentToken()) {
          setScreen('terminal');
          void requestData();
        } else {
          setScreen('auth');
          setAuthError('Aprovado! Faça login para continuar.');
        }
      } else if (payload.status === 'inactive') {
        setAuthError(payload.message || 'Este cadastro está inativo.');
        setScreen('auth');
      } else {
        setScreen('pending');
      }
    };
    const onError = (message: string | { message?: string }) => {
      setSubmitError(typeof message === 'string' ? message : message?.message || 'Erro de comunicação.');
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('parquinho_data', onData);
    socket.on('parquinho_operator_status', onOperatorStatus);
    socket.on('error_message', onError);
    if (socket.connected) onConnect();
    else setSocketConnected(false);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('parquinho_data', onData);
      socket.off('parquinho_operator_status', onOperatorStatus);
      socket.off('error_message', onError);
      socket.disconnect();
      socketRef.current = null;
    };
    // The dedicated socket is scoped to the tenant and is never shared with FirebaseProvider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!operator) {
      setScreen('auth');
    } else if (operator.status === 'approved') {
      if (currentToken()) {
        setScreen('terminal');
      } else {
        setScreen('auth');
      }
    } else if (operator.status === 'pending') {
      setScreen('pending');
    }
  }, [operator, currentToken]);

  const handleAuthSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = authForm.name.trim();
    if (!name || !authForm.password) {
      setAuthError('Informe nome e senha.');
      return;
    }
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      setAuthError('Aguarde a conexão com o estabelecimento.');
      return;
    }
    setAuthError('');
    const payload = authMode === 'register'
      ? {
          tenantId,
          name,
          password: authForm.password,
          ...(authForm.phone.trim() ? { phone: authForm.phone.trim() } : {}),
          ...(authForm.cpf.trim() ? { cpf: authForm.cpf.trim() } : {}),
          ...(authForm.birthDate ? { birthDate: authForm.birthDate } : {}),
        }
      : { tenantId, name, password: authForm.password };
    const ack = await emitPlaygroundAck(socket, authMode === 'register' ? 'parquinho_register' : 'parquinho_login', payload);
    if (!ack.ok) {
      setAuthError(ack.message || 'Não foi possível concluir o acesso.');
      return;
    }
    setAuthForm(previous => ({ ...previous, password: '' }));
    if (ack.token) writePlaygroundToken(tenantId, ack.token);
    if (ack.operator) setOperator(ack.operator);
    if (ack.data) setData(ack.data);
    if (ack.operator?.status === 'approved') {
      setScreen('terminal');
      if (!ack.data) void requestData();
      toast.success('Acesso aprovado.');
    } else {
      setScreen('pending');
      toast.success(authMode === 'register' ? 'Cadastro enviado para aprovação.' : 'Acesso aguardando aprovação.');
    }
  };

  const logout = async () => {
    const socket = socketRef.current;
    if (socket?.connected) await emitPlaygroundAck(socket, 'parquinho_logout');
    clearPlaygroundToken(tenantId);
    setOperator(null);
    setData(null);
    setAuthError('');
    setSubmitError('');
    setScreen('auth');
    setAuthMode('login');
    setShowTablePopup(false);
  };

  const selectedTable = useMemo(
    () => data?.tables.find(table => table.id === selectedTableId) || null,
    [data?.tables, selectedTableId],
  );
  const selectedEntries = useMemo(
    () => data?.entries.filter(entry => entry.tableId === selectedTableId && entry.status === 'active') || [],
    [data?.entries, selectedTableId],
  );

  const anyNameError = childNames.some(name => !!getPlaygroundLaunchError(data, name));
  const hasPendingLaunch = !!pending?.submittedAt;
  const canSubmit = Boolean(
    data?.ready && socketConnected && operator?.status === 'approved' && data.config.parquinhoEnabled &&
    (typeof data.config.parquinhoPrice === 'number' && Number.isFinite(data.config.parquinhoPrice) && data.config.parquinhoPrice >= 0) &&
    data.isCashRegisterOpen && selectedTableId !== null && !anyNameError && !hasPendingLaunch,
  );

  const submitLaunch = async () => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !operator || operator.status !== 'approved') {
      setSubmitError('O operador ainda não está aprovado ou a conexão caiu.');
      return;
    }
    if (selectedTableId === null) {
      setSubmitError('Selecione uma mesa.');
      return;
    }
    const names = childNames.map(trimChildName);
    for (const name of names) {
      const err = getPlaygroundLaunchError(data, name);
      if (err) { setSubmitError(err); return; }
    }
    setSubmitError('');

    if (names.length === 1) {
      // Single child: use pending form for idempotency/recovery
      const existing = pendingRef.current;
      const next: PlaygroundPendingForm = {
        requestId: existing?.requestId || createRequestId(),
        tenantId,
        tableId: selectedTableId,
        childName: names[0],
        ...(buildId ? { buildId } : {}),
        submittedAt: existing?.submittedAt || new Date().toISOString(),
      };
      pendingRef.current = next;
      setPending(next);
      writePendingPlaygroundForm(next);

      const ack = await emitPlaygroundAck(socket, 'parquinho_add_entry', makePlaygroundLaunch(next.tableId, next.childName, next.requestId, next.buildId));
      if (!ack.ok) {
        setSubmitError(ack.message || 'O lançamento não foi confirmado. O formulário foi preservado para tentar novamente.');
        return;
      }
      if (ack.data) setData(ack.data);
      clearPendingPlaygroundForm(tenantId);
      pendingRef.current = null;
      setPending(null);
      setChildNames(['']);
      setShowTablePopup(false);
      toast.success('Parquinho lançado com sucesso.');
      if (!ack.data) void requestData();
    } else {
      // Multiple children: submit sequentially with individual requestIds
      let lastAckHadData = false;
      for (let i = 0; i < names.length; i++) {
        const ack = await emitPlaygroundAck(socket, 'parquinho_add_entry', makePlaygroundLaunch(selectedTableId, names[i], createRequestId(), buildId));
        if (!ack.ok) {
          setSubmitError(`Criança ${i + 1}${names[i] ? ` (${names[i]})` : ''}: ${ack.message || 'Lançamento não confirmado.'}`);
          return;
        }
        if (ack.data) { setData(ack.data); lastAckHadData = true; }
      }
      setChildNames(['']);
      setShowTablePopup(false);
      toast.success(`${names.length} lançamentos realizados com sucesso.`);
      if (!lastAckHadData) void requestData();
    }
  };

  if (screen === 'loading' || resuming) {
    return <div className="min-h-screen flex items-center justify-center bg-[#E4E3E0] p-6"><div className="text-center"><div className="w-12 h-12 bg-[#141414] rounded-full mx-auto mb-4 flex items-center justify-center"><RefreshCcw className="text-white animate-spin" size={22} /></div><p className="font-serif italic text-xl">Conectando ao Parquinho…</p><p className="text-xs opacity-50 mt-2"><ConnectionBadge connected={socketConnected} /></p></div></div>;
  }

  if (screen === 'auth') {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border-2 border-[#141414] rounded-3xl p-7 shadow-xl">
          <div className="flex items-center justify-between mb-7"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-violet-700 rounded-full flex items-center justify-center"><CircleUserRound className="text-white" size={21} /></div><div><h1 className="font-serif italic text-2xl leading-none">Terminal do Parquinho</h1><p className="text-[8px] uppercase tracking-widest opacity-45 mt-1">{authMode === 'register' ? 'Novo cadastro · operador' : 'Login · operador de parquinho'}</p></div></div><ConnectionBadge connected={socketConnected} /></div>
          <div className="flex gap-1 bg-[#141414]/5 rounded-xl p-1 mb-5"><button type="button" onClick={() => { setAuthMode('login'); setAuthError(''); }} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase ${authMode === 'login' ? 'bg-[#141414] text-white' : 'opacity-50'}`}>Entrar</button><button type="button" onClick={() => { setAuthMode('register'); setAuthError(''); }} className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase ${authMode === 'register' ? 'bg-[#141414] text-white' : 'opacity-50'}`}>Novo cadastro</button></div>
          {authError && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 mb-4 text-[10px]"><AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{authError}</span></div>}
          <form onSubmit={handleAuthSubmit} className="space-y-3">
            <label className="block"><span className="text-[9px] uppercase font-black tracking-wider opacity-50">Nome</span><input required value={authForm.name} onChange={event => setAuthForm(previous => ({ ...previous, name: event.target.value }))} className="w-full mt-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#141414]" placeholder="Nome completo" /></label>
            {authMode === 'register' && <>
              <label className="block"><span className="text-[9px] uppercase font-black tracking-wider opacity-50">Telefone (opcional)</span><input value={authForm.phone} onChange={event => setAuthForm(previous => ({ ...previous, phone: event.target.value }))} className="w-full mt-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#141414]" placeholder="(00) 00000-0000" /></label>
              <div className="grid grid-cols-2 gap-2"><label className="block"><span className="text-[9px] uppercase font-black tracking-wider opacity-50">CPF (opcional)</span><input value={authForm.cpf} onChange={event => setAuthForm(previous => ({ ...previous, cpf: event.target.value }))} className="w-full mt-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#141414]" /></label><label className="block"><span className="text-[9px] uppercase font-black tracking-wider opacity-50">Nascimento (opcional)</span><input type="date" value={authForm.birthDate} onChange={event => setAuthForm(previous => ({ ...previous, birthDate: event.target.value }))} className="w-full mt-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-2 py-3 text-[11px] outline-none focus:border-[#141414]" /></label></div>
            </>}
            <label className="block"><span className="text-[9px] uppercase font-black tracking-wider opacity-50">Senha</span><input required type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={authForm.password} onChange={event => setAuthForm(previous => ({ ...previous, password: event.target.value }))} className="w-full mt-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#141414]" /></label>
            <button type="submit" disabled={!socketConnected} className="w-full bg-[#141414] text-white rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-40"><LogIn size={16} />{authMode === 'login' ? 'Entrar no terminal' : 'Solicitar aprovação'}</button>
          </form>
          <p className="text-[9px] opacity-40 text-center mt-5">O QR Code identifica apenas este estabelecimento. Acesso depende de credencial e aprovação do gerente.</p>
        </div>
      </div>
    );
  }

  if (screen === 'pending') {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex items-center justify-center p-6"><div className="w-full max-w-md text-center bg-white border-2 border-[#141414] rounded-3xl p-8 shadow-xl"><div className="w-20 h-20 mx-auto rounded-full bg-[#141414] flex items-center justify-center mb-5"><Clock3 className="text-[#E4E3E0]" size={36} /></div><h1 className="font-serif italic text-3xl">Aguardando aprovação</h1><p className="text-sm opacity-60 mt-3">{operator ? authMessage(safeStatus(operator) || 'pending') : 'Seu cadastro está sendo consultado.'}</p><div className="flex justify-center mt-6"><ConnectionBadge connected={socketConnected} /></div><div className="flex gap-2 mt-7"><button type="button" onClick={() => void requestData()} className="flex-1 border border-[#141414]/15 rounded-xl py-3 text-[10px] font-bold uppercase flex items-center justify-center gap-2"><RefreshCcw size={13} /> Atualizar</button><button type="button" onClick={() => void logout()} className="flex-1 bg-[#141414] text-white rounded-xl py-3 text-[10px] font-bold uppercase flex items-center justify-center gap-2"><LogOut size={13} /> Sair</button></div></div></div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 text-[#141414]">
      <header className="bg-[#141414] text-[#E4E3E0] px-4 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ShieldCheck size={26} />
          <div>
            <h1 className="font-serif italic text-2xl leading-none">Terminal Parquinho</h1>
            <p className="text-[11px] uppercase tracking-widest opacity-45 mt-1">{operator?.name || 'Operador'}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ConnectionBadge connected={socketConnected} />
          <button type="button" onClick={() => void logout()} title="Sair" className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10">
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {!data?.ready && <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[10px] text-amber-800 font-bold flex items-center gap-2"><RefreshCcw size={12} className="animate-spin" /> Sincronizando snapshot autorizado do Parquinho…</div>}
      {data && !data.config.parquinhoEnabled && <div className="bg-gray-100 border-b border-gray-300 px-4 py-2 text-[10px] text-gray-600 font-bold flex items-center gap-2"><AlertCircle size={12} /> Modo Parquinho desativado. Histórico permanece disponível, mas novos lançamentos estão bloqueados.</div>}
      {data && data.config.parquinhoEnabled && (data.config.parquinhoPrice === null || data.config.parquinhoPrice === undefined) && <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-[10px] text-red-700 font-bold flex items-center gap-2"><AlertCircle size={12} /> O preço ainda não foi configurado pelo ADM. Lançamentos bloqueados.</div>}
      {!socketConnected && <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-[10px] text-red-700 font-bold flex items-center gap-2"><WifiOff size={12} /> Sem conexão. O formulário será preservado; nenhum lançamento será enviado automaticamente.</div>}

      <main className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif italic text-2xl">Mesas</h2>
            <p className="text-xs opacity-50">Toque em uma mesa para lançar Parquinho</p>
          </div>
          {data?.config && (
            <span className="text-sm font-bold bg-white border border-[#141414]/10 rounded-lg px-3 py-2 shrink-0">
              {formatPlaygroundMoney(data.config.parquinhoPrice)} / criança
            </span>
          )}
        </div>

        <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 gap-2">
          {(data?.tables || []).slice().sort((a, b) => a.id - b.id).map(table => {
            const selected = selectedTableId === table.id;
            const occupied = Boolean(table.occupied);
            return (
              <button
                key={table.id}
                type="button"
                onClick={() => {
                  if (hasPendingLaunch) return;
                  setSelectedTableId(table.id);
                  setChildNames(['']);
                  setSubmitError('');
                  setShowTablePopup(true);
                }}
                className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center relative transition-all
                  ${selected ? 'border-[#141414] bg-[#141414] text-white shadow-md' : occupied ? 'border-green-500 bg-green-500 text-white' : 'border-[#141414]/10 bg-white hover:border-[#141414]/40'}`}
              >
                <span className="text-base font-black leading-none">{table.id}</span>
                <span className="text-[8px] uppercase font-bold opacity-70 mt-0.5">{occupied ? 'ativo' : 'livre'}</span>
                {table.activeEntryIds.length > 0 && (
                  <span className="absolute -top-1 -right-1 bg-white text-green-700 rounded-full min-w-4 h-4 px-0.5 text-[9px] font-black flex items-center justify-center border border-green-300 shadow-sm">
                    {table.activeEntryIds.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {data && data.tables.length === 0 && (
          <div className="bg-white border border-dashed border-[#141414]/15 rounded-2xl py-12 text-center text-sm opacity-50">
            Nenhuma mesa disponível neste snapshot.
          </div>
        )}
      </main>

      {/* Table launch popup */}
      {showTablePopup && selectedTable && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center sm:p-4"
          onClick={() => !hasPendingLaunch && setShowTablePopup(false)}
        >
          <div
            className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md shadow-2xl max-h-[90dvh] overflow-hidden flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex-1 overflow-y-auto min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[#141414]/8">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-[#141414] rounded-xl flex items-center justify-center shrink-0">
                  <span className="text-white font-black text-xl">{selectedTable.id}</span>
                </div>
                <div>
                  <h3 className="font-serif italic text-2xl leading-none">Mesa {selectedTable.id}</h3>
                  <span className={`text-xs uppercase font-black ${selectedTable.occupied ? 'text-green-600' : 'text-gray-400'}`}>
                    {selectedTable.occupied ? 'Ocupada · parquinho ativo' : 'Livre'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => !hasPendingLaunch && setShowTablePopup(false)}
                className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Active entries */}
            {selectedEntries.length > 0 && (
              <div className="px-4 pt-3 pb-2 border-b border-[#141414]/5">
                <p className="text-[11px] uppercase tracking-wider font-black text-green-700 mb-3">
                  {selectedEntries.length} criança{selectedEntries.length !== 1 ? 's' : ''} no parquinho agora
                </p>
                <div className="space-y-1.5">
                  {selectedEntries.map(entry => (
                    <div key={entry.id} className="flex items-center gap-2 text-sm text-green-900 bg-green-50 rounded-lg px-3 py-2.5">
                      <CheckCircle size={14} className="shrink-0" />
                      <span className="font-bold flex-1 truncate">{entry.childName || '—'}</span>
                      <span className="font-bold opacity-60 shrink-0">{entry.operatorName || '—'}</span>
                      <span className="font-mono font-black shrink-0">{formatPlaygroundMoney(entry.totalPrice)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Launch form */}
            <div className="p-5 space-y-4">
              <p className="text-[10px] uppercase font-black tracking-wider opacity-50">
                Crianças a lançar {data?.config.parquinhoChildNameRequired ? '· nome obrigatório' : '· nome opcional'}
              </p>

              <div className="space-y-2">
                {childNames.map((name, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="w-7 h-7 bg-[#141414]/8 rounded-full flex items-center justify-center shrink-0 text-xs font-black text-[#141414]/60">
                      {index + 1}
                    </span>
                    <input
                      disabled={hasPendingLaunch || !data?.config.parquinhoEnabled}
                      value={name}
                      onChange={e => {
                        const val = e.target.value;
                        setChildNames(prev => prev.map((n, i) => i === index ? val : n));
                        setSubmitError('');
                      }}
                      className="flex-1 bg-gray-50 border border-[#141414]/10 rounded-xl px-4 py-3.5 text-base outline-none focus:border-[#141414] disabled:bg-gray-100 disabled:opacity-60"
                      placeholder={data?.config.parquinhoChildNameRequired ? 'Nome obrigatório' : 'Nome (opcional)'}
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus={index === childNames.length - 1 && index > 0}
                    />
                    {childNames.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setChildNames(prev => prev.filter((_, i) => i !== index))}
                        disabled={hasPendingLaunch}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-colors disabled:opacity-30"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setChildNames(prev => [...prev, ''])}
                disabled={hasPendingLaunch || !data?.config.parquinhoEnabled}
                className="w-full border border-dashed border-[#141414]/20 rounded-xl py-3.5 text-sm font-bold text-[#141414]/50 hover:border-[#141414]/40 hover:text-[#141414]/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                <Plus size={15} /> Adicionar outra criança
              </button>

              {/* Price summary */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 text-sm">
                <span className="font-bold opacity-50">{childNames.length} {childNames.length === 1 ? 'criança' : 'crianças'}</span>
                <span className="font-mono font-black">
                  {childNames.length} × {formatPlaygroundMoney(data?.config.parquinhoPrice)} = {typeof data?.config.parquinhoPrice === 'number' ? formatPlaygroundMoney(data.config.parquinhoPrice * childNames.length) : '—'}
                </span>
              </div>

              {submitError && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-[10px]">
                  <AlertCircle size={13} className="shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {hasPendingLaunch && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-[10px]">
                    <Clock3 size={13} className="shrink-0" />
                    <span>Solicitação pendente. O formulário está preservado; não altere os dados até receber a confirmação para evitar duplicidade.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void submitLaunch()}
                    disabled={!socketConnected || !operator || operator.status !== 'approved'}
                    className="w-full border border-amber-300 text-amber-800 rounded-xl py-3 text-[10px] font-black uppercase flex items-center justify-center gap-2 disabled:opacity-40"
                  >
                    <Send size={13} /> Tentar novamente com o mesmo ID
                  </button>
                  <p className="text-[8px] opacity-40 font-mono break-all">requestId: {pending?.requestId}</p>
                </div>
              )}

              <p className="text-[10px] opacity-40 leading-relaxed">
                O servidor confirma preço, produto, caixa, aprovação e quantidade. Este terminal não exibe alimentos, bebidas, pagamentos ou cancelamentos.
              </p>
            </div>
            </div>
            {!hasPendingLaunch && (
              <div className="shrink-0 px-5 pb-5 pt-3 border-t border-[#141414]/5">
                <button
                  type="button"
                  onClick={() => void submitLaunch()}
                  disabled={!canSubmit}
                  className="w-full bg-[#141414] text-white rounded-xl py-4 text-sm font-black uppercase flex items-center justify-center gap-2 disabled:opacity-35 disabled:cursor-not-allowed"
                >
                  <Send size={17} />
                  {childNames.length > 1 ? `Lançar ${childNames.length} crianças` : 'Lançar Parquinho'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
