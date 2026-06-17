import { useState, useRef, ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOutOwner, updateUserMetadata, updateUserPassword } from '../lib/auth';
import { toast } from 'sonner';
import {
  LogOut, Building, Copy, Check, ExternalLink, LayoutDashboard,
  Store, ImagePlus, X, KeyRound, Eye, EyeOff, Zap, Star, Shield,
  Phone, Mail, MapPin, User, FileText, Edit2, DollarSign
} from 'lucide-react';

interface UserPanelProps { ownerUser: any; }

const BUSINESS_TYPES = ['Bar', 'Restaurante', 'Pizzaria', 'Lanchonete', 'Outros'];
const PLANS = [
  { id: 'free',      label: 'Free',      desc: 'Gratuito',  icon: Zap },
  { id: 'essencial', label: 'Essencial', desc: 'R$ 49/mês', icon: Star },
  { id: 'premium',   label: 'Premium',   desc: 'R$ 99/mês', icon: Shield },
];

export default function UserPanel({ ownerUser }: UserPanelProps) {
  const navigate = useNavigate();
  const [copiedId, setCopiedId]     = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const meta = ownerUser?.user_metadata || {};
  const tenantId = ownerUser?.id || '';
  const ownerEmail = ownerUser?.email || '';
  const waiterLink = `${window.location.origin}/waiter?tenant=${tenantId}`;

  // ── Logo — persiste no user_metadata (sobrevive a login em outros devices) ─
  const [logoUrl, setLogoUrl] = useState<string>(() => {
    const metaLogo = ownerUser?.user_metadata?.logo_url;
    if (metaLogo) return metaLogo;
    try { const pc = localStorage.getItem('printerConfig'); return pc ? (JSON.parse(pc).logoUrl || '') : ''; }
    catch { return ''; }
  });

  function saveLogo(url: string) {
    try {
      const pc = localStorage.getItem('printerConfig');
      const config = pc ? JSON.parse(pc) : {};
      localStorage.setItem('printerConfig', JSON.stringify({ ...config, logoUrl: url }));
    } catch {}
  }

  const handleLogoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 600_000) { toast.error('Imagem muito grande. Use menos de 600 KB.'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setLogoUrl(base64);
      saveLogo(base64);
      setFormData(p => ({ ...p, logo: base64 }));
    };
    reader.readAsDataURL(file);
  };

  // ── Plano ─────────────────────────────────────────────────────────────────
  const [currentPlan, setCurrentPlan] = useState<string>(meta.plan || 'free');
  const [savingPlan, setSavingPlan]   = useState(false);

  const handleSelectPlan = async (planId: string) => {
    if (planId === currentPlan || savingPlan) return;
    const prev = currentPlan;
    setCurrentPlan(planId);
    setSavingPlan(true);
    try {
      await updateUserMetadata({ plan: planId });
      toast.success(`Plano ${PLANS.find(p => p.id === planId)?.label ?? planId} selecionado!`);
    } catch {
      setCurrentPlan(prev);
      toast.error('Erro ao salvar plano.');
    } finally { setSavingPlan(false); }
  };

  // ── Formulário de dados da empresa ────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving]     = useState(false);

  const [formData, setFormData] = useState({
    establishment_name:     meta.establishment_name     || '',
    establishment_type:     meta.establishment_type     || '',
    establishment_type_other: meta.establishment_type_other || '',
    cnpj:                   meta.cnpj                   || '',
    responsible_name:       meta.responsible_name       || '',
    address:                meta.address                || '',
    phone_whatsapp:         meta.phone_whatsapp         || '',
    responsible_whatsapp:   meta.responsible_whatsapp   || '',
    establishment_email:    meta.establishment_email    || '',
    logo:                   logoUrl,
  });

  const f = (key: keyof typeof formData, val: string) =>
    setFormData(p => ({ ...p, [key]: val }));

  const handleSaveCompany = async () => {
    if (!formData.establishment_name.trim()) { toast.error('Nome do estabelecimento obrigatório.'); return; }
    setSaving(true);
    try {
      await updateUserMetadata({
        establishment_name:       formData.establishment_name.trim(),
        establishment_type:       formData.establishment_type,
        establishment_type_other: formData.establishment_type === 'Outros' ? formData.establishment_type_other.trim() : '',
        cnpj:                     formData.cnpj.trim(),
        responsible_name:         formData.responsible_name.trim(),
        address:                  formData.address.trim(),
        phone_whatsapp:           formData.phone_whatsapp.trim(),
        responsible_whatsapp:     formData.responsible_whatsapp.trim(),
        establishment_email:      formData.establishment_email.trim(),
      });
      if (formData.logo !== logoUrl) {
        setLogoUrl(formData.logo);
        saveLogo(formData.logo);
        await updateUserMetadata({ logo_url: formData.logo }).catch(() => {});
      }
      toast.success('Dados salvos com sucesso!');
      setEditOpen(false);
    } catch {
      toast.error('Erro ao salvar. Tente novamente.');
    } finally { setSaving(false); }
  };

  // ── Aba do card de módulos ────────────────────────────────────────────────
  const [moduleTab, setModuleTab] = useState<'pdv' | 'financeiro'>('pdv');

  // ── Alterar senha ─────────────────────────────────────────────────────────
  const [showPwdSection, setShowPwdSection] = useState(false);
  const [newPassword, setNewPassword]       = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPwd, setShowPwd]               = useState(false);
  const [savingPwd, setSavingPwd]           = useState(false);

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) { toast.error('As senhas não coincidem.'); return; }
    if (newPassword.length < 6) { toast.error('Mínimo de 6 caracteres.'); return; }
    setSavingPwd(true);
    try {
      await updateUserPassword(newPassword);
      toast.success('Senha alterada com sucesso!');
      setNewPassword(''); setConfirmPassword(''); setShowPwdSection(false);
    } catch (err: any) {
      toast.error(err?.message || 'Erro ao alterar senha.');
    } finally { setSavingPwd(false); }
  };

  // ── Misc ──────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    setLoggingOut(true);
    try { await signOutOwner(); navigate('/'); }
    catch { toast.error('Erro ao sair.'); setLoggingOut(false); }
  };

  const displayType = formData.establishment_type === 'Outros'
    ? (formData.establishment_type_other || 'Outros')
    : formData.establishment_type;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans flex flex-col">

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#141414]/10 bg-[#E4E3E0] sticky top-0 z-10">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/')}>
          <div className="w-8 h-8 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-2xl font-bold">FechaConta</span>
        </div>
        <div className="flex flex-col items-center">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#141414]/40">Painel de Controle</p>
          <h1 className="font-serif italic text-lg font-bold leading-tight">
            Olá, {formData.establishment_name || 'Seu Estabelecimento'}
          </h1>
        </div>
        <button onClick={handleLogout} disabled={loggingOut}
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#141414] text-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-all font-semibold disabled:opacity-50 text-sm">
          <LogOut size={16} />
          {loggingOut ? 'Saindo...' : 'Sair da conta'}
        </button>
      </header>

      {/* Main */}
      <main className="flex-1 p-6 md:p-12 max-w-6xl w-full mx-auto">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

          {/* ── Coluna 1: Dados da Empresa ─────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3 border-b border-[#141414]/10 pb-4">
              <div className="w-10 h-10 bg-[#141414]/5 rounded-xl flex items-center justify-center">
                <Building size={20} />
              </div>
              <div>
                <h3 className="font-serif italic text-xl font-bold">Dados da Empresa</h3>
                <p className="text-xs text-[#141414]/50">Informações cadastrais</p>
              </div>
            </div>

            {/* Vista resumida */}
            <div className="flex items-center gap-5 py-2">
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="w-20 h-20 object-contain rounded-xl border border-[#141414]/10 bg-[#F5F5F3] p-1 shrink-0" />
              ) : (
                <div className="w-20 h-20 shrink-0 rounded-xl border-2 border-dashed border-[#141414]/15 bg-[#F5F5F3] flex items-center justify-center text-[#141414]/30">
                  <ImagePlus size={24} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                {displayType && (
                  <span className="text-[11px] font-bold uppercase bg-[#141414]/5 px-2 py-0.5 rounded-full text-[#141414]/50 mb-1 inline-block">
                    {displayType}
                  </span>
                )}
                <p className="text-lg font-bold truncate">
                  {formData.establishment_name || <span className="opacity-30">Nome não informado</span>}
                </p>
                {formData.address && (
                  <p className="text-xs text-[#141414]/40 truncate mt-0.5">{formData.address}</p>
                )}
              </div>
            </div>

            {/* Tenant ID */}
            <div>
              <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1">ID da Empresa</label>
              <div className="flex gap-2">
                <div className="flex-1 font-mono text-xs text-[#141414]/50 bg-[#F5F5F3] px-3 py-2.5 rounded-xl border border-[#141414]/5 overflow-hidden overflow-ellipsis whitespace-nowrap">
                  {tenantId}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(tenantId); setCopiedId(true); toast.success('ID copiado!'); setTimeout(() => setCopiedId(false), 2000); }}
                  className="p-2.5 bg-[#141414] text-white rounded-xl hover:opacity-80 transition-opacity">
                  {copiedId ? <Check size={15} /> : <Copy size={15} />}
                </button>
              </div>
            </div>

            {/* Botão editar */}
            <button onClick={() => setEditOpen(true)}
              className="mt-auto w-full flex items-center justify-center gap-2 py-3 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414] hover:bg-[#141414]/5 transition-colors">
              <Edit2 size={15} /> Editar dados da empresa
            </button>
          </div>

          {/* ── Coluna 2: Card com abas ─────────────────────────────────────── */}
          <div className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm flex flex-col">

            {/* Abas */}
            <div className="grid grid-cols-2 border-b border-[#141414]/10">
              {([
                { id: 'pdv',        label: 'Acesso à Aplicação', icon: Store },
                { id: 'financeiro', label: 'Gestão Empresarial', icon: DollarSign },
              ] as const).map(({ id, label, icon: Icon }) => (
                <button key={id} onClick={() => setModuleTab(id)}
                  className={`flex items-center justify-center gap-2 py-4 text-sm font-bold transition-all border-b-2 -mb-px ${moduleTab === id ? 'border-[#141414] text-[#141414]' : 'border-transparent text-[#141414]/40 hover:text-[#141414]/70'}`}>
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>

            {/* Aba: Acesso à Aplicação */}
            {moduleTab === 'pdv' && (
              <div className="p-6 space-y-5">
                {/* Plano */}
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-3">Meu Plano</label>
                  <div className="grid grid-cols-3 gap-2">
                    {PLANS.map(({ id, label, desc, icon: Icon }) => {
                      const active = currentPlan === id;
                      return (
                        <button key={id} onClick={() => handleSelectPlan(id)} disabled={savingPlan}
                          className={`rounded-xl border p-3 flex flex-col items-center gap-1 transition-all disabled:opacity-60 ${active ? 'bg-[#141414] text-[#E4E3E0] border-[#141414] shadow-md' : 'bg-[#F5F5F3] text-[#141414]/50 border-[#141414]/10 hover:border-[#141414]/30'}`}>
                          <Icon size={16} className={active ? 'opacity-80' : 'opacity-40'} />
                          <p className="text-[11px] font-bold leading-none">Plano</p>
                          <p className={`text-sm font-bold leading-none ${active ? '' : 'text-[#141414]/50'}`}>{label}</p>
                          <p className={`text-[10px] leading-none mt-0.5 ${active ? 'opacity-60' : 'opacity-40'}`}>{active ? 'Ativo' : desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Abrir PDV */}
                <button onClick={() => window.open('/app/dashboard', '_blank')}
                  className="w-full bg-[#141414] text-[#E4E3E0] hover:opacity-90 transition-opacity py-4 px-6 rounded-xl font-bold flex items-center justify-center gap-3 shadow-md group">
                  <LayoutDashboard size={20} className="group-hover:scale-110 transition-transform" />
                  <span>Abrir Painel de Gestão</span>
                  <ExternalLink size={16} className="opacity-60" />
                </button>
                <p className="text-xs text-center text-[#141414]/40">Mesas, pedidos, cardápio, estoque e relatórios.</p>

                {/* Link garçom */}
                <div className="border-t border-[#141414]/10 pt-4">
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1">Link do Terminal de Garçons</label>
                  <div className="flex gap-2">
                    <input readOnly value={waiterLink}
                      className="flex-1 bg-[#F5F5F3] border border-[#141414]/5 text-sm text-[#141414]/70 px-4 py-3 rounded-xl focus:outline-none overflow-x-auto whitespace-nowrap" />
                    <button onClick={() => { navigator.clipboard.writeText(waiterLink); setCopiedLink(true); toast.success('Link copiado!'); setTimeout(() => setCopiedLink(false), 2000); }}
                      className="p-3 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] text-[#141414] rounded-xl transition-all">
                      {copiedLink ? <Check size={18} /> : <Copy size={18} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#141414]/40 mt-1">Compartilhe com seus garçons para acesso ao terminal de pedidos.</p>
                </div>
              </div>
            )}

            {/* Aba: Controle Financeiro */}
            {moduleTab === 'financeiro' && (
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Colaboradores', desc: 'Cadastro e folha de pagamento', icon: User },
                    { label: 'Despesas',      desc: 'Custos fixos e recorrentes',   icon: FileText },
                    { label: 'Dashboard',    desc: 'Visão geral financeira',        icon: LayoutDashboard },
                  ].map(({ label, desc, icon: Icon }) => (
                    <div key={label} className="bg-[#F5F5F3] rounded-xl p-4 text-center flex flex-col items-center gap-2">
                      <div className="w-8 h-8 bg-[#141414]/5 rounded-lg flex items-center justify-center">
                        <Icon size={15} className="opacity-50" />
                      </div>
                      <p className="text-sm font-bold leading-tight">{label}</p>
                      <p className="text-[10px] opacity-40 leading-tight">{desc}</p>
                    </div>
                  ))}
                </div>

                <div className="bg-[#F5F5F3] rounded-xl p-4 space-y-2 text-sm">
                  {[
                    'Cálculo automático de folha (diária ou mensal)',
                    'Registro de pagamentos por colaborador',
                    'Controle de descontos e acréscimos',
                    'Despesas recorrentes com vencimento',
                    'Dashboard com custo total e gráficos',
                  ].map(item => (
                    <div key={item} className="flex items-center gap-2">
                      <Check size={12} className="text-green-600 shrink-0" />
                      <span className="text-[#141414]/60 text-xs">{item}</span>
                    </div>
                  ))}
                </div>

                <button onClick={() => window.open('/financeiro', '_blank')}
                  className="w-full bg-[#141414] text-[#E4E3E0] hover:opacity-90 transition-opacity py-4 px-6 rounded-xl font-bold flex items-center justify-center gap-3 shadow-md group">
                  <DollarSign size={20} className="group-hover:scale-110 transition-transform" />
                  <span>Abrir Gestão Empresarial</span>
                  <ExternalLink size={16} className="opacity-60" />
                </button>
              </div>
            )}

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-6 border-t border-[#141414]/10 flex flex-col md:flex-row items-center justify-between max-w-6xl w-full mx-auto gap-2">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-[#141414] rounded-full" />
          <span className="font-serif italic text-base font-bold">FechaConta</span>
        </div>
        <p className="text-[#141414]/40 text-xs">© {new Date().getFullYear()} FechaConta. Todos os direitos reservados.</p>
      </footer>

      {/* ── Modal: Editar Dados da Empresa ──────────────────────────────────── */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setEditOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between p-6 border-b border-[#141414]/10 sticky top-0 bg-white z-10">
              <div>
                <h3 className="font-serif italic text-2xl font-bold">Dados da Empresa</h3>
                <p className="text-xs text-[#141414]/50 mt-0.5">Preencha as informações do seu estabelecimento</p>
              </div>
              <button onClick={() => setEditOpen(false)} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">

              {/* Logo */}
              <div>
                <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-3">Logo do Estabelecimento</label>
                <div className="flex items-center gap-5">
                  {formData.logo ? (
                    <div className="relative shrink-0">
                      <img src={formData.logo} alt="Logo" className="w-24 h-24 object-contain rounded-xl border border-[#141414]/10 bg-[#F5F5F3] p-1" />
                      <button onClick={() => { setFormData(p => ({ ...p, logo: '' })); }}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600">
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-24 h-24 shrink-0 rounded-xl border-2 border-dashed border-[#141414]/15 bg-[#F5F5F3] flex items-center justify-center text-[#141414]/30">
                      <ImagePlus size={28} />
                    </div>
                  )}
                  <div className="flex-1">
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 text-sm font-semibold text-[#141414] hover:bg-[#141414]/5 transition-colors flex items-center gap-2">
                      <ImagePlus size={16} className="opacity-50" />
                      {formData.logo ? 'Trocar imagem' : 'Enviar logo'}
                    </button>
                    <p className="text-[11px] text-[#141414]/40 mt-1.5">PNG, JPG ou SVG · máx. 600 KB</p>
                  </div>
                </div>
              </div>

              {/* Tipo de estabelecimento */}
              <div>
                <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-2">Tipo de Estabelecimento</label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {BUSINESS_TYPES.map(type => (
                    <button key={type} type="button" onClick={() => f('establishment_type', type)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-all ${formData.establishment_type === type ? 'bg-[#141414] text-white border-[#141414]' : 'bg-[#F5F5F3] text-[#141414]/60 border-[#141414]/10 hover:border-[#141414]/30'}`}>
                      {type}
                    </button>
                  ))}
                </div>
                {formData.establishment_type === 'Outros' && (
                  <input type="text" value={formData.establishment_type_other}
                    onChange={e => f('establishment_type_other', e.target.value)}
                    placeholder="Descreva o tipo..."
                    className="w-full px-4 py-2.5 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                )}
              </div>

              {/* Linha 1: Nome + CNPJ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <Store size={11} /> Nome do Estabelecimento *
                  </label>
                  <input type="text" value={formData.establishment_name}
                    onChange={e => f('establishment_name', e.target.value)}
                    placeholder="Ex: Pizzaria do João"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <FileText size={11} /> CNPJ
                  </label>
                  <input type="text" value={formData.cnpj}
                    onChange={e => f('cnpj', e.target.value)}
                    placeholder="00.000.000/0001-00"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
              </div>

              {/* Linha 2: Responsável + Email estabelecimento */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <User size={11} /> Nome do Responsável
                  </label>
                  <input type="text" value={formData.responsible_name}
                    onChange={e => f('responsible_name', e.target.value)}
                    placeholder="Nome completo"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <Mail size={11} /> E-mail do Estabelecimento
                  </label>
                  <input type="email" value={formData.establishment_email}
                    onChange={e => f('establishment_email', e.target.value)}
                    placeholder="contato@seurestaurante.com"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
              </div>

              {/* Linha 3: WhatsApp estabelecimento + WhatsApp responsável */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <Phone size={11} /> WhatsApp do Estabelecimento
                  </label>
                  <input type="tel" value={formData.phone_whatsapp}
                    onChange={e => f('phone_whatsapp', e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
                <div>
                  <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                    <Phone size={11} /> WhatsApp do Responsável
                  </label>
                  <input type="tel" value={formData.responsible_whatsapp}
                    onChange={e => f('responsible_whatsapp', e.target.value)}
                    placeholder="(11) 99999-9999"
                    className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                </div>
              </div>

              {/* Endereço */}
              <div>
                <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                  <MapPin size={11} /> Endereço do Estabelecimento
                </label>
                <input type="text" value={formData.address}
                  onChange={e => f('address', e.target.value)}
                  placeholder="Rua, número, bairro, cidade — UF"
                  className="w-full px-4 py-3 rounded-xl border border-[#141414]/20 bg-[#F5F5F3] text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
              </div>

              {/* E-mail do proprietário (somente leitura) */}
              <div>
                <label className="text-xs uppercase font-bold text-[#141414]/40 block mb-1 flex items-center gap-1">
                  <Mail size={11} /> E-mail do Proprietário (login)
                </label>
                <div className="px-4 py-3 rounded-xl bg-[#F5F5F3] border border-[#141414]/5 text-sm text-[#141414]/60 font-semibold">
                  {ownerEmail}
                </div>
              </div>

              {/* Alterar senha */}
              <div className="border-t border-[#141414]/10 pt-4">
                <button onClick={() => setShowPwdSection(p => !p)}
                  className="flex items-center gap-2 text-sm font-semibold text-[#141414]/60 hover:text-[#141414] transition-colors">
                  <KeyRound size={15} />
                  {showPwdSection ? 'Cancelar alteração de senha' : 'Alterar senha de acesso'}
                </button>
                {showPwdSection && (
                  <div className="mt-3 space-y-3 p-4 bg-[#F5F5F3] rounded-xl border border-[#141414]/10">
                    <div className="relative">
                      <label className="block text-xs font-bold text-[#141414]/40 mb-1">Nova senha</label>
                      <input type={showPwd ? 'text' : 'password'} value={newPassword}
                        onChange={e => setNewPassword(e.target.value)} placeholder="••••••••" minLength={6}
                        className="w-full px-4 py-2.5 pr-10 rounded-xl border border-[#141414]/20 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                      <button type="button" onClick={() => setShowPwd(p => !p)} className="absolute right-3 bottom-2.5 text-[#141414]/40">
                        {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#141414]/40 mb-1">Confirmar nova senha</label>
                      <input type={showPwd ? 'text' : 'password'} value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)} placeholder="••••••••" minLength={6}
                        className="w-full px-4 py-2.5 rounded-xl border border-[#141414]/20 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#141414]/20" />
                    </div>
                    <button onClick={handleChangePassword} disabled={savingPwd || !newPassword || !confirmPassword}
                      className="w-full py-2.5 bg-[#141414] text-white rounded-xl font-bold text-sm hover:opacity-90 disabled:opacity-50">
                      {savingPwd ? 'Salvando...' : 'Confirmar nova senha'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex gap-3 p-6 border-t border-[#141414]/10 sticky bottom-0 bg-white">
              <button onClick={() => setEditOpen(false)}
                className="flex-1 py-3 border border-[#141414]/20 rounded-xl text-sm font-bold text-[#141414]/60 hover:bg-gray-50 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSaveCompany} disabled={saving}
                className="flex-1 py-3 bg-[#141414] text-white rounded-xl text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50">
                {saving ? 'Salvando...' : 'Salvar dados'}
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
