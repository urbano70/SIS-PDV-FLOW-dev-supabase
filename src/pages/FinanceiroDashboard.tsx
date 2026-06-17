import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { toast } from 'sonner';
import { QRCodeSVG } from 'qrcode.react';
import {
  LayoutDashboard, Users, Receipt, ArrowLeft, Plus, Search, Edit2,
  Trash2, X, Check, ChevronDown, TrendingUp, TrendingDown, Wallet,
  Building, AlertCircle, Loader2, DollarSign, UserCheck, UserX, Calendar,
  Settings, History, QrCode, Printer, ClipboardList
} from 'lucide-react';

// ── Config types ───────────────────────────────────────────────────────────────
interface FinConfigItem { id: string; name: string; color?: string; }
interface FinConfig {
  departments: FinConfigItem[];
  sectors:     FinConfigItem[];
  roles:       FinConfigItem[];
}

const COLOR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280','#141414',
];

const DEFAULT_CONFIG: FinConfig = {
  departments: [
    { id: '1', name: 'Cozinha',   color: '#f97316' },
    { id: '2', name: 'Salão',     color: '#3b82f6' },
    { id: '3', name: 'Bar',       color: '#eab308' },
    { id: '4', name: 'Caixa',     color: '#22c55e' },
    { id: '5', name: 'Gestão',    color: '#8b5cf6' },
    { id: '6', name: 'Limpeza',   color: '#14b8a6' },
    { id: '7', name: 'Segurança', color: '#ef4444' },
  ],
  sectors: [
    { id: '1', name: 'Produção',       color: '#f97316' },
    { id: '2', name: 'Atendimento',    color: '#3b82f6' },
    { id: '3', name: 'Administrativo', color: '#8b5cf6' },
  ],
  roles: [
    { id: '1', name: 'Garçom' },
    { id: '2', name: 'Cozinheiro' },
    { id: '3', name: 'Auxiliar de Cozinha' },
    { id: '4', name: 'Caixa' },
    { id: '5', name: 'Gerente' },
    { id: '6', name: 'Repositor' },
  ],
};

function loadFinConfig(tenantId: string): FinConfig {
  try {
    const saved = localStorage.getItem(`fin_config_${tenantId}`);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_CONFIG;
}

function saveFinConfig(tenantId: string, cfg: FinConfig) {
  localStorage.setItem(`fin_config_${tenantId}`, JSON.stringify(cfg));
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface Employee {
  id: string;
  tenant_id: string;
  name: string;
  cpf: string;
  role: string;
  department: string;
  contract_type: 'clt' | 'pj' | 'freelancer' | 'diaria';
  payment_type: 'daily' | 'monthly';
  daily_rate: number;
  working_days: number;
  monthly_salary: number;
  discounts: number;
  additions: number;
  status: 'ativo' | 'afastado' | 'inativo' | 'pago';
  observations: string;
  created_at: string;
}

interface Payment {
  id: string;
  tenant_id: string;
  employee_id: string;
  employee_name: string;
  amount_gross: number;
  discounts: number;
  additions: number;
  amount_net: number;
  period: string;
  paid_at: string;
  notes: string;
}

interface Expense {
  id: string;
  tenant_id: string;
  name: string;
  category: string;
  amount: number;
  due_date: string;
  recurrence: 'mensal' | 'semanal' | 'anual';
  payment_method: string;
  paid: boolean;
  observations: string;
}

const DEPARTMENTS = ['Cozinha', 'Salão', 'Bar', 'Caixa', 'Gestão', 'Limpeza', 'Segurança', 'Outro'];
const CONTRACT_TYPES = [
  { value: 'clt', label: 'CLT' },
  { value: 'pj', label: 'PJ' },
  { value: 'freelancer', label: 'Freelancer' },
  { value: 'diaria', label: 'Diária' },
];
const EXPENSE_CATEGORIES = ['Aluguel', 'Energia', 'Internet', 'Água', 'Transporte', 'Equipamentos', 'Alimentação', 'Impostos', 'Serviços', 'Outro'];
const PAYMENT_METHODS = ['Pix', 'Transferência', 'Dinheiro', 'Débito', 'Crédito', 'Boleto'];

const EMPTY_EMPLOYEE: Omit<Employee, 'id' | 'tenant_id' | 'created_at'> = {
  name: '', cpf: '', role: '', department: 'Salão',
  contract_type: 'clt', payment_type: 'monthly',
  daily_rate: 0, working_days: 5, monthly_salary: 0,
  discounts: 0, additions: 0, status: 'ativo', observations: '',
};

const EMPTY_EXPENSE: Omit<Expense, 'id' | 'tenant_id'> = {
  name: '', category: 'Aluguel', amount: 0,
  due_date: '', recurrence: 'mensal',
  payment_method: 'Pix', paid: false, observations: '',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getRecordedFaltaIndices(obs: string, cycleDays: Date[]): number[] {
  if (!obs) return [];
  return cycleDays.map((d, i) => {
    const dateStr = d.toLocaleDateString('pt-BR');
    return (obs.includes('Falta') && obs.includes(dateStr)) ? i : -1;
  }).filter(i => i >= 0);
}

function getCycleDays(cycleStartDow: number): Date[] {
  const today = new Date();
  const daysBack = (today.getDay() - cycleStartDow + 7) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - daysBack);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDate = (iso: string) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const todayISO = () => new Date().toISOString().slice(0, 10);

function calcGross(e: Partial<Employee>): number {
  if (e.payment_type === 'daily') return (e.daily_rate || 0) * (e.working_days || 0);
  return e.monthly_salary || 0;
}
function calcNet(e: Partial<Employee>): number {
  return calcGross(e) + (e.additions || 0) - (e.discounts || 0);
}


const parseObservations = (obs: string) => {
  if (!obs) return { discounts: [], additions: [], others: [] };
  const items = obs.split(/[|\n]/).map(x => x.trim()).filter(Boolean);
  const discounts: string[] = [];
  const additions: string[] = [];
  const others: string[] = [];

  items.forEach(item => {
    const lower = item.toLowerCase();
    if (lower.includes('desconto')) {
      discounts.push(item);
    } else if (lower.includes('acréscimo') || lower.includes('acrescimo') || lower.includes('vale') || lower.includes('adicional')) {
      additions.push(item);
    } else {
      others.push(item);
    }
  });

  return { discounts, additions, others };
};

// ── Mini Bar Chart ─────────────────────────────────────────────────────────────
function MiniBar({ label, value, max, color = '#141414' }: { label: string; value: number; max: number; color?: string; key?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold w-24 shrink-0 truncate opacity-60">{label}</span>
      <div className="flex-1 bg-[#14141410] rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="text-[11px] font-bold w-20 text-right shrink-0">{fmt(value)}</span>
    </div>
  );
}

// ── Setup screen ───────────────────────────────────────────────────────────────
function SetupScreen() {
  const sql = `-- Execute no SQL Editor do Supabase:
create table if not exists fin_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  cpf text,
  role text,
  department text,
  contract_type text,
  payment_type text,
  daily_rate numeric default 0,
  working_days int default 5,
  monthly_salary numeric default 0,
  discounts numeric default 0,
  additions numeric default 0,
  status text default 'ativo',
  observations text,
  created_at timestamptz default now()
);

create table if not exists fin_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  employee_id uuid references fin_employees(id) on delete cascade,
  employee_name text,
  amount_gross numeric default 0,
  discounts numeric default 0,
  additions numeric default 0,
  amount_net numeric default 0,
  period text,
  paid_at timestamptz default now(),
  notes text
);

create table if not exists fin_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  name text not null,
  category text,
  amount numeric default 0,
  due_date date,
  recurrence text default 'mensal',
  payment_method text,
  paid boolean default false,
  observations text
);

-- Habilitar RLS
alter table fin_employees enable row level security;
alter table fin_payments enable row level security;
alter table fin_expenses enable row level security;

-- Policies (substitua 'auth.uid()::text' se usar tenant_id diferente)
create policy "owner" on fin_employees using (tenant_id = auth.uid()::text);
create policy "owner" on fin_payments using (tenant_id = auth.uid()::text);
create policy "owner" on fin_expenses using (tenant_id = auth.uid()::text);`;

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-[#141414]/10 p-8 max-w-2xl w-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center">
            <AlertCircle size={20} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-serif italic text-xl font-bold">Configuração necessária</h2>
            <p className="text-sm text-[#141414]/50">Crie as tabelas no Supabase para ativar o módulo financeiro.</p>
          </div>
        </div>
        <p className="text-sm text-[#141414]/60 mb-4">Acesse o <strong>SQL Editor</strong> do seu projeto Supabase e execute o script abaixo:</p>
        <pre className="bg-[#1e1e1e] text-green-400 text-[11px] p-4 rounded-xl overflow-auto max-h-64 font-mono leading-relaxed">{sql}</pre>
        <p className="text-xs text-[#141414]/40 mt-4">Após criar as tabelas, recarregue esta página.</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-6 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80 transition-opacity">
          Recarregar
        </button>
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
interface Props { ownerUser: any; }

export default function FinanceiroDashboard({ ownerUser }: Props) {
  const navigate = useNavigate();
  const tenantId = ownerUser?.id || '';

  useEffect(() => { document.title = 'Finan - FechaConta'; return () => { document.title = 'FechaConta - PDV'; }; }, []);

  const [tab, setTab] = useState<'geral' | 'colaboradores' | 'despesas'>('geral');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  // Config (departamentos, setores, cargos)
  const [config, setConfig] = useState<FinConfig>(() => loadFinConfig(tenantId));
  const [cfgModal, setCfgModal] = useState(false);
  const [cfgTab, setCfgTab] = useState<'departments' | 'sectors' | 'roles'>('departments');
  const [cfgEdit, setCfgEdit] = useState<FinConfig>(() => loadFinConfig(tenantId));

  const saveConfig = () => {
    saveFinConfig(tenantId, cfgEdit);
    setConfig(cfgEdit);
    setCfgModal(false);
    toast.success('Configurações salvas!');
  };

  const addItem = (key: keyof FinConfig) => {
    const newItem: FinConfigItem = { id: Date.now().toString(), name: '', color: COLOR_PALETTE[0] };
    setCfgEdit(p => ({ ...p, [key]: [...p[key], newItem] }));
  };

  const updateItem = (key: keyof FinConfig, id: string, patch: Partial<FinConfigItem>) => {
    setCfgEdit(p => ({ ...p, [key]: p[key].map(i => i.id === id ? { ...i, ...patch } : i) }));
  };

  const removeItem = (key: keyof FinConfig, id: string) => {
    setCfgEdit(p => ({ ...p, [key]: p[key].filter(i => i.id !== id) }));
  };

  // Data
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);

  // Employees UI
  const [empSearch, setEmpSearch] = useState('');
  const [empDeptFilter, setEmpDeptFilter] = useState('');
  const [empStatusFilter, setEmpStatusFilter] = useState('');
  const [empModal, setEmpModal] = useState(false);
  const [empEditing, setEmpEditing] = useState<Employee | null>(null);
  const [empForm, setEmpForm] = useState({ ...EMPTY_EMPLOYEE });
  const [empSaving, setEmpSaving] = useState(false);

  // Expenses UI
  const [expModal, setExpModal] = useState(false);
  const [expEditing, setExpEditing] = useState<Expense | null>(null);
  const [expForm, setExpForm] = useState({ ...EMPTY_EXPENSE });
  const [expSaving, setExpSaving] = useState(false);
  const [expCatFilter, setExpCatFilter] = useState('');

  // Ciclo atual (botão $)
  const [cycleModal, setCycleModal] = useState(false);
  const [cycleEmployee, setCycleEmployee] = useState<Employee | null>(null);

  // Tabela de folgas
  const [folgaTableModal, setFolgaTableModal] = useState(false);
  const [folgaTableSelected, setFolgaTableSelected] = useState<string | null>(null);
  const [folgaTableCfgOpen, setFolgaTableCfgOpen] = useState(false);

  // Filtro do dashboard
  type DashFilter = 'ciclo' | 'mes' | 'ano';
  const [dashFilter, setDashFilter] = useState<DashFilter>('ciclo');
  const [dashMonth, setDashMonth] = useState<string>(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  });
  const [dashYear, setDashYear] = useState<number>(new Date().getFullYear());

  // Histórico de pagamentos (botão History)
  const [payModal, setPayModal] = useState(false);
  const [payEmployee, setPayEmployee] = useState<Employee | null>(null);

  // Batch payment modal (botão Pagamentos na toolbar)
  const [batchPayModal, setBatchPayModal] = useState(false);
  const [batchPaySearch, setBatchPaySearch] = useState('');
  const [batchPayDept, setBatchPayDept] = useState('');
  const [batchPayRole, setBatchPayRole] = useState('');
  const [batchPaySector, setBatchPaySector] = useState('');
  const [batchPaySelectedIds, setBatchPaySelectedIds] = useState<string[]>([]);
  const [batchPayDate, setBatchPayDate] = useState(todayISO());
  const [batchPaySaving, setBatchPaySaving] = useState(false);

  // Discount modal UI
  const [discModal, setDiscModal] = useState(false);
  const [discAmount, setDiscAmount] = useState<number>(0);
  const [discReason, setDiscReason] = useState('');
  const [discSearch, setDiscSearch] = useState('');
  const [discDept, setDiscDept] = useState('');
  const [discRole, setDiscRole] = useState('');
  const [discSector, setDiscSector] = useState('');
  const [discSelectedIds, setDiscSelectedIds] = useState<string[]>([]);
  const [discDate, setDiscDate] = useState(todayISO());
  const [discSaving, setDiscSaving] = useState(false);
  // Sub-abas da aba Colaboradores
  const [empSubTab, setEmpSubTab] = useState<'equipe' | 'presenca'>('equipe');

  // Matriz de presença
  const [attMatrixOffset, setAttMatrixOffset] = useState(0); // 0=ciclo atual, -1=anterior, etc.
  const [attMatrixRecords, setAttMatrixRecords] = useState<any[]>([]);
  const [attMatrixLoading, setAttMatrixLoading] = useState(false);

  function getCycleDaysAtOffset(startDow: number, offset: number): Date[] {
    const today = new Date();
    const daysBack = (today.getDay() - startDow + 7) % 7;
    const start = new Date(today);
    start.setDate(today.getDate() - daysBack + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }

  const loadAttMatrix = async (offset: number) => {
    setAttMatrixLoading(true);
    const days = getCycleDaysAtOffset(discCycleStartDay, offset);
    const from = days[0].toISOString().slice(0, 10);
    const to = days[6].toISOString().slice(0, 10);
    try {
      const r = await fetch(`/api/attendance/records/${tenantId}?from=${from}&to=${to}`);
      const d = await r.json();
      setAttMatrixRecords(d.records || []);
    } catch {}
    setAttMatrixLoading(false);
  };

  useEffect(() => {
    if (empSubTab === 'presenca') loadAttMatrix(attMatrixOffset);
  }, [empSubTab, attMatrixOffset, discCycleStartDay]);

  // Ciclo semanal de descontos
  const [discCycleStartDay, setDiscCycleStartDay] = useState<number>(() => {
    const saved = localStorage.getItem(`disc_cycle_start_${tenantId}`);
    return saved !== null ? Number(saved) : 1; // padrão: segunda-feira
  });
  const [discFolgaDow, setDiscFolgaDow] = useState<number>(() => {
    const saved = localStorage.getItem(`disc_folga_dow_${tenantId}`);
    return saved !== null ? Number(saved) : 0; // padrão: domingo
  });
  const [discFechadoDow, setDiscFechadoDow] = useState<number>(() => {
    const saved = localStorage.getItem(`disc_fechado_dow_${tenantId}`);
    return saved !== null ? Number(saved) : -1; // padrão: nenhum
  });
  const [discDayCfgOpen, setDiscDayCfgOpen] = useState(false);
  const [discDaysChecked, setDiscDaysChecked] = useState<boolean[]>([true, true, true, true, true, true, false]);
  // Mapa de dia de folga por colaborador (localStorage)
  const [empRestDays, setEmpRestDays] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem(`emp_restdays_${tenantId}`); return s ? JSON.parse(s) : {}; } catch { return {}; }
  });
  const [empFormRestDay, setEmpFormRestDay] = useState<number>(-1);

  const applyDiscounts = async () => {
    if (discSelectedIds.length === 0) { toast.error('Selecione pelo menos um colaborador.'); return; }
    const cycleDays = getCycleDays(discCycleStartDay);
    // Dias marcados como falta pelo usuário (excluindo folga global e fechado)
    const userAbsentIndices = discDaysChecked
      .map((checked, i) => ({ checked, i }))
      .filter(({ checked, i }) => {
        const dow = cycleDays[i].getDay();
        const isAutoOff = dow === discFolgaDow || (discFechadoDow >= 0 && dow === discFechadoDow);
        return !checked && !isAutoOff;
      })
      .map(({ i }) => i);
    if (discAmount <= 0 && userAbsentIndices.length === 0) {
      toast.error('Informe um desconto ou marque dias de falta.'); return;
    }
    setDiscSaving(true);
    try {
      const promises = discSelectedIds.map(async id => {
        const emp = employees.find(e => e.id === id);
        if (!emp) return;
        const obsParts: string[] = [];
        let totalDiscount = 0;

        // Desconto por faltas — pula o dia de folga individual do colaborador
        const empFolgaDow = empRestDays[emp.id] ?? -1;
        const absentIndices = userAbsentIndices.filter(i => {
          const dow = cycleDays[i].getDay();
          return empFolgaDow < 0 || dow !== empFolgaDow;
        });
        if (absentIndices.length > 0) {
          const dailyRate = emp.payment_type === 'daily'
            ? emp.daily_rate
            : emp.monthly_salary / 30;
          // Filtrar faltas já gravadas para este colaborador neste ciclo
          const newAbsentIndices = absentIndices.filter(i => {
            const dateStr = cycleDays[i].toLocaleDateString('pt-BR');
            return !(emp.observations.includes('Falta') && emp.observations.includes(dateStr));
          });
          if (newAbsentIndices.length > 0) {
            totalDiscount += newAbsentIndices.length * dailyRate;
            newAbsentIndices.forEach(i => {
              const d = cycleDays[i];
              obsParts.push(`Desconto: ${fmt(dailyRate)} (Falta ${DAY_ABBR[d.getDay()]} ${d.toLocaleDateString('pt-BR')})`);
            });
          }
        }

        // Desconto manual
        if (discAmount > 0) {
          totalDiscount += discAmount;
          const dateTag = discDate ? ` em ${formatDate(discDate)}` : '';
          obsParts.push(`Desconto: ${fmt(discAmount)} (${discReason || 'Sem motivo'})${dateTag}`);
        }

        const newDiscounts = (emp.discounts || 0) + totalDiscount;
        const newObsPart = obsParts.join(' | ');
        const newObs = emp.observations ? `${emp.observations} | ${newObsPart}` : newObsPart;
        return supabase.from('fin_employees').update({ discounts: newDiscounts, observations: newObs }).eq('id', id);
      });
      await Promise.all(promises);
      toast.success('Descontos aplicados com sucesso!');
      setDiscModal(false);
      loadAll();
    } catch {
      toast.error('Erro ao aplicar descontos.');
    }
    setDiscSaving(false);
  };

  // Vale modal UI
  const [valeModal, setValeModal] = useState(false);
  const [valeAmount, setValeAmount] = useState<number>(0);
  const [valeReason, setValeReason] = useState('');
  const [valeSearch, setValeSearch] = useState('');
  const [valeDept, setValeDept] = useState('');
  const [valeRole, setValeRole] = useState('');
  const [valeSector, setValeSector] = useState('');
  const [valeSelectedIds, setValeSelectedIds] = useState<string[]>([]);
  const [valeDate, setValeDate] = useState(todayISO());
  const [valeSaving, setValeSaving] = useState(false);

  // Presença / QR Code
  const [attQrModal, setAttQrModal] = useState(false);
  const [attToken, setAttToken] = useState('');
  const [attDate, setAttDate] = useState('');
  const [attUrl, setAttUrl] = useState('');
  const [attLoading, setAttLoading] = useState(false);
  const [attRecords, setAttRecords] = useState<any[]>([]);
  const [attPanelDate, setAttPanelDate] = useState(todayISO());
  const [attPanelOpen, setAttPanelOpen] = useState(false);
  const [attPanelRecords, setAttPanelRecords] = useState<any[]>([]);
  const [attPanelLoading, setAttPanelLoading] = useState(false);

  const openAttQr = async () => {
    setAttLoading(true);
    setAttQrModal(true);
    try {
      const r = await fetch('/api/attendance/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId }),
      });
      const data = await r.json();
      if (data.error) { toast.error(data.error); setAttQrModal(false); }
      else {
        const url = `${window.location.origin}/presenca/${data.token}`;
        setAttToken(data.token);
        setAttDate(data.date);
        setAttUrl(url);
        // Load today's records
        const rr = await fetch(`/api/attendance/records/${tenantId}?from=${data.date}&to=${data.date}`);
        const dd = await rr.json();
        setAttRecords(dd.records || []);
      }
    } catch { toast.error('Erro ao gerar QR de presença.'); setAttQrModal(false); }
    setAttLoading(false);
  };

  const loadAttPanel = async (date: string) => {
    setAttPanelLoading(true);
    try {
      const r = await fetch(`/api/attendance/records/${tenantId}?from=${date}&to=${date}`);
      const d = await r.json();
      setAttPanelRecords(d.records || []);
    } catch {}
    setAttPanelLoading(false);
  };

  const openAttPanel = () => { setAttPanelOpen(true); loadAttPanel(attPanelDate); };

  const printAttQr = () => {
    const win = window.open('', '_blank', 'width=400,height=500');
    if (!win) return;
    const dateLabel = new Date(attDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const qrImg = document.getElementById('att-qr-svg')?.querySelector('svg')?.outerHTML || '';
    win.document.write(`<!DOCTYPE html><html><head><title>QR Presença</title>
      <style>body{font-family:sans-serif;text-align:center;padding:40px}h2{margin-bottom:4px}p{opacity:.6;font-size:14px;margin-bottom:20px}.qr{display:inline-block;border:3px solid #000;border-radius:12px;padding:12px;background:#fff}</style>
      </head><body><h2>Registro de Presença</h2><p style="text-transform:capitalize">${dateLabel}</p>
      <div class="qr">${qrImg}</div>
      <p style="margin-top:16px;font-size:12px">Escaneie o QR Code para confirmar sua presença</p>
      <script>window.onload=()=>{window.print();window.close()}</script>
      </body></html>`);
    win.document.close();
  };

  const applyVales = async () => {
    if (valeSelectedIds.length === 0) { toast.error('Selecione pelo menos um colaborador.'); return; }
    if (valeAmount <= 0) { toast.error('Informe um valor de vale válido.'); return; }
    setValeSaving(true);
    try {
      const promises = valeSelectedIds.map(async id => {
        const emp = employees.find(e => e.id === id);
        if (!emp) return;
        const newAdditions = (emp.additions || 0) + valeAmount;
        const dateTag = valeDate ? ` em ${formatDate(valeDate)}` : '';
        const newObs = emp.observations 
          ? `${emp.observations} | Vale: ${fmt(valeAmount)} (${valeReason || 'Sem motivo'})${dateTag}`
          : `Vale: ${fmt(valeAmount)} (${valeReason || 'Sem motivo'})${dateTag}`;
        return supabase.from('fin_employees').update({ 
          additions: newAdditions,
          observations: newObs
        }).eq('id', id);
      });
      await Promise.all(promises);
      toast.success('Vales aplicados com sucesso!');
      setValeModal(false);
      loadAll();
    } catch {
      toast.error('Erro ao aplicar vales.');
    }
    setValeSaving(false);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [empRes, payRes, expRes] = await Promise.all([
        supabase.from('fin_employees').select('*').eq('tenant_id', tenantId).order('name'),
        supabase.from('fin_payments').select('*').eq('tenant_id', tenantId).order('paid_at', { ascending: false }),
        supabase.from('fin_expenses').select('*').eq('tenant_id', tenantId).order('due_date'),
      ]);

      if (empRes.error?.code === '42P01') { setNeedsSetup(true); setLoading(false); return; }

      setEmployees((empRes.data || []) as Employee[]);
      setPayments((payRes.data || []) as Payment[]);
      setExpenses((expRes.data || []) as Expense[]);
    } catch {
      setNeedsSetup(true);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  if (loading) return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
      <Loader2 size={28} className="animate-spin opacity-40" />
    </div>
  );
  if (needsSetup) return <SetupScreen />;

  // ── Cálculo automático de salário (considera dia fechado + folga individual) ──
  const getEffectiveDays = (emp: Employee): number => {
    if (emp.payment_type !== 'daily') return 0;
    const daysOff = new Set<number>();
    const ef = empRestDays[emp.id];
    if (ef !== undefined && ef >= 0) daysOff.add(ef);
    if (discFechadoDow >= 0 && !daysOff.has(discFechadoDow)) daysOff.add(discFechadoDow);
    return 7 - daysOff.size;
  };
  const empCalcGross = (emp: Employee): number =>
    emp.payment_type === 'daily'
      ? (emp.daily_rate || 0) * getEffectiveDays(emp)
      : (emp.monthly_salary || 0);
  const empCalcNet = (emp: Employee): number =>
    empCalcGross(emp) + (emp.additions || 0) - (emp.discounts || 0);

  // ── Derived metrics ──────────────────────────────────────────────────────────
  const activeEmps = employees.filter(e => e.status === 'ativo' || e.status === 'pago');
  const totalFolha = activeEmps.reduce((s, e) => s + empCalcNet(e), 0);
  const totalBruto = activeEmps.reduce((s, e) => s + empCalcGross(e), 0);
  const totalDescontos = activeEmps.reduce((s, e) => s + e.discounts, 0);
  const totalAcrescimos = activeEmps.reduce((s, e) => s + e.additions, 0);
  const expPending = expenses.filter(e => !e.paid);
  const totalExpenses = expPending.reduce((s, e) => s + e.amount, 0);

  const now = new Date();
  const thisPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const monthPayments = payments.filter(p => p.period === thisPeriod);
  const totalPaidMonth = monthPayments.reduce((s, p) => s + p.amount_net, 0);

  // ── Dashboard métricas filtradas ────────────────────────────────────────────
  const dashPayments =
    dashFilter === 'ciclo' ? payments.filter(p => p.period === thisPeriod)
    : dashFilter === 'mes'  ? payments.filter(p => p.period === dashMonth)
    : payments.filter(p => p.period.startsWith(String(dashYear) + '-'));

  const dashExpenses =
    dashFilter === 'ciclo' ? expPending
    : dashFilter === 'mes'  ? expenses.filter(e => e.due_date?.startsWith(dashMonth))
    : expenses.filter(e => e.due_date?.startsWith(String(dashYear) + '-'));

  const dashTotalPaid        = dashPayments.reduce((s, p) => s + p.amount_net, 0);
  const dashTotalDiscounts   = dashFilter === 'ciclo' ? totalDescontos : dashPayments.reduce((s, p) => s + p.discounts, 0);
  const dashTotalAdditions   = dashFilter === 'ciclo' ? totalAcrescimos : dashPayments.reduce((s, p) => s + p.additions, 0);
  const dashNetPayroll       = dashFilter === 'ciclo' ? totalFolha : dashTotalPaid;
  const dashExpenseTotal     = dashExpenses.reduce((s, e) => s + e.amount, 0);
  const dashActiveCount      = dashFilter === 'ciclo'
    ? activeEmps.length
    : new Set(dashPayments.map(p => p.employee_id)).size;

  const dashByDept: Record<string, number> = {};
  if (dashFilter === 'ciclo') {
    activeEmps.forEach(e => { dashByDept[e.department] = (dashByDept[e.department] || 0) + empCalcNet(e); });
  } else {
    dashPayments.forEach(p => {
      const emp = employees.find(e => e.id === p.employee_id);
      const dept = emp?.department || 'Outro';
      dashByDept[dept] = (dashByDept[dept] || 0) + p.amount_net;
    });
  }
  const dashMaxDept = Math.max(...Object.values(dashByDept), 1);

  const dashByCat: Record<string, number> = {};
  dashExpenses.forEach(e => { dashByCat[e.category] = (dashByCat[e.category] || 0) + e.amount; });
  const dashMaxCat = Math.max(...Object.values(dashByCat), 1);

  // Anos disponíveis nos pagamentos (para o seletor de ano)
  const availableYears = [...new Set([
    ...payments.map(p => parseInt(p.period.slice(0, 4))),
    new Date().getFullYear(),
  ])].sort((a, b) => b - a);

  // ── Employees CRUD ───────────────────────────────────────────────────────────
  const openAddEmp = () => { setEmpEditing(null); setEmpForm({ ...EMPTY_EMPLOYEE }); setEmpFormRestDay(-1); setEmpModal(true); };
  const openEditEmp = (e: Employee) => {
    setEmpEditing(e);
    setEmpForm({ name: e.name, cpf: e.cpf, role: e.role, department: e.department, contract_type: e.contract_type, payment_type: e.payment_type, daily_rate: e.daily_rate, working_days: e.working_days, monthly_salary: e.monthly_salary, discounts: 0, additions: 0, status: e.status, observations: e.observations });
    setEmpFormRestDay(empRestDays[e.id] ?? -1);
    setEmpModal(true);
  };

  const saveEmployee = async () => {
    if (!empForm.name.trim()) { toast.error('Nome obrigatório.'); return; }
    setEmpSaving(true);
    const payload = { ...empForm, tenant_id: tenantId };
    const { error } = empEditing
      ? await supabase.from('fin_employees').update(payload).eq('id', empEditing.id)
      : await supabase.from('fin_employees').insert(payload);
    if (error) { toast.error('Erro ao salvar colaborador.'); }
    else {
      // Persiste dia de folga individual no localStorage
      if (empEditing) {
        const updated = { ...empRestDays };
        if (empFormRestDay >= 0) updated[empEditing.id] = empFormRestDay;
        else delete updated[empEditing.id];
        localStorage.setItem(`emp_restdays_${tenantId}`, JSON.stringify(updated));
        setEmpRestDays(updated);
      }
      toast.success(empEditing ? 'Colaborador atualizado!' : 'Colaborador cadastrado!');
      setEmpModal(false);
      loadAll();
    }
    setEmpSaving(false);
  };

  const deleteEmployee = async (id: string) => {
    if (!confirm('Excluir colaborador?')) return;
    await supabase.from('fin_employees').delete().eq('id', id);
    const updated = { ...empRestDays };
    delete updated[id];
    localStorage.setItem(`emp_restdays_${tenantId}`, JSON.stringify(updated));
    setEmpRestDays(updated);
    toast.success('Colaborador excluído.');
    loadAll();
  };

  // ── Payments ─────────────────────────────────────────────────────────────────
  const openPayHistory = (e: Employee) => { setPayEmployee(e); setPayModal(true); };

  const applyBatchPayments = async () => {
    if (batchPaySelectedIds.length === 0) { toast.error('Selecione pelo menos um colaborador.'); return; }
    setBatchPaySaving(true);
    const paidAt = batchPayDate ? new Date(batchPayDate + 'T12:00:00').toISOString() : new Date().toISOString();
    try {
      const promises = batchPaySelectedIds.map(async id => {
        const emp = employees.find(e => e.id === id);
        if (!emp) return;
        const gross = empCalcGross(emp);
        const net = empCalcNet(emp);
        const detailNotes = emp.observations || '';
        await supabase.from('fin_payments').insert({
          tenant_id: tenantId, employee_id: emp.id,
          employee_name: emp.name, amount_gross: gross,
          discounts: emp.discounts, additions: emp.additions,
          amount_net: net, period: thisPeriod,
          paid_at: paidAt, notes: detailNotes,
        });
        await supabase.from('fin_employees').update({
          status: 'pago',
          discounts: 0,
          additions: 0,
          observations: '',
        }).eq('id', id);
      });
      await Promise.all(promises);
      toast.success(`${batchPaySelectedIds.length} pagamento(s) registrado(s)!`);
      setBatchPayModal(false);
      loadAll();
    } catch {
      toast.error('Erro ao registrar pagamentos.');
    }
    setBatchPaySaving(false);
  };

  // ── Expenses CRUD ─────────────────────────────────────────────────────────────
  const openAddExp = () => { setExpEditing(null); setExpForm({ ...EMPTY_EXPENSE }); setExpModal(true); };
  const openEditExp = (e: Expense) => { setExpEditing(e); setExpForm({ name: e.name, category: e.category, amount: e.amount, due_date: e.due_date, recurrence: e.recurrence, payment_method: e.payment_method, paid: e.paid, observations: e.observations }); setExpModal(true); };

  const saveExpense = async () => {
    if (!expForm.name.trim()) { toast.error('Nome obrigatório.'); return; }
    setExpSaving(true);
    const payload = { ...expForm, tenant_id: tenantId };
    const { error } = expEditing
      ? await supabase.from('fin_expenses').update(payload).eq('id', expEditing.id)
      : await supabase.from('fin_expenses').insert(payload);
    if (error) { toast.error('Erro ao salvar despesa.'); }
    else { toast.success(expEditing ? 'Despesa atualizada!' : 'Despesa cadastrada!'); setExpModal(false); loadAll(); }
    setExpSaving(false);
  };

  const deleteExpense = async (id: string) => {
    if (!confirm('Excluir despesa?')) return;
    await supabase.from('fin_expenses').delete().eq('id', id);
    toast.success('Despesa excluída.');
    loadAll();
  };

  const togglePaid = async (e: Expense) => {
    await supabase.from('fin_expenses').update({ paid: !e.paid }).eq('id', e.id);
    loadAll();
  };

  // ── Filtered lists ────────────────────────────────────────────────────────────
  const filteredEmps = employees.filter(e => {
    const q = empSearch.toLowerCase();
    return (!q || e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q))
      && (!empDeptFilter || e.department === empDeptFilter)
      && (!empStatusFilter || e.status === empStatusFilter);
  });
  const filteredExps = expenses.filter(e => !expCatFilter || e.category === expCatFilter);

  // ── Status badge ──────────────────────────────────────────────────────────────
  const statusBadge = (s: string) => {
    const map: Record<string, string> = { ativo: 'bg-green-100 text-green-700', afastado: 'bg-amber-100 text-amber-700', inativo: 'bg-red-100 text-red-700', pago: 'bg-blue-100 text-blue-700' };
    return <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${map[s] || ''}`}>{s}</span>;
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414]">
      {/* Header */}
      <header className="bg-white border-b border-[#141414]/10 px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <button onClick={() => navigate('/portal')} className="p-1.5 hover:bg-[#141414]/5 rounded-lg transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-lg font-bold">Gestão Empresarial</span>
        </div>
        <nav className="ml-6 flex gap-1">
          {([
            { id: 'geral', label: 'Geral', icon: LayoutDashboard },
            { id: 'colaboradores', label: 'Colaboradores', icon: Users },
            { id: 'despesas', label: 'Despesas', icon: Receipt },
          ] as const).map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${tab === id ? 'bg-[#141414] text-white' : 'hover:bg-[#141414]/5 text-[#141414]/60'}`}>
              <Icon size={14} />{label}
            </button>
          ))}
        </nav>
        <button onClick={() => { setCfgEdit(config); setCfgModal(true); }}
          className="ml-auto flex items-center gap-2 px-3 py-2 rounded-xl border border-[#141414]/20 text-sm font-semibold text-[#141414]/60 hover:bg-[#141414]/5 transition-colors">
          <Settings size={15} /> Configurações
        </button>
      </header>

      <main className="max-w-6xl mx-auto p-6">

        {/* ── TAB: GERAL ──────────────────────────────────────────────────────── */}
        {tab === 'geral' && (
          <div className="space-y-6">

            {/* ── Filtros do dashboard ── */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex bg-white border border-[#141414]/10 rounded-xl p-1 shadow-sm gap-1">
                {(['ciclo', 'mes', 'ano'] as const).map(f => (
                  <button key={f} onClick={() => setDashFilter(f)}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all duration-200
                      ${dashFilter === f ? 'bg-[#141414] text-white shadow-sm' : 'text-[#141414]/50 hover:text-[#141414] hover:bg-[#141414]/5'}`}>
                    {f === 'ciclo' ? 'Ciclo atual' : f === 'mes' ? 'Por mês' : 'Por ano'}
                  </button>
                ))}
              </div>
              {dashFilter === 'mes' && (
                <input type="month" value={dashMonth} onChange={e => setDashMonth(e.target.value)}
                  className="bg-white border border-[#141414]/10 rounded-xl px-4 py-2 text-sm font-bold text-[#141414]/70 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20 transition-all duration-200" />
              )}
              {dashFilter === 'ano' && (
                <select value={dashYear} onChange={e => setDashYear(Number(e.target.value))}
                  className="bg-white border border-[#141414]/10 rounded-xl px-4 py-2 text-sm font-bold text-[#141414]/70 shadow-sm focus:outline-none appearance-none cursor-pointer transition-all duration-200">
                  {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
              <span className="text-xs text-[#141414]/40 font-medium">
                {dashFilter === 'ciclo' ? `Período: ${thisPeriod}`
                  : dashFilter === 'mes' ? `Mês: ${new Date(dashMonth + '-15').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`
                  : `Ano: ${dashYear}`}
              </span>
            </div>

            {/* ── Cards e gráficos (animam ao trocar filtro) ── */}
            <div key={`${dashFilter}-${dashMonth}-${dashYear}`} className="space-y-6">

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: dashFilter === 'ciclo' ? 'Colaboradores ativos' : 'Colaboradores pagos', value: dashActiveCount.toString(), icon: UserCheck, color: 'text-green-600', bg: 'bg-green-50' },
                { label: 'Descontos', value: fmt(dashTotalDiscounts), icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50' },
                { label: 'Acréscimos', value: fmt(dashTotalAdditions), icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                { label: 'Folha líquida', value: fmt(dashNetPayroll), icon: Wallet, color: 'text-[#141414]', bg: 'bg-[#141414]/5' },
                { label: dashFilter === 'ciclo' ? 'Despesas pendentes' : 'Despesas no período', value: fmt(dashExpenseTotal), icon: AlertCircle, color: 'text-amber-600', bg: 'bg-amber-50' },
              ].map(({ label, value, icon: Icon, color, bg }) => (
                <div key={label} className="bg-white rounded-xl p-4 border border-[#141414]/10 shadow-sm transition-all duration-300">
                  <div className={`w-8 h-8 ${bg} rounded-lg flex items-center justify-center mb-3`}>
                    <Icon size={15} className={color} />
                  </div>
                  <p className="text-[10px] font-bold uppercase opacity-40 leading-none mb-1">{label}</p>
                  <p className="text-base font-bold leading-tight">{value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* By department */}
              <div className="bg-white rounded-xl p-5 border border-[#141414]/10 shadow-sm">
                <h3 className="font-serif italic text-base font-bold mb-4">Custo por Departamento</h3>
                {Object.keys(dashByDept).length === 0 ? (
                  <p className="text-sm opacity-40">Sem dados para o período.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(dashByDept).sort((a, b) => b[1] - a[1]).map(([dept, val]) => (
                      <MiniBar key={dept} label={dept} value={val} max={dashMaxDept} />
                    ))}
                  </div>
                )}
              </div>

              {/* By expense category */}
              <div className="bg-white rounded-xl p-5 border border-[#141414]/10 shadow-sm">
                <h3 className="font-serif italic text-base font-bold mb-4">Despesas por Categoria</h3>
                {Object.keys(dashByCat).length === 0 ? (
                  <p className="text-sm opacity-40">Sem despesas no período.</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(dashByCat).sort((a, b) => b[1] - a[1]).map(([cat, val]) => (
                      <MiniBar key={cat} label={cat} value={val} max={dashMaxCat} color="#f59e0b" />
                    ))}
                  </div>
                )}
              </div>

              {/* Recent payments */}
              <div className="bg-white rounded-xl p-5 border border-[#141414]/10 shadow-sm">
                <h3 className="font-serif italic text-base font-bold mb-4">
                  {dashFilter === 'ciclo' ? 'Últimos Pagamentos' : 'Pagamentos no Período'}
                </h3>
                {dashPayments.length === 0 ? <p className="text-sm opacity-40">Nenhum pagamento no período.</p> : (
                  <div className="space-y-2">
                    {dashPayments.slice(0, 6).map(p => (
                      <div key={p.id} className="flex items-center justify-between py-2 border-b border-[#14141408] last:border-0">
                        <div>
                          <p className="text-sm font-semibold">{p.employee_name}</p>
                          <p className="text-[11px] opacity-40">{new Date(p.paid_at).toLocaleDateString('pt-BR')} · {p.period}</p>
                        </div>
                        <span className="font-bold text-sm text-green-700">{fmt(p.amount_net)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Upcoming expenses */}
              <div className="bg-white rounded-xl p-5 border border-[#141414]/10 shadow-sm">
                <h3 className="font-serif italic text-base font-bold mb-4">
                  {dashFilter === 'ciclo' ? 'Despesas Pendentes' : 'Despesas no Período'}
                </h3>
                {dashExpenses.length === 0 ? <p className="text-sm opacity-40">Sem despesas no período.</p> : (
                  <div className="space-y-2">
                    {dashExpenses.slice(0, 6).map(e => (
                      <div key={e.id} className="flex items-center justify-between py-2 border-b border-[#14141408] last:border-0">
                        <div>
                          <p className="text-sm font-semibold">{e.name}</p>
                          <p className="text-[11px] opacity-40">{e.category} · Vence {e.due_date ? new Date(e.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</p>
                        </div>
                        <span className="font-bold text-sm text-amber-700">{fmt(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            </div>{/* fim div key (animação) */}
          </div>
        )}

        {/* ── TAB: COLABORADORES ──────────────────────────────────────────────── */}
        {tab === 'colaboradores' && (
          <div>
            {/* Toolbar */}
            <div className="flex flex-wrap gap-3 mb-5">
              <div className="flex-1 min-w-48 relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
                <input value={empSearch} onChange={e => setEmpSearch(e.target.value)} placeholder="Buscar colaborador..."
                  className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#141414]/10 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
              </div>
              <select value={empDeptFilter} onChange={e => setEmpDeptFilter(e.target.value)}
                className="px-3 py-2.5 bg-white border border-[#141414]/10 rounded-xl text-sm focus:outline-none appearance-none cursor-pointer">
                <option value="">Todos depart.</option>
                {config.departments.map(d => <option key={d.id}>{d.name}</option>)}
              </select>
              <select value={empStatusFilter} onChange={e => setEmpStatusFilter(e.target.value)}
                className="px-3 py-2.5 bg-white border border-[#141414]/10 rounded-xl text-sm focus:outline-none appearance-none cursor-pointer">
                <option value="">Todos status</option>
                <option value="ativo">Ativo</option>
                <option value="afastado">Afastado</option>
                <option value="inativo">Inativo</option>
                <option value="pago">Pago</option>
              </select>
              <button onClick={openAddEmp} className="flex items-center gap-2 px-4 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80 transition-opacity">
                <Plus size={15} /> Novo Colaborador
              </button>
            </div>

            {/* Ações Rápidas */}
            <div className="flex gap-2 mb-4">
              <button onClick={() => {
                setDiscAmount(0);
                setDiscReason('');
                setDiscSearch('');
                setDiscDept('');
                setDiscRole('');
                setDiscSector('');
                setDiscSelectedIds([]);
                setDiscDate(todayISO());
                setDiscDaysChecked(getCycleDays(discCycleStartDay).map(d => {
                  const dow = d.getDay();
                  return dow !== discFolgaDow && (discFechadoDow < 0 || dow !== discFechadoDow);
                }));
                setDiscDayCfgOpen(false);
                setDiscModal(true);
              }} className="px-4 py-2 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/75 hover:bg-[#141414]/5 hover:text-[#141414] transition-all">
                Descontos
              </button>
              <button onClick={() => {
                setValeAmount(0);
                setValeReason('');
                setValeSearch('');
                setValeDept('');
                setValeRole('');
                setValeSector('');
                setValeSelectedIds([]);
                setValeDate(todayISO());
                setValeModal(true);
              }} className="px-4 py-2 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/75 hover:bg-[#141414]/5 hover:text-[#141414] transition-all">
                Vales
              </button>
              <button onClick={() => {
                setBatchPaySearch('');
                setBatchPayDept('');
                setBatchPayRole('');
                setBatchPaySector('');
                setBatchPaySelectedIds([]);
                setBatchPayDate(todayISO());
                setBatchPayModal(true);
              }} className="px-4 py-2 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/75 hover:bg-[#141414]/5 hover:text-[#141414] transition-all">
                Pagamentos
              </button>
              <button onClick={openAttQr}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#141414] text-[#E4E3E0] border border-[#141414] rounded-xl text-xs font-bold hover:opacity-80 transition-all">
                <QrCode size={13} /> QR Presença
              </button>
              <button onClick={() => setFolgaTableModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/75 hover:bg-[#141414]/5 hover:text-[#141414] transition-all ml-auto">
                <Calendar size={13} /> Tabela de Folgas
              </button>
            </div>

            {/* Sub-abas */}
            <div className="flex gap-1 mb-4 bg-[#F5F5F3] p-1 rounded-xl w-fit">
              {([
                { id: 'equipe', label: 'Equipe' },
                { id: 'presenca', label: 'Presença' },
              ] as const).map(({ id, label }) => (
                <button key={id} onClick={() => setEmpSubTab(id)}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${empSubTab === id ? 'bg-white text-[#141414] shadow-sm' : 'text-[#141414]/40 hover:text-[#141414]/70'}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* ── Sub-aba: EQUIPE ─────────────────────────────── */}
            {empSubTab === 'equipe' && (
            <div className="bg-white rounded-xl border border-[#141414]/10 shadow-sm overflow-hidden">
              {filteredEmps.length === 0 ? (
                <div className="p-12 text-center opacity-40">
                  <Users size={32} className="mx-auto mb-3" />
                  <p className="text-sm">Nenhum colaborador encontrado.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#F5F5F3] border-b border-[#141414]/10">
                    <tr>
                      {['Nome', 'Cargo / Depart.', 'Regime', 'Bruto', 'Líquido', 'Status', ''].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase opacity-40">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmps.map(e => (
                      <tr key={e.id} className="border-b border-[#14141408] hover:bg-[#F5F5F3]/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-semibold">{e.name}</p>
                          <p className="text-[11px] opacity-40">{e.cpf}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{e.role || '—'}</p>
                          <p className="text-[11px] opacity-40">{e.department}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[11px] font-bold uppercase bg-[#141414]/5 px-2 py-0.5 rounded-full">{e.contract_type}</span>
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold text-sm">{fmt(empCalcGross(e))}</td>
                        <td className="px-4 py-3 font-mono font-bold text-sm text-green-700">{fmt(empCalcNet(e))}</td>
                        <td className="px-4 py-3">{statusBadge(e.status)}</td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            {(() => {
                              const isCycleEmpty = e.status === 'pago' && e.discounts === 0 && e.additions === 0 && !e.observations;
                              return (
                                <button
                                  onClick={() => { setCycleEmployee(e); setCycleModal(true); }}
                                  title={isCycleEmpty ? 'Ciclo zerado — sem movimentações' : 'Ciclo atual'}
                                  className={`p-1.5 rounded-lg transition-colors ${isCycleEmpty ? 'text-gray-300 hover:bg-gray-50 cursor-default' : 'hover:bg-green-50 text-green-600'}`}>
                                  <DollarSign size={14} />
                                </button>
                              );
                            })()}
                            <button
                              onClick={() => openPayHistory(e)}
                              title="Histórico de pagamentos"
                              className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500 transition-colors">
                              <History size={14} />
                            </button>
                            <button onClick={() => openEditEmp(e)} className="p-1.5 rounded-lg hover:bg-[#141414]/5 transition-colors"><Edit2 size={14} /></button>
                            <button onClick={() => deleteEmployee(e.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            )}

            {/* ── Sub-aba: PRESENÇA ───────────────────────────── */}
            {empSubTab === 'presenca' && (() => {
              const cycleDays = getCycleDaysAtOffset(discCycleStartDay, attMatrixOffset);
              const from = cycleDays[0].toISOString().slice(0, 10);
              const to = cycleDays[6].toISOString().slice(0, 10);
              const activeEmpsForMatrix = employees.filter(e => e.status !== 'inativo');

              // Map: date -> Set of employee_ids confirmed
              const confirmedMap: Record<string, Set<string>> = {};
              attMatrixRecords.forEach(r => {
                if (!confirmedMap[r.date]) confirmedMap[r.date] = new Set();
                confirmedMap[r.date].add(r.employee_id);
              });

              const totalDays = cycleDays.length;
              const cycleLabel = `${cycleDays[0].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} – ${cycleDays[6].toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;

              return (
                <div>
                  {/* Navegação de ciclos */}
                  <div className="flex items-center justify-between mb-4">
                    <button onClick={() => setAttMatrixOffset(o => o - 1)}
                      className="px-3 py-1.5 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors flex items-center gap-1">
                      ← Anterior
                    </button>
                    <div className="text-center">
                      <p className="text-sm font-bold">{cycleLabel}</p>
                      {attMatrixOffset === 0 && <p className="text-[10px] text-green-600 font-bold">Ciclo atual</p>}
                      {attMatrixOffset < 0 && <p className="text-[10px] opacity-40">{Math.abs(attMatrixOffset)} ciclo{Math.abs(attMatrixOffset) > 1 ? 's' : ''} atrás</p>}
                    </div>
                    <button onClick={() => setAttMatrixOffset(o => Math.min(o + 1, 0))}
                      disabled={attMatrixOffset >= 0}
                      className="px-3 py-1.5 bg-white border border-[#141414]/15 rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors disabled:opacity-30 flex items-center gap-1">
                      Próximo →
                    </button>
                  </div>

                  {/* Resumo do ciclo */}
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="bg-white rounded-xl border border-[#141414]/10 p-3 text-center">
                      <p className="text-[10px] uppercase font-bold opacity-40 mb-1">Colaboradores</p>
                      <p className="text-xl font-bold">{activeEmpsForMatrix.length}</p>
                    </div>
                    <div className="bg-green-50 rounded-xl border border-green-100 p-3 text-center">
                      <p className="text-[10px] uppercase font-bold text-green-600 mb-1">Total Presenças</p>
                      <p className="text-xl font-bold text-green-700">{attMatrixRecords.length}</p>
                    </div>
                    <div className="bg-red-50 rounded-xl border border-red-100 p-3 text-center">
                      <p className="text-[10px] uppercase font-bold text-red-500 mb-1">Total Faltas</p>
                      <p className="text-xl font-bold text-red-600">
                        {activeEmpsForMatrix.length * totalDays - attMatrixRecords.length}
                      </p>
                    </div>
                  </div>

                  {/* Tabela / Matriz */}
                  {attMatrixLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 size={24} className="animate-spin opacity-40" />
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-[#141414]/10 shadow-sm overflow-x-auto">
                      <table className="w-full text-sm border-collapse">
                        <thead className="bg-[#F5F5F3]">
                          <tr>
                            <th className="text-left px-4 py-3 text-[11px] font-bold uppercase opacity-40 sticky left-0 bg-[#F5F5F3] min-w-36 border-r border-[#141414]/10">
                              Colaborador
                            </th>
                            {cycleDays.map(d => {
                              const isToday = d.toISOString().slice(0, 10) === todayISO();
                              return (
                                <th key={d.toISOString()} className={`text-center px-2 py-3 min-w-12 ${isToday ? 'bg-[#141414]/5' : ''}`}>
                                  <p className="text-[10px] font-bold opacity-40">{DAY_ABBR[d.getDay()]}</p>
                                  <p className={`text-sm font-bold ${isToday ? 'text-[#141414]' : 'opacity-60'}`}>{d.getDate()}</p>
                                </th>
                              );
                            })}
                            <th className="text-center px-3 py-3 text-[11px] font-bold uppercase opacity-40 min-w-20">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeEmpsForMatrix.length === 0 ? (
                            <tr>
                              <td colSpan={totalDays + 2} className="text-center py-10 opacity-40 text-sm">
                                Nenhum colaborador ativo.
                              </td>
                            </tr>
                          ) : (
                            activeEmpsForMatrix.map(emp => {
                              const presences = cycleDays.filter(d => {
                                const dateStr = d.toISOString().slice(0, 10);
                                return confirmedMap[dateStr]?.has(emp.id);
                              }).length;
                              return (
                                <tr key={emp.id} className="border-t border-[#14141408] hover:bg-[#F5F5F3]/40 transition-colors">
                                  <td className="px-4 py-2.5 sticky left-0 bg-white border-r border-[#141414]/10">
                                    <p className="font-semibold text-sm truncate max-w-32">{emp.name}</p>
                                    <p className="text-[10px] opacity-40 truncate">{emp.role || emp.department}</p>
                                  </td>
                                  {cycleDays.map(d => {
                                    const dateStr = d.toISOString().slice(0, 10);
                                    const isFuture = dateStr > todayISO();
                                    const confirmed = confirmedMap[dateStr]?.has(emp.id);
                                    const isToday = dateStr === todayISO();
                                    return (
                                      <td key={dateStr} className={`text-center px-2 py-2.5 ${isToday ? 'bg-[#141414]/5' : ''}`}>
                                        {isFuture ? (
                                          <span className="text-[#141414]/15 text-lg">·</span>
                                        ) : confirmed ? (
                                          <span className="text-green-500 font-bold text-base" title="Presente">✓</span>
                                        ) : (
                                          <span className="text-red-300 text-sm font-bold" title="Ausente">✕</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                  <td className="text-center px-3 py-2.5">
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${presences === totalDays ? 'bg-green-100 text-green-700' : presences === 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700'}`}>
                                      {presences}/{totalDays}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <p className="text-[10px] text-center opacity-30 mt-3">
                    Presenças confirmadas via QR Code · ✓ Presente · ✕ Ausente · · Futuro
                  </p>
                </div>
              );
            })()}

          </div>
        )}

        {/* ── TAB: DESPESAS ───────────────────────────────────────────────────── */}
        {tab === 'despesas' && (
          <div>
            <div className="flex flex-wrap gap-3 mb-5">
              <select value={expCatFilter} onChange={e => setExpCatFilter(e.target.value)}
                className="px-3 py-2.5 bg-white border border-[#141414]/10 rounded-xl text-sm focus:outline-none appearance-none cursor-pointer flex-1">
                <option value="">Todas as categorias</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
              <button onClick={openAddExp} className="flex items-center gap-2 px-4 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80 transition-opacity">
                <Plus size={15} /> Nova Despesa
              </button>
            </div>

            <div className="bg-white rounded-xl border border-[#141414]/10 shadow-sm overflow-hidden">
              {filteredExps.length === 0 ? (
                <div className="p-12 text-center opacity-40">
                  <Receipt size={32} className="mx-auto mb-3" />
                  <p className="text-sm">Nenhuma despesa cadastrada.</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#F5F5F3] border-b border-[#141414]/10">
                    <tr>
                      {['Despesa', 'Categoria', 'Valor', 'Vencimento', 'Recorrência', 'Status', ''].map(h => (
                        <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase opacity-40">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExps.map(e => (
                      <tr key={e.id} className={`border-b border-[#14141408] hover:bg-[#F5F5F3]/50 transition-colors ${e.paid ? 'opacity-50' : ''}`}>
                        <td className="px-4 py-3 font-semibold">{e.name}</td>
                        <td className="px-4 py-3"><span className="text-[11px] font-bold uppercase bg-[#141414]/5 px-2 py-0.5 rounded-full">{e.category}</span></td>
                        <td className="px-4 py-3 font-mono font-bold text-amber-700">{fmt(e.amount)}</td>
                        <td className="px-4 py-3 text-[#141414]/60">{e.due_date ? new Date(e.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</td>
                        <td className="px-4 py-3 capitalize text-[#141414]/60">{e.recurrence}</td>
                        <td className="px-4 py-3">
                          <button onClick={() => togglePaid(e)}
                            className={`flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-0.5 rounded-full transition-colors ${e.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {e.paid ? <><Check size={10} /> Pago</> : <><AlertCircle size={10} /> Pendente</>}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => openEditExp(e)} className="p-1.5 rounded-lg hover:bg-[#141414]/5 transition-colors"><Edit2 size={14} /></button>
                            <button onClick={() => deleteExpense(e.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 transition-colors"><Trash2 size={14} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-[#F5F5F3] border-t border-[#141414]/10">
                    <tr>
                      <td colSpan={2} className="px-4 py-3 text-xs font-bold uppercase opacity-40">Total pendente</td>
                      <td className="px-4 py-3 font-mono font-bold text-amber-700">{fmt(totalExpenses)}</td>
                      <td colSpan={4} />
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ── Modal: Colaborador ─────────────────────────────────────────────────── */}
      {empModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif italic text-xl font-bold">{empEditing ? 'Editar Colaborador' : 'Novo Colaborador'}</h3>
              <button onClick={() => setEmpModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Nome completo *</label>
                  <input value={empForm.name} onChange={e => setEmpForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">CPF</label>
                  <input value={empForm.cpf} onChange={e => setEmpForm(p => ({ ...p, cpf: e.target.value }))} placeholder="000.000.000-00" className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Cargo</label>
                  <select value={empForm.role} onChange={e => setEmpForm(p => ({ ...p, role: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20 appearance-none bg-white">
                    <option value="">Selecione...</option>
                    {config.roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Departamento</label>
                  <select value={empForm.department} onChange={e => setEmpForm(p => ({ ...p, department: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    {config.departments.map(d => <option key={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Regime</label>
                  <select
                    value={empForm.contract_type}
                    onChange={e => {
                      const ct = e.target.value as any;
                      setEmpForm(p => ({
                        ...p,
                        contract_type: ct,
                        payment_type: ct === 'diaria' ? 'daily' : p.payment_type,
                      }));
                    }}
                    className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    {CONTRACT_TYPES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="border-t border-[#141414]/5 pt-3">
                <label className="text-xs font-bold uppercase opacity-40 block mb-2">Tipo de Pagamento</label>
                <div className="flex gap-2">
                  {[{ v: 'monthly', l: 'Salário Mensal' }, { v: 'daily', l: 'Por Diária' }].map(({ v, l }) => (
                    <button key={v} type="button" onClick={() => setEmpForm(p => ({ ...p, payment_type: v as any }))}
                      className={`flex-1 py-2 rounded-xl border text-sm font-semibold transition-all ${empForm.payment_type === v ? 'bg-[#141414] text-white border-[#141414]' : 'border-[#141414]/10 text-[#141414]/50 hover:border-[#141414]/30'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {empForm.payment_type === 'monthly' ? (
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Salário Mensal (R$)</label>
                  <input type="number" min={0} value={empForm.monthly_salary} onChange={e => setEmpForm(p => ({ ...p, monthly_salary: Number(e.target.value) }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Valor da Diária (R$)</label>
                  <input type="number" min={0} value={empForm.daily_rate} onChange={e => setEmpForm(p => ({ ...p, daily_rate: Number(e.target.value) }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
              )}

              {(() => {
                let previewGross = empForm.monthly_salary || 0;
                let daysInfo = '';
                if (empForm.payment_type === 'daily') {
                  const daysOff = new Set<number>();
                  if (empFormRestDay >= 0) daysOff.add(empFormRestDay);
                  if (discFechadoDow >= 0 && !daysOff.has(discFechadoDow)) daysOff.add(discFechadoDow);
                  const days = 7 - daysOff.size;
                  previewGross = (empForm.daily_rate || 0) * days;
                  daysInfo = `${days}d × ${fmt(empForm.daily_rate || 0)}`;
                }
                return (
                  <div className="bg-[#F5F5F3] rounded-xl px-4 py-3 flex justify-between items-center text-sm font-bold">
                    <div>
                      <span className="opacity-50">Valor a Receber</span>
                      {daysInfo && <span className="block text-[10px] font-normal opacity-40 mt-0.5">{daysInfo}/ciclo</span>}
                    </div>
                    <span className="text-green-700 text-base">{fmt(previewGross)}</span>
                  </div>
                );
              })()}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Status</label>
                  <select value={empForm.status} onChange={e => setEmpForm(p => ({ ...p, status: e.target.value as any }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    <option value="ativo">Ativo</option>
                    <option value="afastado">Afastado</option>
                    <option value="inativo">Inativo</option>
                    <option value="pago">Pago</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Dia de folga</label>
                  <select value={empFormRestDay} onChange={e => setEmpFormRestDay(Number(e.target.value))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    <option value={-1}>Nenhum</option>
                    {DAY_ABBR.map((name, dow) => <option key={dow} value={dow}>{name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Observações</label>
                  <input value={empForm.observations} onChange={e => setEmpForm(p => ({ ...p, observations: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none" />
                </div>
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setEmpModal(false)} className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">Cancelar</button>
              <button onClick={saveEmployee} disabled={empSaving} className="flex-1 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80 disabled:opacity-50">
                {empSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Ciclo Atual (botão $) ────────────────────────────────────── */}
      {cycleModal && cycleEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setCycleModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <div>
                <h3 className="font-serif italic text-xl font-bold">Ciclo Atual</h3>
                <p className="text-xs text-[#141414]/50 mt-0.5">{cycleEmployee.name}</p>
              </div>
              <button onClick={() => setCycleModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {cycleEmployee.status === 'pago' && cycleEmployee.discounts === 0 && cycleEmployee.additions === 0 && !cycleEmployee.observations ? (
                <div className="flex flex-col items-center justify-center py-10 text-[#141414]/30">
                  <DollarSign size={28} className="mb-2" />
                  <p className="text-sm font-semibold">Ciclo zerado</p>
                  <p className="text-xs mt-1">Aguardando movimentações do próximo ciclo.</p>
                </div>
              ) : (() => {
                const { discounts: discItems, additions: addItems, others: otherItems } = parseObservations(cycleEmployee.observations);
                return (
                  <div className="space-y-3 text-sm">
                    {/* Bruto */}
                    <div className="flex justify-between font-semibold text-[#141414]/70">
                      <span>Salário Bruto</span>
                      <span className="font-mono">{fmt(empCalcGross(cycleEmployee))}</span>
                    </div>

                    {/* Descontos */}
                    {(cycleEmployee.discounts > 0 || discItems.length > 0) && (
                      <div className="border-t border-[#141414]/5 pt-3">
                        <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Descontos</p>
                        {discItems.length > 0 ? (
                          <div className="space-y-1.5">
                            {discItems.map((d, i) => (
                              <div key={i} className="flex items-start gap-2 pl-2 border-l-2 border-red-300">
                                <p className="text-[12px] text-red-600 font-medium leading-snug">{d}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex justify-between font-bold text-red-600 mt-2">
                          <span>(-) Total descontos</span>
                          <span className="font-mono">- {fmt(cycleEmployee.discounts)}</span>
                        </div>
                      </div>
                    )}

                    {/* Acréscimos */}
                    {(cycleEmployee.additions > 0 || addItems.length > 0) && (
                      <div className="border-t border-[#141414]/5 pt-3">
                        <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Acréscimos</p>
                        {addItems.length > 0 ? (
                          <div className="space-y-1.5">
                            {addItems.map((a, i) => (
                              <div key={i} className="flex items-start gap-2 pl-2 border-l-2 border-emerald-300">
                                <p className="text-[12px] text-emerald-600 font-medium leading-snug">{a}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        <div className="flex justify-between font-bold text-emerald-600 mt-2">
                          <span>(+) Total acréscimos</span>
                          <span className="font-mono">+ {fmt(cycleEmployee.additions)}</span>
                        </div>
                      </div>
                    )}

                    {/* Outros */}
                    {otherItems.length > 0 && (
                      <div className="border-t border-[#141414]/5 pt-3">
                        <p className="text-[10px] font-bold uppercase opacity-40 mb-2">Observações</p>
                        <div className="space-y-1">
                          {otherItems.map((o, i) => (
                            <p key={i} className="text-[11px] text-[#141414]/50 italic">{o}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Líquido projetado */}
                    <div className="flex justify-between font-bold border-t border-[#141414]/10 pt-3 text-base">
                      <span>Líquido projetado</span>
                      <span className="text-green-700 font-mono">{fmt(empCalcNet(cycleEmployee))}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-[#141414]/10">
              <button onClick={() => setCycleModal(false)}
                className="w-full py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Histórico de Pagamentos (botão History) ───────────────────── */}
      {payModal && payEmployee && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setPayModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <div>
                <h3 className="font-serif italic text-xl font-bold">Registros de Pagamentos</h3>
                <p className="text-xs text-[#141414]/50 mt-0.5">{payEmployee.name}</p>
              </div>
              <button onClick={() => setPayModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {(() => {
                const empPayments = payments.filter((p: Payment) => p.employee_id === payEmployee.id);
                if (empPayments.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-12 text-[#141414]/30">
                      <DollarSign size={32} className="mb-3" />
                      <p className="text-sm">Nenhum pagamento registrado.</p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-3">
                    {empPayments.map((p: Payment) => {
                      const { discounts: discItems, additions: addItems, others: otherItems } = parseObservations(p.notes);
                      return (
                        <div key={p.id} className="bg-[#F5F5F3] rounded-xl p-4 space-y-2 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{p.period}</span>
                            <span className="text-[11px] text-[#141414]/40">{new Date(p.paid_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                          <div className="flex justify-between text-[#141414]/60">
                            <span>Bruto</span>
                            <span className="font-mono">{fmt(p.amount_gross)}</span>
                          </div>
                          {p.discounts > 0 && (
                            <div className="border-t border-[#141414]/5 pt-2">
                              {discItems.length > 0 && (
                                <div className="mb-1 pl-2 border-l-2 border-red-300 space-y-0.5">
                                  {discItems.map((d, i) => <p key={i} className="text-[11px] text-red-600 font-medium">{d}</p>)}
                                </div>
                              )}
                              <div className="flex justify-between font-bold text-red-600">
                                <span>(-) Descontos</span>
                                <span className="font-mono">- {fmt(p.discounts)}</span>
                              </div>
                            </div>
                          )}
                          {p.additions > 0 && (
                            <div className="border-t border-[#141414]/5 pt-2">
                              {addItems.length > 0 && (
                                <div className="mb-1 pl-2 border-l-2 border-emerald-300 space-y-0.5">
                                  {addItems.map((a, i) => <p key={i} className="text-[11px] text-emerald-600 font-medium">{a}</p>)}
                                </div>
                              )}
                              <div className="flex justify-between font-bold text-emerald-600">
                                <span>(+) Acréscimos</span>
                                <span className="font-mono">+ {fmt(p.additions)}</span>
                              </div>
                            </div>
                          )}
                          <div className="flex justify-between font-bold border-t border-[#141414]/10 pt-2">
                            <span>Líquido pago</span>
                            <span className="text-green-700 font-mono">{fmt(p.amount_net)}</span>
                          </div>
                          {otherItems.length > 0 && (
                            <div className="pt-1 space-y-0.5">
                              {otherItems.map((o, i) => <p key={i} className="text-[11px] text-[#141414]/50 italic">{o}</p>)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            <div className="px-5 py-4 border-t border-[#141414]/10">
              <button onClick={() => setPayModal(false)}
                className="w-full py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Despesa ─────────────────────────────────────────────────────── */}
      {expModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-serif italic text-xl font-bold">{expEditing ? 'Editar Despesa' : 'Nova Despesa'}</h3>
              <button onClick={() => setExpModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold uppercase opacity-40 block mb-1">Nome *</label>
                <input value={expForm.name} onChange={e => setExpForm(p => ({ ...p, name: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Categoria</label>
                  <select value={expForm.category} onChange={e => setExpForm(p => ({ ...p, category: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    {EXPENSE_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Valor (R$)</label>
                  <input type="number" min={0} value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: Number(e.target.value) }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Vencimento</label>
                  <input type="date" value={expForm.due_date} onChange={e => setExpForm(p => ({ ...p, due_date: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none" />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Recorrência</label>
                  <select value={expForm.recurrence} onChange={e => setExpForm(p => ({ ...p, recurrence: e.target.value as any }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    <option value="mensal">Mensal</option>
                    <option value="semanal">Semanal</option>
                    <option value="anual">Anual</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase opacity-40 block mb-1">Forma de Pgto</label>
                  <select value={expForm.payment_method} onChange={e => setExpForm(p => ({ ...p, payment_method: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none appearance-none">
                    {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex items-end pb-1">
                  <button type="button" onClick={() => setExpForm(p => ({ ...p, paid: !p.paid }))}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-semibold transition-all w-full justify-center ${expForm.paid ? 'bg-green-600 text-white border-green-600' : 'border-[#141414]/10 text-[#141414]/50'}`}>
                    {expForm.paid ? <><Check size={14} /> Pago</> : 'Marcar como pago'}
                  </button>
                </div>
              </div>
              <div>
                <label className="text-xs font-bold uppercase opacity-40 block mb-1">Observações</label>
                <input value={expForm.observations} onChange={e => setExpForm(p => ({ ...p, observations: e.target.value }))} className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setExpModal(false)} className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60">Cancelar</button>
              <button onClick={saveExpense} disabled={expSaving} className="flex-1 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80 disabled:opacity-50">
                {expSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Configurações ─────────────────────────────────────────────── */}
      {cfgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setCfgModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">

            <div className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <div className="flex items-center gap-2">
                <Settings size={18} />
                <h3 className="font-serif italic text-xl font-bold">Configurações</h3>
              </div>
              <button onClick={() => setCfgModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="flex border-b border-[#141414]/10">
              {([
                { id: 'departments', label: 'Departamentos' },
                { id: 'sectors',     label: 'Setores' },
                { id: 'roles',       label: 'Cargos' },
              ] as const).map(({ id, label }) => (
                <button key={id} onClick={() => setCfgTab(id)}
                  className={`flex-1 py-3 text-sm font-bold transition-all border-b-2 -mb-px ${cfgTab === id ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]/70'}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-2">
              {cfgEdit[cfgTab].map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  {cfgTab !== 'roles' && (
                    <div className="relative shrink-0 w-7 h-7 rounded-lg border border-[#141414]/10 overflow-hidden cursor-pointer" style={{ background: item.color }}>
                      <input type="color" value={item.color || '#141414'}
                        onChange={e => updateItem(cfgTab, item.id, { color: e.target.value })}
                        className="absolute inset-0 opacity-0 cursor-pointer w-8 h-8" />
                    </div>
                  )}
                  <input type="text" value={item.name}
                    onChange={e => updateItem(cfgTab, item.id, { name: e.target.value })}
                    placeholder="Nome..."
                    className="flex-1 border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  <button onClick={() => removeItem(cfgTab, item.id)}
                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors shrink-0">
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}

              {cfgTab !== 'roles' && cfgEdit[cfgTab].length > 0 && (
                <div className="pt-2">
                  <p className="text-[10px] uppercase font-bold opacity-30 mb-2">Paleta de cores</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {COLOR_PALETTE.map(c => (
                      <div key={c} style={{ background: c }} className="w-5 h-5 rounded-full border-2 border-white shadow-sm" title={c} />
                    ))}
                    <p className="text-[10px] opacity-30 self-center ml-1">Clique no quadrado colorido para escolher</p>
                  </div>
                </div>
              )}

              <button onClick={() => addItem(cfgTab)}
                className="w-full mt-1 py-2.5 border border-dashed border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/50 hover:border-[#141414]/40 hover:text-[#141414]/70 transition-colors flex items-center justify-center gap-1">
                <Plus size={13} /> Adicionar
              </button>
            </div>

            <div className="flex gap-3 px-5 py-4 border-t border-[#141414]/10">
              <button onClick={() => setCfgModal(false)}
                className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={saveConfig}
                className="flex-1 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-80">
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Aplicar Descontos ─────────────────────────────────────────── */}
      {discModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Header fixo */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <h3 className="font-serif italic text-xl font-bold">Aplicar Descontos</h3>
              <button onClick={() => setDiscModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            {/* Conteúdo: topo fixo + lista scrollável */}
            <div className="flex-1 flex flex-col px-6 pt-3 min-h-0">

              {/* ── Topo fixo (não scrolla) ── */}
              <div className="flex-shrink-0 space-y-2 pb-3">

                {/* Ciclo Semanal */}
                {(() => {
                  const cycleDays = getCycleDays(discCycleStartDay);
                  const absentCount = discDaysChecked.filter((c, i) => {
                    if (c) return false;
                    const dow = cycleDays[i].getDay();
                    return !((discFolgaDow >= 0 && dow === discFolgaDow) || (discFechadoDow >= 0 && dow === discFechadoDow));
                  }).length;

                  // Indicadores individuais apenas quando 1 colaborador selecionado
                  const singleSelected = discSelectedIds.length === 1;

                  const selectedFolgaDows = singleSelected
                    ? new Set<number>(
                        discSelectedIds
                          .map(id => empRestDays[id])
                          .filter((d): d is number => d !== undefined && d >= 0)
                      )
                    : new Set<number>();

                  const recordedFaltaByIndex = new Map<number, number>();
                  if (singleSelected) {
                    discSelectedIds.forEach(id => {
                      const emp = employees.find(e => e.id === id);
                      if (!emp) return;
                      getRecordedFaltaIndices(emp.observations, cycleDays).forEach(i => {
                        recordedFaltaByIndex.set(i, (recordedFaltaByIndex.get(i) || 0) + 1);
                      });
                    });
                  }

                  return (
                    <div>
                      <div className="flex items-center gap-1">
                        {cycleDays.map((date, i) => {
                          const dow = date.getDay();
                          const isFolga = discFolgaDow >= 0 && dow === discFolgaDow;
                          const isFechado = discFechadoDow >= 0 && dow === discFechadoDow;
                          const isAutoOff = isFolga || isFechado;
                          const isAbsent = !discDaysChecked[i] && !isAutoOff;
                          // Folga individual de algum colaborador selecionado
                          const isPersonalFolga = !isAutoOff && selectedFolgaDows.has(dow);
                          // Quantos colaboradores selecionados têm folga neste dia
                          const folgaCount = isPersonalFolga
                            ? discSelectedIds.filter(id => empRestDays[id] === dow).length
                            : 0;
                          // Faltas já gravadas para este dia
                          const recordedCount = recordedFaltaByIndex.get(i) || 0;

                          return (
                            <button key={i} type="button"
                              onClick={() => { if (isAutoOff) return; setDiscDaysChecked(prev => { const n = [...prev]; n[i] = !n[i]; return n; }); }}
                              title={
                                isFechado ? 'Pizzaria fechada'
                                : isFolga ? 'Dia de folga'
                                : isPersonalFolga
                                  ? `Folga de ${folgaCount} colaborador${folgaCount > 1 ? 'es' : ''} selecionado${folgaCount > 1 ? 's' : ''}`
                                  : discDaysChecked[i] ? 'Marcar falta' : 'Remover falta'
                              }
                              className={`flex-1 flex flex-col items-center py-1 px-0.5 rounded-lg border text-[10px] font-bold transition-all select-none
                                ${isFechado ? 'bg-purple-50 border-purple-200 text-purple-400 cursor-default'
                                : isFolga ? 'bg-[#F5F5F3] border-[#141414]/10 text-[#141414]/30 cursor-default'
                                : isAbsent ? 'bg-red-50 border-red-300 text-red-600 cursor-pointer'
                                : isPersonalFolga ? 'bg-amber-50 border-amber-300 text-amber-600 cursor-pointer'
                                : 'bg-white border-[#141414]/15 text-[#141414]/70 hover:border-[#141414]/30 cursor-pointer'}`}>
                              <span className="uppercase">{DAY_ABBR[dow]}</span>
                              <span className="text-[9px] opacity-50">{String(date.getDate()).padStart(2,'0')}/{String(date.getMonth()+1).padStart(2,'0')}</span>
                              <span className={`mt-0.5 w-3 h-3 rounded-sm border flex items-center justify-center
                                ${isFechado ? 'border-purple-300 bg-purple-100'
                                : isFolga ? 'border-[#141414]/10 bg-[#141414]/5'
                                : isAbsent ? 'border-red-400 bg-red-100'
                                : isPersonalFolga ? 'border-amber-300 bg-amber-100'
                                : 'border-[#141414]/25 bg-white'}`}>
                                {!isAutoOff && !isPersonalFolga && discDaysChecked[i] && <Check size={7} className="text-green-600" strokeWidth={3} />}
                                {isAbsent && <X size={7} className="text-red-500" strokeWidth={3} />}
                              </span>
                              <span className="text-[8px] leading-none mt-0.5 opacity-50">
                                {isFechado ? 'fech.' : isFolga ? 'folga' : isPersonalFolga ? `f.${folgaCount}` : ''}
                              </span>
                              {recordedCount > 0 && !isAutoOff && (
                                <span className="text-[7px] font-bold leading-none mt-0.5 bg-orange-100 text-orange-500 rounded px-0.5">
                                  {recordedCount}✗
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      {absentCount > 0 && (
                        <p className="text-[11px] text-red-600 font-semibold mt-1.5">
                          {absentCount} falta{absentCount > 1 ? 's' : ''} — desconto por diária de cada colaborador
                        </p>
                      )}
                    </div>
                  );
                })()}

                {/* Inputs compactos — numa linha */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Valor (R$)</label>
                    <input type="number" min={0} value={discAmount || ''} onChange={e => setDiscAmount(Number(e.target.value))} placeholder="0,00" className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Motivo</label>
                    <input type="text" value={discReason} onChange={e => setDiscReason(e.target.value)} placeholder="Atraso, Quebra..." className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Data</label>
                    <input type="date" value={discDate} onChange={e => setDiscDate(e.target.value)} className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                </div>

              </div>{/* fim topo fixo */}

              {/* ── Área de busca + lista (fundo destacado) ── */}
              <div className="flex-1 flex flex-col min-h-0 bg-[#F5F5F3] rounded-xl p-2.5 gap-2 mb-3">

                {/* Filtros numa linha */}
                <div className="grid grid-cols-4 gap-1.5">
                  <input type="text" value={discSearch} onChange={e => setDiscSearch(e.target.value)} placeholder="Buscar nome..." className="border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none" />
                  <select value={discDept} onChange={e => { const v = e.target.value; setDiscDept(v); if (v) { setDiscRole(''); setDiscSector(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Departamento</option>
                    {config.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                  <select value={discRole} onChange={e => { const v = e.target.value; setDiscRole(v); if (v) { setDiscDept(''); setDiscSector(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Cargo</option>
                    {config.roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <select value={discSector} onChange={e => { const v = e.target.value; setDiscSector(v); if (v) { setDiscDept(''); setDiscRole(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Setor</option>
                    {config.sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>

                {/* Lista scrollável */}
                <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-[#141414]/8">
                <div className="flex justify-between items-center px-3 py-2 border-b border-[#141414]/5 sticky top-0 bg-white z-10">
                  <span className="text-xs font-bold opacity-45">Filtrados ({
                    employees.filter(e => {
                      const matchQ = !discSearch || e.name.toLowerCase().includes(discSearch.toLowerCase());
                      const matchDept = !discDept || e.department === discDept;
                      const matchRole = !discRole || e.role === discRole;
                      const matchSector = !discSector || e.observations.toLowerCase().includes(discSector.toLowerCase());
                      return matchQ && matchDept && matchRole && matchSector;
                    }).length
                  })</span>
                  <div className="flex gap-2">
                    <button onClick={() => setDiscSelectedIds(employees.filter(e => {
                      return (!discSearch || e.name.toLowerCase().includes(discSearch.toLowerCase()))
                        && (!discDept || e.department === discDept)
                        && (!discRole || e.role === discRole)
                        && (!discSector || e.observations.toLowerCase().includes(discSector.toLowerCase()));
                    }).map(f => f.id))} className="text-[10px] font-bold text-[#141414]/60 hover:text-[#141414]">Sel. todos</button>
                    <button onClick={() => setDiscSelectedIds([])} className="text-[10px] font-bold text-red-500/70 hover:text-red-500">Limpar</button>
                  </div>
                </div>
                <div className="p-2 space-y-1">
                  {employees.filter(e => {
                    const matchQ = !discSearch || e.name.toLowerCase().includes(discSearch.toLowerCase());
                    const matchDept = !discDept || e.department === discDept;
                    const matchRole = !discRole || e.role === discRole;
                    const matchSector = !discSector || e.observations.toLowerCase().includes(discSector.toLowerCase());
                    return matchQ && matchDept && matchRole && matchSector;
                  }).map(emp => {
                    const isSelected = discSelectedIds.includes(emp.id);
                    const empFolga = empRestDays[emp.id];
                    return (
                      <div key={emp.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 border border-[#141414]/5 cursor-pointer"
                        onClick={() => setDiscSelectedIds(prev => isSelected ? prev.filter(id => id !== emp.id) : [...prev, emp.id])}>
                        <div>
                          <p className="text-sm font-semibold text-[#141414]">{emp.name}</p>
                          <p className="text-[10px] opacity-40">
                            {emp.role} · {emp.department}
                            {empFolga !== undefined && <span className="ml-1">· folga: {DAY_ABBR[empFolga]}</span>}
                          </p>
                        </div>
                        <input type="checkbox" checked={isSelected} onChange={() => {}} className="w-4 h-4 text-[#141414] border-gray-300 rounded focus:ring-[#141414]" />
                      </div>
                    );
                  })}
                </div>
              </div>{/* fim lista branca */}
              </div>{/* fim área destaque */}

            </div>{/* fim conteúdo */}

            {/* Footer fixo — botões sempre visíveis */}
            <div className="flex-shrink-0 flex gap-2 px-6 py-4 border-t border-[#141414]/10">
              <button onClick={() => setDiscModal(false)} className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">Cancelar</button>
              <button
                onClick={applyDiscounts}
                disabled={discSaving || discSelectedIds.length === 0}
                className="flex-1 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-85 disabled:opacity-40 transition-opacity">
                {discSaving ? 'Aplicando...' : `Confirmar (${discSelectedIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Aplicar Vales ─────────────────────────────────────────────── */}
      {valeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

            {/* Header fixo */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <h3 className="font-serif italic text-xl font-bold">Aplicar Vales</h3>
              <button onClick={() => setValeModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            {/* Conteúdo: topo fixo + lista scrollável */}
            <div className="flex-1 flex flex-col px-6 pt-3 min-h-0">

              {/* Topo fixo */}
              <div className="flex-shrink-0 space-y-2 pb-3">

                {/* Inputs compactos numa linha */}
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Valor (R$)</label>
                    <input type="number" min={0} value={valeAmount || ''} onChange={e => setValeAmount(Number(e.target.value))} placeholder="0,00" className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Motivo</label>
                    <input type="text" value={valeReason} onChange={e => setValeReason(e.target.value)} placeholder="Adiantamento, Refeição..." className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold uppercase opacity-40 block mb-0.5">Data</label>
                    <input type="date" value={valeDate} onChange={e => setValeDate(e.target.value)} className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                  </div>
                </div>

              </div>{/* fim topo fixo */}

              {/* ── Área de busca + lista (fundo destacado) ── */}
              <div className="flex-1 flex flex-col min-h-0 bg-[#F5F5F3] rounded-xl p-2.5 gap-2 mb-3">

                {/* Filtros numa linha */}
                <div className="grid grid-cols-4 gap-1.5">
                  <input type="text" value={valeSearch} onChange={e => setValeSearch(e.target.value)} placeholder="Buscar nome..." className="border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none" />
                  <select value={valeDept} onChange={e => { const v = e.target.value; setValeDept(v); if (v) { setValeRole(''); setValeSector(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Departamento</option>
                    {config.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                  </select>
                  <select value={valeRole} onChange={e => { const v = e.target.value; setValeRole(v); if (v) { setValeDept(''); setValeSector(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Cargo</option>
                    {config.roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <select value={valeSector} onChange={e => { const v = e.target.value; setValeSector(v); if (v) { setValeDept(''); setValeRole(''); } }} className="border border-[#141414]/10 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none appearance-none">
                    <option value="">Setor</option>
                    {config.sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                  </select>
                </div>

                {/* Lista scrollável */}
                <div className="flex-1 overflow-y-auto bg-white rounded-lg border border-[#141414]/8">
                <div className="flex justify-between items-center px-3 py-2 border-b border-[#141414]/5 sticky top-0 bg-white z-10">
                  <span className="text-xs font-bold opacity-45">Filtrados ({
                    employees.filter(e => {
                      const matchQ = !valeSearch || e.name.toLowerCase().includes(valeSearch.toLowerCase());
                      const matchDept = !valeDept || e.department === valeDept;
                      const matchRole = !valeRole || e.role === valeRole;
                      const matchSector = !valeSector || e.observations.toLowerCase().includes(valeSector.toLowerCase());
                      return matchQ && matchDept && matchRole && matchSector;
                    }).length
                  })</span>
                  <div className="flex gap-2">
                    <button onClick={() => setValeSelectedIds(employees.filter(e =>
                      (!valeSearch || e.name.toLowerCase().includes(valeSearch.toLowerCase()))
                      && (!valeDept || e.department === valeDept)
                      && (!valeRole || e.role === valeRole)
                      && (!valeSector || e.observations.toLowerCase().includes(valeSector.toLowerCase()))
                    ).map(f => f.id))} className="text-[10px] font-bold text-[#141414]/60 hover:text-[#141414]">Sel. todos</button>
                    <button onClick={() => setValeSelectedIds([])} className="text-[10px] font-bold text-red-500/70 hover:text-red-500">Limpar</button>
                  </div>
                </div>
                <div className="p-2 space-y-1">
                  {employees.filter(e => {
                    const matchQ = !valeSearch || e.name.toLowerCase().includes(valeSearch.toLowerCase());
                    const matchDept = !valeDept || e.department === valeDept;
                    const matchRole = !valeRole || e.role === valeRole;
                    const matchSector = !valeSector || e.observations.toLowerCase().includes(valeSector.toLowerCase());
                    return matchQ && matchDept && matchRole && matchSector;
                  }).map(emp => {
                    const isSelected = valeSelectedIds.includes(emp.id);
                    const empFolga = empRestDays[emp.id];
                    return (
                      <div key={emp.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-gray-50 border border-[#141414]/5 cursor-pointer"
                        onClick={() => setValeSelectedIds(prev => isSelected ? prev.filter(id => id !== emp.id) : [...prev, emp.id])}>
                        <div>
                          <p className="text-sm font-semibold text-[#141414]">{emp.name}</p>
                          <p className="text-[10px] opacity-40">
                            {emp.role} · {emp.department}
                            {empFolga !== undefined && <span className="ml-1">· folga: {DAY_ABBR[empFolga]}</span>}
                          </p>
                        </div>
                        <input type="checkbox" checked={isSelected} onChange={() => {}} className="w-4 h-4 text-[#141414] border-gray-300 rounded focus:ring-[#141414]" />
                      </div>
                    );
                  })}
                </div>
              </div>{/* fim lista branca */}
              </div>{/* fim área destaque */}

            </div>{/* fim conteúdo */}

            {/* Footer fixo */}
            <div className="flex-shrink-0 flex gap-2 px-6 py-4 border-t border-[#141414]/10">
              <button onClick={() => setValeModal(false)} className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">Cancelar</button>
              <button onClick={applyVales} disabled={valeSaving || valeSelectedIds.length === 0 || valeAmount <= 0}
                className="flex-1 py-2.5 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-85 disabled:opacity-40 transition-opacity">
                {valeSaving ? 'Aplicando...' : `Confirmar (${valeSelectedIds.length})`}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ── Modal: Tabela de Folgas ─────────────────────────────────────────── */}
      {folgaTableModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setFolgaTableModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex-shrink-0 flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="opacity-60" />
                <h3 className="font-serif italic text-xl font-bold">Tabela de Folgas</h3>
              </div>
              <button onClick={() => setFolgaTableModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            {/* ── Seção do ciclo + botão de configuração ── */}
            <div className="flex-shrink-0 px-6 py-4 border-b border-[#141414]/10">
              <div className="flex items-center gap-2">
                {/* Dias da semana (apenas exibição) */}
                <div className="flex flex-1 gap-1">
                  {getCycleDays(discCycleStartDay).map((date, i) => {
                    const dow = date.getDay();
                    const isFolga = discFolgaDow >= 0 && dow === discFolgaDow;
                    const isFechado = discFechadoDow >= 0 && dow === discFechadoDow;
                    const isEmpFolga = folgaTableSelected !== null &&
                      (empRestDays[folgaTableSelected] ?? -1) === dow;
                    return (
                      <div key={i}
                        className={`flex-1 flex flex-col items-center py-2 rounded-lg border text-[10px] font-bold
                          ${isFechado ? 'bg-purple-50 border-purple-200 text-purple-400'
                          : isFolga   ? 'bg-[#F5F5F3] border-[#141414]/10 text-[#141414]/30'
                          : isEmpFolga ? 'bg-amber-50 border-amber-300 text-amber-600'
                          : 'bg-white border-[#141414]/10 text-[#141414]/60'}`}>
                        <span className="uppercase">{DAY_ABBR[dow]}</span>
                        <span className="text-[9px] opacity-50 mt-0.5">
                          {String(date.getDate()).padStart(2,'0')}/{String(date.getMonth()+1).padStart(2,'0')}
                        </span>
                        <span className="text-[8px] mt-0.5 opacity-50">
                          {isFechado ? 'fech.' : isFolga ? 'folga' : isEmpFolga ? 'folga' : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Botão de configuração */}
                <div className="relative shrink-0 ml-1">
                  <button type="button" onClick={() => setFolgaTableCfgOpen(p => !p)}
                    title="Configurar ciclo"
                    className="p-2 rounded-lg hover:bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414]/70 transition-colors border border-[#141414]/10">
                    <Settings size={15} />
                  </button>
                  {folgaTableCfgOpen && (
                    <div className="absolute right-0 top-10 z-50 bg-white border border-[#141414]/10 rounded-xl shadow-xl w-64">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[#141414]/8">
                        <span className="text-xs font-bold text-[#141414]/70">Configurar ciclo</span>
                        <button type="button" onClick={() => setFolgaTableCfgOpen(false)}
                          className="p-1 hover:bg-gray-100 rounded-full text-[#141414]/40"><X size={12} /></button>
                      </div>
                      <div className="p-3 space-y-4">
                        {/* Início do ciclo */}
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#141414]/40 mb-1.5">Início do ciclo</p>
                          <div className="flex gap-1 flex-wrap">
                            {DAY_ABBR.map((name, dow) => (
                              <button key={dow} type="button"
                                onClick={() => { setDiscCycleStartDay(dow); localStorage.setItem(`disc_cycle_start_${tenantId}`, String(dow)); setDiscDaysChecked(getCycleDays(dow).map(d => { const d2 = d.getDay(); return (discFolgaDow < 0 || d2 !== discFolgaDow) && (discFechadoDow < 0 || d2 !== discFechadoDow); })); }}
                                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${discCycleStartDay === dow ? 'bg-[#141414] text-white' : 'bg-[#F5F5F3] text-[#141414]/60 hover:bg-[#141414]/10'}`}>
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Folga global */}
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#141414]/40 mb-1.5">Dia de folga</p>
                          <div className="flex gap-1 flex-wrap">
                            <button type="button" onClick={() => { setDiscFolgaDow(-1); localStorage.setItem(`disc_folga_dow_${tenantId}`, '-1'); setDiscDaysChecked(getCycleDays(discCycleStartDay).map(d => discFechadoDow < 0 || d.getDay() !== discFechadoDow)); }}
                              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${discFolgaDow === -1 ? 'bg-[#141414]/80 text-white' : 'bg-[#F5F5F3] text-[#141414]/60 hover:bg-[#141414]/10'}`}>Nenhum</button>
                            {DAY_ABBR.map((name, dow) => (
                              <button key={dow} type="button" onClick={() => { setDiscFolgaDow(dow); localStorage.setItem(`disc_folga_dow_${tenantId}`, String(dow)); setDiscDaysChecked(getCycleDays(discCycleStartDay).map(d => { const d2 = d.getDay(); return d2 !== dow && (discFechadoDow < 0 || d2 !== discFechadoDow); })); }}
                                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${discFolgaDow === dow ? 'bg-[#141414]/80 text-white' : 'bg-[#F5F5F3] text-[#141414]/60 hover:bg-[#141414]/10'}`}>
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                        {/* Pizzaria fechada */}
                        <div>
                          <p className="text-[10px] font-bold uppercase text-[#141414]/40 mb-1.5">
                            Pizzaria fechada <span className="normal-case font-normal opacity-60">(auto-desmarca)</span>
                          </p>
                          <div className="flex gap-1 flex-wrap">
                            <button type="button" onClick={() => { setDiscFechadoDow(-1); localStorage.setItem(`disc_fechado_dow_${tenantId}`, '-1'); setDiscDaysChecked(getCycleDays(discCycleStartDay).map(d => discFolgaDow < 0 || d.getDay() !== discFolgaDow)); }}
                              className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${discFechadoDow === -1 ? 'bg-purple-600 text-white' : 'bg-[#F5F5F3] text-[#141414]/60 hover:bg-[#141414]/10'}`}>Nenhum</button>
                            {DAY_ABBR.map((name, dow) => (
                              <button key={dow} type="button" onClick={() => { setDiscFechadoDow(dow); localStorage.setItem(`disc_fechado_dow_${tenantId}`, String(dow)); setDiscDaysChecked(getCycleDays(discCycleStartDay).map(d => { const d2 = d.getDay(); return (discFolgaDow < 0 || d2 !== discFolgaDow) && d2 !== dow; })); }}
                                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${discFechadoDow === dow ? 'bg-purple-500 text-white' : 'bg-[#F5F5F3] text-[#141414]/60 hover:bg-[#141414]/10'}`}>
                                {name}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {folgaTableSelected && (() => {
                const sel = employees.find(e => e.id === folgaTableSelected);
                const dow = sel ? empRestDays[sel.id] : undefined;
                return sel ? (
                  <p className="text-[11px] text-amber-600 font-semibold mt-2">
                    {sel.name} — folga: {dow !== undefined && dow >= 0 ? DAY_ABBR[dow] : 'não definida'}
                  </p>
                ) : null;
              })()}
            </div>

            {/* Lista de colaboradores */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-[#F5F5F3] border-b border-[#141414]/10 sticky top-0">
                  <tr>
                    {['Nome', 'Cargo', 'Dia de Folga'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-[11px] font-bold uppercase opacity-40">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...employees]
                    .sort((a, b) => {
                      const dowA = empRestDays[a.id] ?? 99;
                      const dowB = empRestDays[b.id] ?? 99;
                      if (dowA !== dowB) return dowA - dowB;
                      return a.name.localeCompare(b.name);
                    })
                    .map(emp => {
                      const dow = empRestDays[emp.id];
                      const hasFolga = dow !== undefined && dow >= 0;
                      const isSelected = folgaTableSelected === emp.id;
                      return (
                        <tr key={emp.id}
                          onClick={() => setFolgaTableSelected(isSelected ? null : emp.id)}
                          className={`border-b border-[#14141408] cursor-pointer transition-colors
                            ${isSelected ? 'bg-amber-50' : 'hover:bg-[#F5F5F3]/60'}`}>
                          <td className={`px-4 py-3 font-semibold ${isSelected ? 'text-amber-700' : ''}`}>{emp.name}</td>
                          <td className="px-4 py-3 text-[#141414]/60">{emp.role || '—'}</td>
                          <td className="px-4 py-3">
                            {hasFolga ? (
                              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg
                                ${isSelected ? 'bg-amber-500 text-white' : 'bg-[#141414] text-white'}`}>
                                <Calendar size={10} />
                                {DAY_ABBR[dow as number]}
                              </span>
                            ) : (
                              <span className="text-[11px] text-[#141414]/30 font-medium">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {employees.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-[#141414]/30">
                  <Users size={32} className="mb-3" />
                  <p className="text-sm">Nenhum colaborador cadastrado.</p>
                </div>
              )}
            </div>

            <div className="flex-shrink-0 px-6 py-4 border-t border-[#141414]/10">
              <button onClick={() => { setFolgaTableModal(false); setFolgaTableSelected(null); setFolgaTableCfgOpen(false); }}
                className="w-full py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Pagamento em Lote ────────────────────────────────────────── */}
      {batchPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col p-6">
            <div className="flex items-center justify-between mb-4 pb-2 border-b border-[#141414]/5">
              <h3 className="font-serif italic text-xl font-bold">Registrar Pagamentos</h3>
              <button onClick={() => setBatchPayModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            {/* Data */}
            <div className="mb-4">
              <label className="text-[10px] font-bold uppercase opacity-40 block mb-1">Data do Pagamento</label>
              <input type="date" value={batchPayDate} onChange={e => setBatchPayDate(e.target.value)}
                className="w-full border border-[#141414]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
            </div>

            {/* Filtros */}
            <div className="bg-[#F5F5F3] p-3 rounded-xl mb-4 space-y-2">
              <p className="text-[10px] font-bold uppercase opacity-40">Filtros de Colaboradores</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={batchPaySearch} onChange={e => setBatchPaySearch(e.target.value)}
                  placeholder="Buscar por nome..."
                  className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none" />
                <select value={batchPayDept} onChange={e => { setBatchPayDept(e.target.value); if (e.target.value) { setBatchPayRole(''); setBatchPaySector(''); } }}
                  className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none">
                  <option value="">Todos Departamentos</option>
                  {config.departments.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
                <select value={batchPayRole} onChange={e => { setBatchPayRole(e.target.value); if (e.target.value) { setBatchPayDept(''); setBatchPaySector(''); } }}
                  className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none">
                  <option value="">Todos Cargos</option>
                  {config.roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
                <select value={batchPaySector} onChange={e => { setBatchPaySector(e.target.value); if (e.target.value) { setBatchPayDept(''); setBatchPayRole(''); } }}
                  className="w-full border border-[#141414]/10 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none">
                  <option value="">Todos Setores</option>
                  {config.sectors.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>
            </div>

            {/* Listagem */}
            {(() => {
              const filtered = employees.filter(emp => {
                const matchQ = !batchPaySearch || emp.name.toLowerCase().includes(batchPaySearch.toLowerCase());
                const matchDept = !batchPayDept || emp.department === batchPayDept;
                const matchRole = !batchPayRole || emp.role === batchPayRole;
                const matchSector = !batchPaySector || emp.observations.toLowerCase().includes(batchPaySector.toLowerCase());
                return matchQ && matchDept && matchRole && matchSector;
              });
              const totalSelected = batchPaySelectedIds.reduce((sum, id) => {
                const emp = employees.find(e => e.id === id);
                return sum + (emp ? calcNet(emp) : 0);
              }, 0);
              return (
                <>
                  <div className="flex-1 overflow-y-auto min-h-[150px] border border-[#141414]/5 rounded-xl p-3 mb-4 space-y-2">
                    <div className="flex justify-between items-center pb-2 border-b border-[#141414]/5 mb-2">
                      <span className="text-xs font-bold opacity-45">Filtrados ({filtered.length})</span>
                      <div className="flex gap-2">
                        <button onClick={() => setBatchPaySelectedIds(filtered.map(f => f.id))}
                          className="text-[10px] font-bold text-[#141414]/60 hover:text-[#141414]">Selecionar todos</button>
                        <button onClick={() => setBatchPaySelectedIds([])}
                          className="text-[10px] font-bold text-red-500/70 hover:text-red-500">Limpar</button>
                      </div>
                    </div>
                    {filtered.map(emp => {
                      const isSelected = batchPaySelectedIds.includes(emp.id);
                      return (
                        <div key={emp.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 border border-[#141414]/5 cursor-pointer"
                          onClick={() => setBatchPaySelectedIds(prev => isSelected ? prev.filter(id => id !== emp.id) : [...prev, emp.id])}>
                          <div>
                            <p className="text-sm font-semibold text-[#141414]">{emp.name}</p>
                            <p className="text-[10px] opacity-40">{emp.role} · {emp.department}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-bold text-green-700 font-mono">{fmt(calcNet(emp))}</span>
                            <input type="checkbox" checked={isSelected} onChange={() => {}} className="w-4 h-4 text-[#141414] border-gray-300 rounded focus:ring-[#141414]" />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {batchPaySelectedIds.length > 0 && (
                    <div className="flex justify-between items-center px-1 mb-3 text-sm font-bold">
                      <span className="opacity-50">Total a pagar ({batchPaySelectedIds.length})</span>
                      <span className="text-green-700 font-mono">{fmt(totalSelected)}</span>
                    </div>
                  )}

                  <div className="flex gap-2 pt-2 border-t border-[#141414]/5">
                    <button onClick={() => setBatchPayModal(false)}
                      className="flex-1 py-2.5 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50">
                      Cancelar
                    </button>
                    <button onClick={applyBatchPayments}
                      disabled={batchPaySaving || batchPaySelectedIds.length === 0}
                      className="flex-1 py-2.5 bg-green-600 text-white rounded-xl text-sm font-bold hover:opacity-85 disabled:opacity-40 transition-opacity">
                      {batchPaySaving ? 'Registrando...' : `Confirmar (${batchPaySelectedIds.length})`}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Modal: QR de Presença ─────────────────────────────────────────────── */}
      {attQrModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <h3 className="font-serif italic text-xl font-bold flex items-center gap-2">
                <QrCode size={18} /> QR Code de Presença
              </h3>
              <button onClick={() => setAttQrModal(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="p-6">
              {attLoading ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <Loader2 size={28} className="animate-spin opacity-40" />
                  <p className="text-sm opacity-40">Gerando QR Code...</p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-center opacity-50 mb-1 capitalize">
                    {attDate ? new Date(attDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : ''}
                  </p>
                  <p className="text-xs text-center opacity-40 mb-5">Válido apenas hoje · Um registro por colaborador</p>

                  <div id="att-qr-svg" className="flex justify-center mb-5">
                    <div className="bg-white border-4 border-[#141414] rounded-2xl p-4 shadow-sm">
                      <QRCodeSVG value={attUrl} size={180} fgColor="#141414" bgColor="#ffffff" />
                    </div>
                  </div>

                  <div className="bg-[#F5F5F3] rounded-xl px-3 py-2 mb-5 text-center">
                    <p className="text-[10px] font-mono text-[#141414]/50 break-all">{attUrl}</p>
                  </div>

                  <div className="flex gap-2 mb-5">
                    <button onClick={printAttQr}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[#141414] text-[#E4E3E0] rounded-xl text-xs font-bold hover:opacity-80 transition-opacity">
                      <Printer size={13} /> Imprimir
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(attUrl); toast.success('Link copiado!'); }}
                      className="flex-1 py-2.5 border border-[#141414]/20 text-[#141414] rounded-xl text-xs font-bold hover:bg-gray-50 transition-colors">
                      Copiar Link
                    </button>
                    <button onClick={openAttPanel}
                      className="flex items-center gap-1.5 px-4 py-2.5 border border-[#141414]/15 rounded-xl text-xs font-bold text-[#141414]/70 hover:bg-gray-50 transition-colors">
                      <ClipboardList size={13} />
                      {attRecords.length > 0 && <span className="bg-green-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center">{attRecords.length}</span>}
                    </button>
                  </div>

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-2">
                      Confirmados hoje ({attRecords.length})
                    </p>
                    {attRecords.length === 0 ? (
                      <p className="text-xs opacity-30 text-center py-3">Nenhuma confirmação ainda.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto">
                        {attRecords.map(r => (
                          <div key={r.id} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-xl px-3 py-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 bg-green-200 text-green-800 rounded-full flex items-center justify-center text-[10px] font-bold">
                                {r.employee_name?.[0]}
                              </div>
                              <span className="text-xs font-semibold text-green-800">{r.employee_name}</span>
                            </div>
                            <span className="text-[10px] text-green-600 font-mono">
                              {new Date(r.confirmed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Painel de Presenças ────────────────────────────────────────── */}
      {attPanelOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10">
              <h3 className="font-serif italic text-xl font-bold flex items-center gap-2">
                <ClipboardList size={18} /> Painel de Presenças
              </h3>
              <button onClick={() => setAttPanelOpen(false)} className="p-1.5 hover:bg-gray-100 rounded-full"><X size={16} /></button>
            </div>

            <div className="p-6">
              <div className="flex items-center gap-2 mb-5">
                <input
                  type="date"
                  value={attPanelDate}
                  onChange={e => { setAttPanelDate(e.target.value); loadAttPanel(e.target.value); }}
                  className="flex-1 px-3 py-2 bg-[#F5F5F3] border border-[#141414]/10 rounded-xl text-sm focus:outline-none"
                />
                <button onClick={() => loadAttPanel(attPanelDate)}
                  className="px-4 py-2 bg-[#141414] text-white rounded-xl text-xs font-bold hover:opacity-80 transition-opacity">
                  Atualizar
                </button>
              </div>

              {attPanelLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={24} className="animate-spin opacity-40" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold uppercase tracking-wider opacity-40">
                      {new Date(attPanelDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    </p>
                    <div className="flex gap-2 text-xs">
                      <span className="bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded-full">
                        {attPanelRecords.length} presença{attPanelRecords.length !== 1 ? 's' : ''}
                      </span>
                      {(() => {
                        const absent = employees.filter(e => e.status === 'ativo').length - attPanelRecords.length;
                        return absent > 0 ? (
                          <span className="bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">
                            {absent} falta{absent !== 1 ? 's' : ''}
                          </span>
                        ) : null;
                      })()}
                    </div>
                  </div>

                  {attPanelRecords.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-[#141414]/10 rounded-xl opacity-40">
                      <ClipboardList size={28} className="mx-auto mb-2" />
                      <p className="text-sm">Nenhuma presença registrada nesta data.</p>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto">
                      {attPanelRecords.map(r => (
                        <div key={r.id} className="flex items-center justify-between bg-[#F5F5F3] rounded-xl px-3 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 bg-green-100 text-green-700 rounded-full flex items-center justify-center text-xs font-bold">
                              {r.employee_name?.[0]}
                            </div>
                            <span className="text-sm font-semibold">{r.employee_name}</span>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-mono text-[#141414]/50">
                              {new Date(r.confirmed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </p>
                            <p className="text-[9px] text-green-600 font-bold">✓ Confirmado</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {(() => {
                    const presentIds = new Set(attPanelRecords.map(r => r.employee_id));
                    const absent = employees.filter(e => e.status === 'ativo' && !presentIds.has(e.id));
                    if (absent.length === 0) return null;
                    return (
                      <div className="mt-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider opacity-40 mb-2">Ausentes ({absent.length})</p>
                        <div className="space-y-1.5">
                          {absent.map(e => (
                            <div key={e.id} className="flex items-center gap-2.5 px-3 py-2 bg-red-50 border border-red-100 rounded-xl">
                              <div className="w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                                {e.name[0]}
                              </div>
                              <span className="text-xs font-medium text-red-700">{e.name}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
