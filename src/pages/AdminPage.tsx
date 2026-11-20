import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Tenant {
  id: string;
  email: string;
  name: string;
  plan: string;
  createdAt: string;
  lastSignIn: string | null;
  isOnline: boolean;
}
interface Order {
  id: string;
  table_id: string | null;
  waiter_name: string | null;
  status: string;
  is_comanda: boolean;
  timestamp: string;
  items: any[];
  payment_log: any[];
}
interface FiscalNote {
  id: string;
  order_id: string;
  chave_acesso: string | null;
  status: string;
  protocolo: string | null;
  total: number | null;
  ambiente: string | null;
  modelo: string | null;
  serie: string | null;
  numero: string | null;
  error_detail: string | null;
  created_at: string;
}
interface Cashier {
  id: string;
  cash_register_name: string;
  opened_at: string | null;
  closed_at: string | null;
  total_sales: number | null;
  created_at: string;
}
interface Waiter {
  id: string;
  name: string;
  status: string;
  role: string;
}
interface ServerStats {
  uptime: number;
  memRss: number;
  memHeap: number;
  memHeapTotal: number;
  connectedSockets: number;
  activeTenants: number;
  nodeVersion: string;
  platform: string;
}
type TenantTab = 'orders' | 'notes' | 'cashiers' | 'waiters';
type MainTab = 'tenants' | 'server';

// ── Helpers ───────────────────────────────────────────────────────────────────
const TOKEN_KEY = 'fechaconta_dev_token';

function devFetch(path: string, init: RequestInit = {}) {
  const token = sessionStorage.getItem(TOKEN_KEY) || '';
  return fetch(path, { ...init, headers: { ...(init.headers || {}), 'x-dev-token': token } });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtMoney(val: number | null) {
  if (val == null) return '—';
  return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtBytes(b: number) {
  if (b > 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(0)} MB`;
  return `${(b / 1024).toFixed(0)} KB`;
}
function fmtUptime(s: number) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const STATUS_COLORS: Record<string, string> = {
  AUTORIZADO: 'bg-emerald-500/20 text-emerald-400',
  AUTORIZADO_COM_ALERTA: 'bg-yellow-500/20 text-yellow-400',
  REJEITADO: 'bg-red-500/20 text-red-400',
  CANCELADO: 'bg-orange-500/20 text-orange-400',
  PROCESSANDO: 'bg-blue-500/20 text-blue-400',
  RESULTADO_DESCONHECIDO: 'bg-gray-500/20 text-gray-400',
  finalizada: 'bg-emerald-500/20 text-emerald-400',
  open: 'bg-blue-500/20 text-blue-400',
  parcial: 'bg-yellow-500/20 text-yellow-400',
};

function StatusBadge({ s }: { s: string }) {
  const cls = STATUS_COLORS[s] || 'bg-gray-500/20 text-gray-400';
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${cls}`}>{s}</span>;
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const r = await fetch('/api/dev/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json();
      if (!r.ok || !d.token) {
        setError(d.error || 'Credenciais inválidas');
      } else {
        sessionStorage.setItem(TOKEN_KEY, d.token);
        onLogin(d.token);
      }
    } catch {
      setError('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h1 className="text-white text-xl font-bold">Modo Dev</h1>
          <p className="text-gray-500 text-sm mt-1">FechaConta — Painel Administrativo</p>
        </div>
        <form onSubmit={handleSubmit} className="bg-[#111] rounded-2xl border border-white/5 p-6 space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Usuário</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              required
              className="w-full px-3 py-2.5 bg-[#1A1A1A] border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1 uppercase tracking-wide">Senha</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2.5 bg-[#1A1A1A] border border-white/10 rounded-lg text-white text-sm placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
          </div>
          {error && <p className="text-red-400 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold transition-colors"
          >
            {loading ? 'Aguarde…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4">
      <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{label}</p>
      <p className="text-white text-2xl font-bold">{value}</p>
      {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
    </div>
  );
}

// ── Server Panel ──────────────────────────────────────────────────────────────
function ServerPanel() {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await devFetch('/api/dev/server');
      if (r.ok) setStats(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (loading) return <div className="p-6 text-gray-500 text-sm">Carregando…</div>;
  if (!stats) return <div className="p-6 text-red-400 text-sm">Erro ao carregar stats</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-semibold">Status do Servidor</h2>
        <button onClick={refresh} className="text-xs text-indigo-400 hover:text-indigo-300">↻ Atualizar</button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Uptime" value={fmtUptime(stats.uptime)} />
        <StatCard label="Memória RSS" value={fmtBytes(stats.memRss)} sub={`Heap ${fmtBytes(stats.memHeap)} / ${fmtBytes(stats.memHeapTotal)}`} />
        <StatCard label="WebSockets" value={String(stats.connectedSockets)} sub="conexões ativas" />
        <StatCard label="Tenants ativos" value={String(stats.activeTenants)} sub="em memória" />
      </div>
      <div className="bg-[#1A1A1A] border border-white/5 rounded-xl p-4 space-y-2 text-sm">
        <div className="flex justify-between text-gray-400"><span>Node.js</span><span className="text-white">{stats.nodeVersion}</span></div>
        <div className="flex justify-between text-gray-400"><span>Plataforma</span><span className="text-white">{stats.platform}</span></div>
        <div className="flex justify-between text-gray-400"><span>Heap utilizado</span><span className="text-white">{Math.round(stats.memHeap / stats.memHeapTotal * 100)}%</span></div>
      </div>
    </div>
  );
}

// ── Tenant Detail ─────────────────────────────────────────────────────────────
function TenantDetail({ tenant }: { tenant: Tenant }) {
  const [tab, setTab] = useState<TenantTab>('orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [notes, setNotes] = useState<FiscalNote[]>([]);
  const [cashiers, setCashiers] = useState<Cashier[]>([]);
  const [waiters, setWaiters] = useState<Waiter[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setOrders([]); setNotes([]); setCashiers([]); setWaiters([]);
  }, [tenant.id]);

  const load = useCallback(async (t: TenantTab) => {
    setLoading(true);
    try {
      const r = await devFetch(`/api/dev/tenants/${tenant.id}/${t}`);
      if (!r.ok) return;
      const d = await r.json();
      if (t === 'orders') setOrders(d.orders || []);
      else if (t === 'notes') setNotes(d.notes || []);
      else if (t === 'cashiers') setCashiers(d.cashiers || []);
      else if (t === 'waiters') setWaiters(d.waiters || []);
    } finally {
      setLoading(false);
    }
  }, [tenant.id]);

  const switchTab = (t: TenantTab) => { setTab(t); load(t); };

  useEffect(() => { load('orders'); }, [load]);

  const tabs: { key: TenantTab; label: string }[] = [
    { key: 'orders', label: 'Pedidos' },
    { key: 'notes', label: 'Notas Fiscais' },
    { key: 'cashiers', label: 'Caixas' },
    { key: 'waiters', label: 'Garçons' },
  ];

  const orderTotal = (o: Order) => {
    const fromPayment = (o.payment_log || []).reduce((s: number, p: any) => s + (p.amount || 0), 0);
    if (fromPayment > 0) return fromPayment;
    return (o.items || []).reduce((s: number, i: any) => s + (i.price || 0), 0);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tenant header */}
      <div className="px-5 pt-5 pb-3 border-b border-white/5">
        <div className="flex items-start gap-3">
          <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${tenant.isOnline ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          <div className="min-w-0">
            <h3 className="text-white font-semibold truncate">{tenant.name || 'Sem nome'}</h3>
            <p className="text-gray-500 text-xs truncate">{tenant.email}</p>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              <span className="px-2 py-0.5 bg-indigo-500/15 text-indigo-400 rounded text-[10px] uppercase font-semibold">{tenant.plan}</span>
              <span className="text-gray-600 text-[10px]">Desde {fmtDate(tenant.createdAt).split(',')[0]}</span>
              {tenant.lastSignIn && <span className="text-gray-600 text-[10px]">Último acesso {fmtDate(tenant.lastSignIn)}</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/5 px-5">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => switchTab(t.key)}
            className={`py-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${tab === t.key ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-500 hover:text-gray-300'}`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => load(tab)}
          className="ml-auto py-2.5 px-3 text-xs text-gray-600 hover:text-gray-400"
        >
          ↻
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-5 text-gray-500 text-sm">Carregando…</div>
        ) : tab === 'orders' ? (
          orders.length === 0 ? (
            <div className="p-5 text-gray-600 text-sm">Nenhum pedido encontrado</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left px-5 py-2">Mesa/Comanda</th>
                  <th className="text-left px-3 py-2">Garçom</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-5 py-2">Total</th>
                  <th className="text-right px-5 py-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b border-white/5 hover:bg-white/2">
                    <td className="px-5 py-2.5 text-gray-300">
                      {o.is_comanda ? `Comanda ${o.table_id}` : `Mesa ${o.table_id ?? '—'}`}
                    </td>
                    <td className="px-3 py-2.5 text-gray-400">{o.waiter_name || '—'}</td>
                    <td className="px-3 py-2.5"><StatusBadge s={o.status} /></td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmtMoney(orderTotal(o))}</td>
                    <td className="px-5 py-2.5 text-right text-gray-500">{fmtDate(o.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'notes' ? (
          notes.length === 0 ? (
            <div className="p-5 text-gray-600 text-sm">Nenhuma nota fiscal encontrada</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left px-5 py-2">Número</th>
                  <th className="text-left px-3 py-2">Modelo</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">Amb.</th>
                  <th className="text-right px-5 py-2">Total</th>
                  <th className="text-right px-5 py-2">Data</th>
                </tr>
              </thead>
              <tbody>
                {notes.map(n => (
                  <tr key={n.id} className="border-b border-white/5 hover:bg-white/2">
                    <td className="px-5 py-2.5 text-gray-300 font-mono">{n.serie ? `${n.serie}/${n.numero}` : '—'}</td>
                    <td className="px-3 py-2.5 text-gray-400">{n.modelo === '55' ? 'NF-e' : n.modelo === '65' ? 'NFC-e' : n.modelo || '—'}</td>
                    <td className="px-3 py-2.5"><StatusBadge s={n.status} /></td>
                    <td className="px-3 py-2.5 text-gray-500">{n.ambiente === '1' ? 'Prod' : n.ambiente === '2' ? 'Hom' : '—'}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmtMoney(n.total)}</td>
                    <td className="px-5 py-2.5 text-right text-gray-500">{fmtDate(n.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'cashiers' ? (
          cashiers.length === 0 ? (
            <div className="p-5 text-gray-600 text-sm">Nenhum relatório de caixa encontrado</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left px-5 py-2">Caixa</th>
                  <th className="text-left px-3 py-2">Abertura</th>
                  <th className="text-left px-3 py-2">Fechamento</th>
                  <th className="text-right px-5 py-2">Total</th>
                </tr>
              </thead>
              <tbody>
                {cashiers.map(c => (
                  <tr key={c.id} className="border-b border-white/5 hover:bg-white/2">
                    <td className="px-5 py-2.5 text-gray-300">{c.cash_register_name || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-400">{fmtDate(c.opened_at)}</td>
                    <td className="px-3 py-2.5 text-gray-400">{c.closed_at ? fmtDate(c.closed_at) : <span className="text-emerald-400">Aberto</span>}</td>
                    <td className="px-5 py-2.5 text-right text-gray-300">{fmtMoney(c.total_sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : tab === 'waiters' ? (
          waiters.length === 0 ? (
            <div className="p-5 text-gray-600 text-sm">Nenhum garçom encontrado</div>
          ) : (
            <div className="p-5 grid gap-2">
              {waiters.map(w => (
                <div key={w.id} className="flex items-center justify-between bg-[#1A1A1A] rounded-lg px-4 py-3">
                  <div>
                    <p className="text-white text-sm font-medium">{w.name}</p>
                    <p className="text-gray-500 text-xs">{w.role || 'waiter'}</p>
                  </div>
                  <StatusBadge s={w.status} />
                </div>
              ))}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [mainTab, setMainTab] = useState<MainTab>('tenants');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loadingTenants, setLoadingTenants] = useState(true);

  useEffect(() => {
    devFetch('/api/dev/tenants')
      .then(r => r.ok ? r.json() : { tenants: [] })
      .then(d => { setTenants(d.tenants || []); if (d.tenants?.length) setSelectedId(d.tenants[0].id); })
      .finally(() => setLoadingTenants(false));
  }, []);

  const filtered = tenants.filter(t =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.email.toLowerCase().includes(search.toLowerCase())
  );
  const selected = tenants.find(t => t.id === selectedId) || null;
  const onlineCount = tenants.filter(t => t.isOnline).length;

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col">
      {/* Header */}
      <header className="bg-[#111] border-b border-white/5 px-5 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <span className="text-white font-semibold text-sm">FechaConta DEV</span>
          <span className="text-gray-600 text-xs hidden sm:block">Painel Administrativo</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            {onlineCount} online
            <span className="ml-1">/ {tenants.length} total</span>
          </div>
          <div className="flex border border-white/10 rounded-lg overflow-hidden">
            <button onClick={() => setMainTab('tenants')} className={`px-3 py-1.5 text-xs font-semibold transition-colors ${mainTab === 'tenants' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>Estabelecimentos</button>
            <button onClick={() => setMainTab('server')} className={`px-3 py-1.5 text-xs font-semibold transition-colors ${mainTab === 'server' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}>Servidor</button>
          </div>
          <button onClick={onLogout} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Sair</button>
        </div>
      </header>

      {/* Body */}
      {mainTab === 'server' ? (
        <ServerPanel />
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Tenant sidebar */}
          <aside className="w-64 shrink-0 bg-[#111] border-r border-white/5 flex flex-col">
            <div className="p-3 border-b border-white/5">
              <input
                type="text"
                placeholder="Buscar…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-white/10 rounded-lg text-white text-xs placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {loadingTenants ? (
                <div className="p-4 text-gray-600 text-xs">Carregando…</div>
              ) : filtered.length === 0 ? (
                <div className="p-4 text-gray-600 text-xs">Nenhum estabelecimento</div>
              ) : filtered.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-4 py-3 border-b border-white/5 transition-colors ${selectedId === t.id ? 'bg-indigo-600/15 border-l-2 border-l-indigo-500' : 'hover:bg-white/3'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.isOnline ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    <span className="text-white text-xs font-medium truncate">{t.name || 'Sem nome'}</span>
                  </div>
                  <p className="text-gray-500 text-[10px] truncate pl-3.5 mt-0.5">{t.email}</p>
                  <p className="text-indigo-400/60 text-[10px] pl-3.5 mt-0.5 uppercase">{t.plan}</p>
                </button>
              ))}
            </div>
          </aside>

          {/* Detail panel */}
          <main className="flex-1 overflow-hidden flex flex-col">
            {selected ? (
              <TenantDetail tenant={selected} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
                Selecione um estabelecimento
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}

// ── Root Component ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');

  const handleLogin = (t: string) => setToken(t);

  const handleLogout = () => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken('');
  };

  if (!token) return <LoginScreen onLogin={handleLogin} />;
  return <Dashboard onLogout={handleLogout} />;
}
