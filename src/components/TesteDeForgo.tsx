import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Flame, StopCircle, CheckCircle, AlertTriangle, Trash2 } from 'lucide-react';
import socket from '../lib/socket';

// ── Tipos ─────────────────────────────────────────────────────────────────────
interface LogLine { ts: number; waiter: string; msg: string; kind: 'ok' | 'warn' | 'info' }
interface Report {
  elapsed: string;
  registered: number;
  approved: number;
  inactivated: number;
  attempted: number;
  ok: number;
  failed: number;
  taxa: string;
  avg: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
  errors: { msg: string; count: number }[];
  verdict: 'excellent' | 'good' | 'warn' | 'critical';
  verdictMsg: string;
}

const TOTAL            = 25;
const TABLES           = 40;
const MIN_MS           = 500;
const MAX_MS           = 3000;
const CONFIRM_TIMEOUT  = 5000;
const APPROVE_TIMEOUT  = 60000; // 60s máx para aprovação manual
const FOGO_PREFIX      = 'Garcom_Fogo_';

const rand  = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick  = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function pickItem(menu: any[]): any | null {
  const keywords = ['lanche', 'bebida'];
  let candidates: any[] = [];
  for (const cat of (menu || [])) {
    if (cat.visible === false) continue;
    const isTarget = keywords.some(k => (cat.type || cat.name || '').toLowerCase().includes(k));
    if (isTarget) {
      (cat.items || []).filter((i: any) => i.visible !== false && i.price > 0)
        .forEach((i: any) => candidates.push({ ...i, _type: cat.type || cat.name }));
      for (const sub of (cat.subcategories || [])) {
        if (sub.visible === false) continue;
        (sub.items || []).filter((i: any) => i.visible !== false && i.price > 0)
          .forEach((i: any) => candidates.push({ ...i, _type: cat.type || cat.name }));
      }
    }
  }
  if (!candidates.length) {
    for (const cat of (menu || [])) {
      if ((cat.type || '').toLowerCase() === 'pizzas') continue;
      (cat.items || []).filter((i: any) => i.visible !== false && i.price > 0)
        .forEach((i: any) => candidates.push({ ...i, _type: cat.type || cat.name }));
    }
  }
  return candidates.length ? pick(candidates) : null;
}

// ── Estado de módulo — sobrevive desmontagem do componente ────────────────────
const _sockets:   Socket[]   = [];
const _waiterIds: string[]   = [];
let   _stopFlag     = false;
let   _finalized    = false;
let   _running      = false;
let   _stopping     = false;
let   _report:      Report | null = null;
let   _showCleanup  = false;
let   _log:       LogLine[] = [];
const _metrics = {
  registered: 0, approved: 0, inactivated: 0,
  attempted: 0, ok: 0, failed: 0,
  latencies: [] as number[],
  errors: [] as string[],
  start: 0,
  activeCount: 0,
};

let _notifyRender: (() => void) | null = null;

function notifyAll() { _notifyRender?.(); }

function addLog(waiter: string, msg: string, kind: LogLine['kind'] = 'info') {
  _log = [{ ts: Date.now(), waiter, msg, kind }, ..._log].slice(0, 150);
  notifyAll();
}

function buildReport(): Report {
  const m = _metrics;
  const elapsed = ((Date.now() - m.start) / 1000).toFixed(1);
  const lat = [...m.latencies].sort((a, b) => a - b);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const min = lat.length ? lat[0] : null;
  const max = lat.length ? lat[lat.length - 1] : null;
  const p95 = lat.length ? lat[Math.floor(lat.length * 0.95)] : null;
  const taxa = m.attempted ? ((m.ok / m.attempted) * 100).toFixed(1) : '0.0';
  const grouped: Record<string, number> = {};
  m.errors.forEach(e => { grouped[e] = (grouped[e] || 0) + 1; });
  const errors = Object.entries(grouped).map(([msg, count]) => ({ msg, count }));

  let verdict: Report['verdict'] = 'good';
  let verdictMsg = 'Desempenho satisfatório para 25 usuários simultâneos.';
  if (p95 !== null && p95 > 3000)      { verdict = 'critical'; verdictMsg = 'GARGALO CRÍTICO: p95 > 3s — contenção no servidor ou banco.'; }
  else if (p95 !== null && p95 > 1500) { verdict = 'warn';     verdictMsg = 'GARGALO MODERADO: p95 entre 1,5s–3s — monitorar sob carga real.'; }
  else if (max !== null && max > 5000) { verdict = 'warn';     verdictMsg = 'PICO ISOLADO: ao menos um lançamento levou > 5s.'; }
  else if (m.failed > 0)              { verdict = 'warn';     verdictMsg = 'Alguns lançamentos não tiveram confirmação no tempo esperado.'; }
  else if (avg !== null && avg < 400 && m.failed === 0) {
    verdict = 'excellent'; verdictMsg = 'EXCELENTE: média < 400ms, zero falhas. Sistema passou no Teste de Fogo! 🔥';
  }
  return { elapsed, ...m, taxa, avg, min, max, p95, errors, verdict, verdictMsg };
}

function finalize() {
  if (_finalized) return;
  _finalized = true;
  _sockets.forEach(s => { try { s.disconnect(); } catch {} });
  _sockets.length = 0;
  _report     = buildReport();
  _running    = false;
  _stopping   = false;
  _showCleanup = true;
  addLog('SISTEMA', 'Teste encerrado — relatório gerado.', 'info');
}

async function stopTest() {
  _stopping = true;
  _stopFlag = true;
  addLog('SISTEMA', `Encerrando — removendo ${_waiterIds.length} garçons…`, 'info');
  notifyAll();

  for (const id of _waiterIds) {
    socket.emit('remove_waiter', id);
    await sleep(40);
  }

  await sleep(3000);
  finalize();
}

async function startTest() {
  _stopFlag    = false;
  _finalized   = false;
  _log         = [];
  _waiterIds.length = 0;
  _sockets.length   = 0;
  _report      = null;
  _stopping    = false;
  _showCleanup = false;
  Object.assign(_metrics, {
    registered: 0, approved: 0, inactivated: 0,
    attempted: 0, ok: 0, failed: 0,
    latencies: [], errors: [], start: Date.now(), activeCount: TOTAL,
  });
  _running = true;
  notifyAll();

  addLog('SISTEMA', `Iniciando Teste de Fogo — ${TOTAL} garçons, mesas 1–${TABLES}`, 'info');

  // Bug 2 fix: aguarda caixa aberto antes de lançar garçons
  addLog('SISTEMA', 'Aguardando caixa aberto…', 'info');
  const cashOk = await waitForCashRegister();
  if (!cashOk) {
    addLog('SISTEMA', '⛔ Caixa não abriu em 30s — abortando.', 'warn');
    _running = false;
    notifyAll();
    return;
  }
  addLog('SISTEMA', '✅ Caixa aberto — registrando garçons.', 'info');

  for (let i = 0; i < TOTAL; i++) {
    if (_stopFlag) break;
    await sleep(100);
    spawnWaiter(i);
  }
}

// Aguarda update_cash_register = true via socket principal (até 30s)
function waitForCashRegister(): Promise<boolean> {
  return new Promise(resolve => {
    // Verifica estado atual via listener temporário
    const tid = setTimeout(() => {
      socket.off('update_cash_register', handler);
      resolve(false);
    }, 30000);

    const handler = (isOpen: boolean) => {
      if (isOpen) {
        clearTimeout(tid);
        socket.off('update_cash_register', handler);
        resolve(true);
      }
    };

    socket.on('update_cash_register', handler);

    // Solicita estado imediato via re-conexão de dados
    socket.emit('request_state');

    // Se já estava aberto antes do listener, resolve pelo init_data
    const initHandler = (data: any) => {
      if (data?.isCashRegisterOpen) {
        clearTimeout(tid);
        socket.off('update_cash_register', handler);
        socket.off('init_data', initHandler);
        resolve(true);
      }
    };
    socket.once('init_data', initHandler);
  });
}

function spawnWaiter(index: number) {
  const name  = `${FOGO_PREFIX}${String(index + 1).padStart(2, '0')}`;
  const cpf   = `000.000.${String(index).padStart(3, '0')}-99`;
  const phone = `11987${String(600000 + index).padStart(6, '0')}`;
  const m     = _metrics;

  const sock = io(window.location.origin, { transports: ['websocket', 'polling'] });
  _sockets.push(sock);

  let menuData:   any[] = [];
  let ordersData: any[] = [];
  let tablesData: any[] = [];
  let active  = false;
  let stopped = false;

  sock.on('connect', () => addLog(name, `Conectado`, 'info'));
  sock.on('connect_error', (err) => {
    m.errors.push(`connect_error: ${err.message}`);
    addLog(name, `⛔ ${err.message}`, 'warn');
  });
  sock.on('error_message', (msg: string) => {
    m.errors.push(`server: ${msg}`);
    addLog(name, `⚠️ ${msg}`, 'warn');
  });
  sock.on('update_menu',   (d: any) => { menuData   = d; });
  sock.on('update_orders', (d: any) => { ordersData = d; });
  sock.on('update_tables', (d: any) => { tablesData = d; });

  sock.on('init_data', (data: any) => {
    if (data.menu)   menuData   = data.menu;
    if (data.orders) ordersData = data.orders;
    if (data.tables) tablesData = data.tables;
    sock.emit('waiter_register', { name, cpf, phone, password: 'teste123' });
    m.registered++;
    addLog(name, `📋 Cadastro enviado — aguardando aprovação ADM`, 'info');

    // Bug 3 fix: timeout de aprovação — se não aprovado em 60s, desconta do activeCount
    setTimeout(() => {
      if (!active && !stopped) {
        stopped = true;
        m.errors.push(`Aprovação não recebida em ${APPROVE_TIMEOUT / 1000}s`);
        addLog(name, `⏱ Timeout de aprovação — garçom ignorado`, 'warn');
        m.activeCount--;
        if (m.activeCount <= 0) finalize();
      }
    }, APPROVE_TIMEOUT);
  });

  sock.on('waiter_approved', ({ status }: { status: string }) => {
    if (status === 'approved' && !active) {
      active = true;
      m.approved++;
      _waiterIds.push(cpf);
      addLog(name, `✅ Aprovado — iniciando lançamentos`, 'ok');
      runLoop();
    }
  });

  sock.on('waiter_status_changed', ({ status }: { status: string }) => {
    if ((status === 'inactive' || status === 'inactivated') && !stopped) {
      stopped = true;
      m.inactivated++;
      addLog(name, `🛑 Inativado`, 'info');
      sock.disconnect();
      m.activeCount--;
      if (m.activeCount <= 0) finalize();
    }
  });

  async function runLoop() {
    while (!stopped && !_stopFlag) {
      await sleep(rand(MIN_MS, MAX_MS));
      if (stopped || _stopFlag) break;

      const tableId  = rand(1, TABLES);
      const tableRow = tablesData.find((t: any) => t.id === tableId);
      const occupied = tableRow && tableRow.status !== 'free';
      const item     = pickItem(menuData);
      if (!item) { m.errors.push('Sem itens no cardápio'); await sleep(2000); continue; }

      const qty = rand(1, 3);
      const cartItem = {
        id: Math.random().toString(36).slice(2),
        menuItemId: item.id,
        name: item.name,
        type: item._type || 'lanches',
        flavors: [item.name],
        size: 'U',
        extras: [],
        observations: '',
        price: item.price * qty,
        quantity: qty,
      };

      m.attempted++;
      const t0 = Date.now();

      let event: string;
      let payload: any;

      if (!occupied) {
        event   = 'new_order';
        payload = { tableId, isComanda: false, items: [cartItem], observations: '', waiterName: name };
      } else {
        const activeOrder = ordersData.find((o: any) =>
          String(o.tableId) === String(tableId) && o.status !== 'finalizada'
        );
        event   = activeOrder ? 'add_item_to_order' : 'new_order';
        payload = activeOrder
          ? { orderId: activeOrder.id, item: { ...cartItem, waiterName: name } }
          : { tableId, isComanda: false, items: [cartItem], observations: '', waiterName: name };
      }

      sock.emit(event, payload);

      await new Promise<void>(res => {
        let done = false;

        const settle = (ok: boolean) => {
          if (done) return;
          done = true;
          sock.off('update_orders', onConfirm);
          sock.off('update_tables', onConfirm);
          sock.off('error_message', onError);
          clearTimeout(tid);
          // Não conta como falha se o teste já está sendo encerrado
          if (!ok && _stopFlag) { res(); return; }
          const lat = Date.now() - t0;
          m.latencies.push(lat);
          if (ok) {
            m.ok++;
            addLog(name, `✔ Mesa ${tableId} · ${qty}× ${item.name} · ${lat}ms`, 'ok');
          } else {
            m.failed++;
            m.errors.push(`Sem confirmação em ${CONFIRM_TIMEOUT}ms: ${event}`);
            addLog(name, `⚠️ Sem confirm. ${lat}ms — ${event}`, 'warn');
          }
          res();
        };

        // Confirmação positiva: qualquer update_orders/update_tables do servidor
        // indica que o evento foi processado (servidor é single-thread, processa em ordem)
        const onConfirm = () => settle(true);

        // Falha real: servidor rejeitou explicitamente com erro
        const onError = (msg: string) => {
          m.errors.push(`server: ${msg}`);
          addLog(name, `⚠️ ${msg}`, 'warn');
          settle(false);
        };

        sock.once('update_orders', onConfirm);
        sock.once('update_tables', onConfirm);
        sock.once('error_message', onError);
        const tid = setTimeout(() => settle(false), CONFIRM_TIMEOUT);
      });
    }
  }
}

// ── Componente ────────────────────────────────────────────────────────────────
export function TesteDeForgo() {
  const [, forceRender] = useState(0);

  useEffect(() => {
    _notifyRender = () => forceRender(n => n + 1);
    return () => { _notifyRender = null; };
  }, []);

  const running     = _running;
  const stopping    = _stopping;
  const log         = _log;
  const report      = _report;
  const showCleanup = _showCleanup;
  const [cleanWaiters, setCleanWaiters] = useState(true);
  const [cleanData,    setCleanData]    = useState(false);
  const [cleaning,     setCleaning]     = useState(false);
  const [cleaned,      setCleaned]      = useState(false);

  const runCleanup = async () => {
    setCleaning(true);
    socket.emit('cleanup_test_data', { deleteWaiters: cleanWaiters, deleteData: cleanData });
    await new Promise(r => setTimeout(r, 800));
    _showCleanup = false;
    setCleaning(false);
    setCleaned(true);
    notifyAll();
  };

  const verdictColor = !report ? '' :
    report.verdict === 'excellent' ? 'text-emerald-600' :
    report.verdict === 'good'      ? 'text-blue-600'    :
    report.verdict === 'warn'      ? 'text-amber-600'   : 'text-red-600';

  return (
    <div className="bg-white p-2.5 rounded-xl border border-[#141414]/10 shadow-sm mb-2.5 max-w-md">
      <div className="flex items-center space-x-2 mb-1.5">
        <Flame className="text-orange-500" size={12} />
        <h3 className="font-serif italic text-sm leading-none flex-1">Teste de Fogo</h3>
        {running && !stopping && <span className="text-[8px] font-bold text-orange-500 uppercase animate-pulse">Rodando…</span>}
        {stopping && <span className="text-[8px] font-bold text-red-500 uppercase animate-pulse">Encerrando…</span>}
      </div>
      <p className="text-[9px] opacity-50 mb-2.5 leading-snug">
        Simula {TOTAL} garçons fazendo lançamentos simultâneos. Aprove cada garçom na aba Garçons após iniciar.
      </p>

      <div className="flex gap-2">
        {!running ? (
          <button
            onClick={startTest}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide hover:bg-orange-600 transition-colors"
          >
            <Flame size={11} />
            Iniciar Teste de Fogo
          </button>
        ) : (
          <button
            onClick={stopTest}
            disabled={stopping}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide hover:bg-red-700 transition-colors disabled:opacity-60 disabled:cursor-wait"
          >
            <StopCircle size={11} />
            {stopping ? 'Encerrando…' : 'Parar Teste de Fogo'}
          </button>
        )}
      </div>

      {report && (
        <div className="mt-3 pt-3 border-t border-[#141414]/10 space-y-2">
          <p className={`text-[10px] font-bold ${verdictColor}`}>{report.verdictMsg}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[9px]">
            <span className="opacity-50">Duração</span>
            <span className="font-mono font-bold">{report.elapsed}s</span>
            <span className="opacity-50">Registrados</span>
            <span className="font-mono font-bold">{report.registered} / {TOTAL}</span>
            <span className="opacity-50">Aprovados</span>
            <span className="font-mono font-bold">{report.approved}</span>
            <span className="opacity-50">Inativados</span>
            <span className="font-mono font-bold">{report.inactivated}</span>
            <span className="opacity-50">Lançamentos</span>
            <span className="font-mono font-bold">{report.attempted}</span>
            <span className="opacity-50">Confirmados</span>
            <span className="font-mono font-bold text-emerald-600">{report.ok}</span>
            <span className="opacity-50">Sem confirm.</span>
            <span className={`font-mono font-bold ${report.failed > 0 ? 'text-red-500' : 'text-emerald-600'}`}>{report.failed}</span>
            <span className="opacity-50">Taxa</span>
            <span className="font-mono font-bold">{report.taxa}%</span>
            <span className="opacity-50">Lat. média</span>
            <span className="font-mono font-bold">{report.avg ?? '—'}ms</span>
            <span className="opacity-50">Lat. p95</span>
            <span className={`font-mono font-bold ${report.p95 !== null && report.p95 > 1500 ? 'text-amber-500' : ''}`}>{report.p95 ?? '—'}ms</span>
            <span className="opacity-50">Lat. máx</span>
            <span className={`font-mono font-bold ${report.max !== null && report.max > 3000 ? 'text-red-500' : ''}`}>{report.max ?? '—'}ms</span>
          </div>
          {report.errors.length > 0 && (
            <div className="mt-1">
              <p className="text-[9px] font-bold text-red-500 mb-0.5 flex items-center gap-1"><AlertTriangle size={9} /> Erros</p>
              {report.errors.map((e, i) => (
                <p key={i} className="text-[8px] opacity-60 leading-snug">• {e.msg} ×{e.count}</p>
              ))}
            </div>
          )}
          {report.errors.length === 0 && (
            <p className="text-[9px] text-emerald-600 flex items-center gap-1"><CheckCircle size={9} /> Nenhum erro registrado.</p>
          )}
        </div>
      )}

      {showCleanup && !cleaned && (
        <div className="mt-3 pt-3 border-t border-[#141414]/10">
          <p className="text-[10px] font-bold flex items-center gap-1 mb-2"><Trash2 size={10} className="text-red-500" /> Limpeza pós-teste</p>
          <div className="space-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cleanWaiters} onChange={e => setCleanWaiters(e.target.checked)} className="rounded" />
              <span className="text-[9px]">Excluir garçons do teste (<span className="font-mono">Garcom_Fogo_*</span>)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cleanData} onChange={e => setCleanData(e.target.checked)} className="rounded" />
              <span className="text-[9px]">Excluir pedidos e itens lançados pelo teste</span>
            </label>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={runCleanup}
              disabled={cleaning || (!cleanWaiters && !cleanData)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[9px] font-bold hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <Trash2 size={9} />
              {cleaning ? 'Limpando…' : 'Confirmar limpeza'}
            </button>
            <button
              onClick={() => { _showCleanup = false; notifyAll(); }}
              className="px-3 py-1.5 rounded-lg bg-gray-100 text-[#141414] text-[9px] font-bold hover:bg-gray-200 transition-colors"
            >
              Manter dados
            </button>
          </div>
        </div>
      )}

      {cleaned && (
        <div className="mt-2 text-[9px] text-emerald-600 flex items-center gap-1 font-bold">
          <CheckCircle size={9} /> Limpeza concluída.
        </div>
      )}

      {(running || log.length > 0) && (
        <div className="mt-3 pt-2 border-t border-[#141414]/10">
          <p className="text-[8px] font-bold uppercase opacity-40 mb-1">Log em tempo real</p>
          <div className="bg-[#141414] rounded-lg p-2 max-h-48 overflow-y-auto font-mono text-[8px] space-y-0.5">
            {log.map((l, i) => (
              <p key={i} className={
                l.kind === 'ok'   ? 'text-emerald-400' :
                l.kind === 'warn' ? 'text-amber-400'   : 'text-[#E4E3E0]/60'
              }>
                <span className="opacity-40">[{((l.ts - _metrics.start) / 1000).toFixed(1)}s]</span>{' '}
                <span className="opacity-70">[{l.waiter}]</span>{' '}
                {l.msg}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
