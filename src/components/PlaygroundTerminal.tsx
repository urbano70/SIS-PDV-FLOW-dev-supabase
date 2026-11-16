import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, CircleUserRound, Clock3, LogIn, LogOut, RefreshCcw, Send, ShieldCheck, Wifi, WifiOff } from 'lucide-react';
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
  const [childName, setChildName] = useState('');
  const [pending, setPending] = useState<PlaygroundPendingForm | null>(null);
  const [resuming, setResuming] = useState(false);

  const currentToken = useCallback(() => readPlaygroundToken(tenantId), [tenantId]);

  const applyAck = useCallback((ack: Awaited<ReturnType<typeof emitPlaygroundAck>>) => {
    if (!ack.ok) {
      setAuthError(ack.message || 'Não foi possível autenticar no Parquinho.');
      return false;
    }
    if (ack.token) writePlaygroundToken(tenantId, ack.token);
    if (ack.operator) setOperator(ack.operator);
    if (ack.data) setData(ack.data);
    if (ack.operator?.status === 'approved') setScreen('terminal');
    else if (ack.operator) setScreen('pending');
    return true;
  }, [tenantId]);

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
      // A timeout is not proof that the opaque token is invalid. Preserve it so a
      // reconnect can try again, while auth errors return to the explicit login screen.
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
      setChildName(savedForm.childName);
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
        // Only go to terminal if operator already has a valid session token
        if (currentToken()) {
          setScreen('terminal');
          void requestData();
        } else {
          // No session yet — operator must log in to get a token
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
      // Only proceed to terminal if there is a valid session token
      if (currentToken()) {
        setScreen('terminal');
      } else {
        setScreen('auth');
      }
    } else if (operator.status === 'pending') {
      setScreen('pending');
    }
  }, [operator, currentToken]);

  const updateDraft = useCallback((patch: Partial<PlaygroundPendingForm>) => {
    const previous = pendingRef.current;
    if (previous?.submittedAt) return;
    const next: PlaygroundPendingForm = {
      requestId: previous?.requestId || createRequestId(),
      tenantId,
      tableId: patch.tableId ?? previous?.tableId ?? selectedTableId ?? 0,
      childName: trimChildName(patch.childName ?? previous?.childName ?? childName),
      ...(buildId ? { buildId } : {}),
    };
    if (!next.tableId) return;
    pendingRef.current = next;
    setPending(next);
    writePendingPlaygroundForm(next);
  }, [buildId, childName, selectedTableId, tenantId]);

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
  };

  const selectedTable = useMemo(
    () => data?.tables.find(table => table.id === selectedTableId) || null,
    [data?.tables, selectedTableId],
  );
  const selectedEntries = useMemo(
    () => data?.entries.filter(entry => entry.tableId === selectedTableId && entry.status === 'active') || [],
    [data?.entries, selectedTableId],
  );
  const launchError = getPlaygroundLaunchError(data, childName);
  const hasPendingLaunch = !!pending?.submittedAt;
  const canSubmit = Boolean(
    data?.ready && socketConnected && operator?.status === 'approved' && data.config.parquinhoEnabled &&
    (typeof data.config.parquinhoPrice === 'number' && Number.isFinite(data.config.parquinhoPrice) && data.config.parquinhoPrice >= 0) &&
    data.isCashRegisterOpen && selectedTableId !== null && !launchError && !hasPendingLaunch,
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
    const validationError = getPlaygroundLaunchError(data, childName);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    const existing = pendingRef.current;
    const next: PlaygroundPendingForm = {
      requestId: existing?.requestId || createRequestId(),
      tenantId,
      tableId: selectedTableId,
      childName: trimChildName(childName),
      ...(buildId ? { buildId } : {}),
      submittedAt: existing?.submittedAt || new Date().toISOString(),
    };
    pendingRef.current = next;
    setPending(next);
    writePendingPlaygroundForm(next);
    setSubmitError('');

    const ack = await emitPlaygroundAck(socket, 'parquinho_add_entry', makePlaygroundLaunch(next.tableId, next.childName, next.requestId, next.buildId));
    if (!ack.ok) {
      setSubmitError(ack.message || 'O lançamento não foi confirmado. O formulário foi preservado para tentar novamente.');
      return;
    }
    if (ack.data) setData(ack.data);
    clearPendingPlaygroundForm(tenantId);
    pendingRef.current = null;
    setPending(null);
    setChildName('');
    setSubmitError('');
    toast.success('Parquinho lançado com sucesso.');
    // Keep the selected table and refresh the authoritative snapshot if the ack only carried the entry.
    if (!ack.data) void requestData();
  };

  if (screen === 'loading' || resuming) {
    return <div className="min-h-screen flex items-center justify-center bg-[#E4E3E0] p-6"><div className="text-center"><div className="w-12 h-12 bg-[#141414] rounded-full mx-auto mb-4 flex items-center justify-center"><RefreshCcw className="text-white animate-spin" size={22} /></div><p className="font-serif italic text-xl">Conectando ao Parquinho…</p><p className="text-xs opacity-50 mt-2"><ConnectionBadge connected={socketConnected} /></p></div></div>;
  }

  if (screen === 'auth') {
    return (
      <div className="min-h-screen bg-[#E4E3E0] text-[#141414] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border-2 border-[#141414] rounded-3xl p-7 shadow-xl">
          <div className="flex items-center justify-between mb-7"><div className="flex items-center gap-3"><div className="w-10 h-10 bg-[#141414] rounded-full flex items-center justify-center"><CircleUserRound className="text-white" size={21} /></div><div><h1 className="font-serif italic text-2xl leading-none">Operador de Parquinho</h1><p className="text-[8px] uppercase tracking-widest opacity-45 mt-1">Acesso restrito · estabelecimento</p></div></div><ConnectionBadge connected={socketConnected} /></div>
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
      <header className="bg-[#141414] text-[#E4E3E0] px-4 py-3 flex items-center justify-between shrink-0"><div className="flex items-center gap-3"><ShieldCheck size={20} /><div><h1 className="font-serif italic text-xl leading-none">Terminal Parquinho</h1><p className="text-[8px] uppercase tracking-widest opacity-45 mt-1">{operator?.name || 'Operador'}</p></div></div><div className="flex items-center gap-3"><ConnectionBadge connected={socketConnected} /><button type="button" onClick={() => void logout()} title="Sair" className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10"><LogOut size={15} /></button></div></header>
      {!data?.ready && <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-[10px] text-amber-800 font-bold flex items-center gap-2"><RefreshCcw size={12} className="animate-spin" /> Sincronizando snapshot autorizado do Parquinho…</div>}
      {data && !data.config.parquinhoEnabled && <div className="bg-gray-100 border-b border-gray-300 px-4 py-2 text-[10px] text-gray-600 font-bold flex items-center gap-2"><AlertCircle size={12} /> Modo Parquinho desativado. Histórico permanece disponível, mas novos lançamentos estão bloqueados.</div>}
      {data && data.config.parquinhoEnabled && (data.config.parquinhoPrice === null || data.config.parquinhoPrice === undefined) && <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-[10px] text-red-700 font-bold flex items-center gap-2"><AlertCircle size={12} /> O preço ainda não foi configurado pelo ADM. Lançamentos bloqueados.</div>}
      {!socketConnected && <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-[10px] text-red-700 font-bold flex items-center gap-2"><WifiOff size={12} /> Sem conexão. O formulário será preservado; nenhum lançamento será enviado automaticamente.</div>}
      <main className="flex-1 min-h-0 overflow-y-auto p-4 lg:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-serif italic text-2xl">Mesas</h2><p className="text-[10px] opacity-50">Você vê somente mesas e lançamentos de Parquinho deste estabelecimento.</p></div>{data?.config && <span className="text-[10px] font-bold bg-white border border-[#141414]/10 rounded-xl px-3 py-2">{formatPlaygroundMoney(data.config.parquinhoPrice)} / criança</span>}</div>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
          {(data?.tables || []).slice().sort((a, b) => a.id - b.id).map(table => {
            const selected = selectedTableId === table.id;
            const occupied = Boolean(table.occupied);
            return <button key={table.id} type="button" onClick={() => { if (hasPendingLaunch) return; setSelectedTableId(table.id); updateDraft({ tableId: table.id, childName }); setSubmitError(''); }} className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center relative transition-all ${selected ? 'border-[#141414] bg-[#141414] text-white shadow-lg scale-[1.02]' : occupied ? 'border-green-500 bg-green-500 text-white' : 'border-[#141414]/10 bg-white hover:border-[#141414]/40'}`}><span className="text-2xl font-black">{table.id}</span><span className="text-[8px] uppercase tracking-widest font-bold mt-1">{occupied ? 'ocupada' : 'livre'}</span>{table.activeEntryIds.length > 0 && <span className="absolute top-1 right-1 bg-white text-green-700 rounded-full min-w-4 h-4 px-1 text-[8px] font-black flex items-center justify-center">{table.activeEntryIds.length}</span>}</button>;
          })}
        </div>
        {data && data.tables.length === 0 && <div className="bg-white border border-dashed border-[#141414]/15 rounded-2xl py-12 text-center text-sm opacity-50">Nenhuma mesa disponível neste snapshot.</div>}
        {selectedTable && (
          <section className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-4 lg:p-5 max-w-3xl">
            <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-serif italic text-xl">Mesa {selectedTable.id}</h3><p className="text-[9px] opacity-45">Pedido atual: {selectedTable.currentOrderId || 'ainda não criado'}</p></div><span className={`text-[9px] uppercase font-black px-2 py-1 rounded-full ${selectedTable.occupied ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{selectedTable.occupied ? 'Parquinho ativo' : 'Livre no Parquinho'}</span></div>
            {selectedEntries.length > 0 && <div className="mb-4 rounded-xl bg-green-50 border border-green-200 p-3"><p className="text-[8px] uppercase tracking-wider font-black text-green-800 mb-2">Lançamentos ativos desta mesa</p><div className="space-y-1.5">{selectedEntries.map(entry => <div key={entry.id} className="flex items-center gap-2 text-[10px] text-green-900"><CheckCircle size={12} /><span className="font-bold flex-1">{entry.childName || 'Não informado'}</span><span>{entry.operatorName || 'Não informado'}</span><span className="font-mono">{formatPlaygroundMoney(entry.totalPrice)}</span></div>)}</div></div>}
            <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-3 space-y-3"><label className="block"><span className="text-[8px] uppercase tracking-wider font-black opacity-50">Nome da criança {data?.config.parquinhoChildNameRequired ? '(obrigatório)' : '(opcional)'}</span><input disabled={hasPendingLaunch || !data?.config.parquinhoEnabled} value={childName} onChange={event => { const value = event.target.value; setChildName(value); updateDraft({ tableId: selectedTable.id, childName: value }); setSubmitError(''); }} className="w-full mt-1 bg-white border border-[#141414]/10 rounded-xl px-3 py-3 text-sm outline-none focus:border-[#141414] disabled:bg-gray-100 disabled:opacity-60" placeholder={data?.config.parquinhoChildNameRequired ? 'Informe o nome para continuar' : 'Pode deixar sem nome'} /></label><div className="flex items-center justify-between text-[10px] border-t border-[#141414]/8 pt-3"><span className="font-bold opacity-50">Este lançamento</span><span className="font-mono font-black">1 × {formatPlaygroundMoney(data?.config.parquinhoPrice)}</span></div>{submitError && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-[10px]"><AlertCircle size={13} className="shrink-0 mt-0.5" /><span>{submitError}</span></div>}{hasPendingLaunch ? <div className="space-y-2"><div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-[10px]"><Clock3 size={13} className="shrink-0" /><span>Solicitação pendente. O formulário está preservado; não altere a mesa/nome até receber a confirmação para evitar duplicidade.</span></div><button type="button" onClick={() => void submitLaunch()} disabled={!socketConnected || !operator || operator.status !== 'approved'} className="w-full border border-amber-300 text-amber-800 rounded-xl py-3 text-[10px] font-black uppercase flex items-center justify-center gap-2 disabled:opacity-40"><Send size={13} /> Tentar novamente com o mesmo ID</button><p className="text-[8px] opacity-40 font-mono break-all">requestId: {pending?.requestId}</p></div> : <button type="button" onClick={() => void submitLaunch()} disabled={!canSubmit} className="w-full bg-[#141414] text-white rounded-xl py-3.5 text-[10px] font-black uppercase flex items-center justify-center gap-2 disabled:opacity-35 disabled:cursor-not-allowed"><Send size={14} /> Lançar Parquinho</button>}<p className="text-[8px] opacity-40 leading-relaxed">O servidor confirma preço, produto, caixa, aprovação e quantidade 1. Este terminal não exibe alimentos, bebidas, pagamentos ou cancelamentos.</p></div>
          </section>
        )}
      </main>
    </div>
  );
}
