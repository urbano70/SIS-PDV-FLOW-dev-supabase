import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle, Copy, LockKeyhole, QrCode, RefreshCcw, ShieldCheck, UserCheck, UserMinus, UserX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import socket from '../lib/socket';
import type { PizzeriaConfig } from '../types';
import type { PlaygroundOperator } from '../lib/playgroundTypes';
import {
  emitPlaygroundAck,
  formatPlaygroundMoney,
  parsePlaygroundPriceInput,
  playgroundStatusLabel,
} from '../lib/playgroundClient';

interface PlaygroundAdminCardProps {
  tenantId: string;
  pizzariaConfig: PizzeriaConfig;
  isCashRegisterOpen: boolean;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
}

function statusClasses(status: PlaygroundOperator['status']): string {
  if (status === 'approved') return 'bg-green-100 text-green-700';
  if (status === 'inactive') return 'bg-gray-100 text-gray-500';
  return 'bg-amber-100 text-amber-800';
}

export default function PlaygroundAdminCard({
  tenantId,
  pizzariaConfig,
  isCashRegisterOpen,
  updatePizzeriaConfig,
}: PlaygroundAdminCardProps) {
  const [priceInput, setPriceInput] = useState(
    pizzariaConfig.parquinhoPrice === null || pizzariaConfig.parquinhoPrice === undefined
      ? ''
      : String(pizzariaConfig.parquinhoPrice),
  );
  const [operators, setOperators] = useState<PlaygroundOperator[]>([]);
  const [operatorsLoading, setOperatorsLoading] = useState(false);
  const [operatorsError, setOperatorsError] = useState('');
  const [qrCopied, setQrCopied] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const playgroundUrl = useMemo(
    () => `${window.location.origin}/parquinho?tenant=${encodeURIComponent(tenantId)}`,
    [tenantId],
  );

  useEffect(() => {
    const price = pizzariaConfig.parquinhoPrice;
    setPriceInput(price === null || price === undefined ? '' : String(price));
  }, [pizzariaConfig.parquinhoPrice]);

  const loadOperators = useCallback(async () => {
    if (!tenantId) return;
    setOperatorsLoading(true);
    setOperatorsError('');
    const ack = await emitPlaygroundAck(socket, 'parquinho_get_operators');
    if (ack.ok && Array.isArray(ack.operators)) {
      setOperators(ack.operators);
    } else {
      setOperatorsError(ack.message || 'Não foi possível carregar os operadores.');
    }
    setOperatorsLoading(false);
  }, [tenantId]);

  useEffect(() => {
    void loadOperators();
    const onOperatorStatus = (payload: { operatorId?: string; status?: PlaygroundOperator['status'] }) => {
      if (!payload?.operatorId || !payload.status) return;
      setOperators(prev => prev.map(operator =>
        operator.id === payload.operatorId ? { ...operator, status: payload.status! } : operator,
      ));
    };
    socket.on('parquinho_operator_status', onOperatorStatus);
    return () => { socket.off('parquinho_operator_status', onOperatorStatus); };
  }, [loadOperators]);

  const persistPlaygroundConfig = async (patch: Partial<PizzeriaConfig>) => {
    if (configSaving) return;
    setConfigSaving(true);
    try {
      const ack = await emitPlaygroundAck(socket, 'update_pizzaria_config', patch);
      if (!ack.ok) {
        toast.error(ack.message || 'O servidor não confirmou a configuração.');
        return;
      }
      // FirebaseProvider receives the authoritative update_pizzaria_config;
      // do not optimistically overwrite another PC's restaurant settings.
      toast.success('Configuração do Parquinho salva.');
    } finally {
      setConfigSaving(false);
    }
  };

  const savePlaygroundConfig = async () => {
    const normalized = priceInput.trim();
    if (normalized && parsePlaygroundPriceInput(normalized) === null) {
      toast.error('Informe um preço válido maior ou igual a zero.');
      return;
    }
    const price = normalized ? parsePlaygroundPriceInput(normalized) : null;
    await persistPlaygroundConfig({ parquinhoPrice: price });
  };

  const setOperatorStatus = async (operatorId: string, status: 'approved' | 'inactive' | 'revoke') => {
    const ack = await emitPlaygroundAck(socket, 'parquinho_set_operator_status', { operatorId, status });
    if (!ack.ok) {
      toast.error(ack.message || 'Não foi possível atualizar o operador.');
      return;
    }
    setOperators(prev => status === 'revoke'
      ? prev.filter(operator => operator.id !== operatorId)
      : prev.map(operator => operator.id === operatorId ? { ...operator, status } : operator));
    toast.success(status === 'approved' ? 'Operador aprovado.' : status === 'inactive' ? 'Operador inativado.' : 'Cadastro revogado.');
  };

  const copyQr = async () => {
    try {
      await navigator.clipboard.writeText(playgroundUrl);
      setQrCopied(true);
      window.setTimeout(() => setQrCopied(false), 1_500);
    } catch {
      toast.error('Não foi possível copiar o endereço.');
    }
  };

  return (
    <div className="bg-white p-3 rounded-xl border border-[#141414]/10 shadow-sm col-span-full">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="text-[#141414]" size={13} />
        <h3 className="font-serif italic text-sm leading-none flex-1">Modo Parquinho</h3>
        <span className={`text-[7px] font-black uppercase px-2 py-1 rounded-full ${pizzariaConfig.parquinhoEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {pizzariaConfig.parquinhoEnabled ? 'Ativo' : 'Desativado'}
        </span>
      </div>
      <p className="text-[8px] text-[#141414]/45 mb-3 leading-relaxed">
        Cobrança por criança, com exatamente uma unidade por lançamento. O preço é definido pelo ADM e vale apenas para novos lançamentos.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_230px] gap-3">
        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-xl border border-[#141414]/8 bg-[#fafafa] px-2.5 py-2">
            <div>
              <p className="text-[8px] font-bold">Ativar Modo Parquinho</p>
              <p className="text-[6.5px] opacity-45 mt-0.5">Desativar bloqueia novos lançamentos e preserva o histórico.</p>
            </div>
            <button
              type="button"
              aria-label="Ativar Modo Parquinho"
              disabled={configSaving}
              onClick={() => void persistPlaygroundConfig({
                parquinhoEnabled: !pizzariaConfig.parquinhoEnabled,
              })}
              className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-2 ${pizzariaConfig.parquinhoEnabled ? 'bg-green-500' : 'bg-[#141414]/20'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pizzariaConfig.parquinhoEnabled ? 'translate-x-4' : ''}`} />
            </button>
          </div>
          <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[7.5px] font-black uppercase opacity-45 flex-1">Preço por criança</label>
              <span className="text-[7px] opacity-40">vazio = não configurado</span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] opacity-40">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceInput}
                  disabled={configSaving}
                  onChange={event => setPriceInput(event.target.value)}
                  placeholder="ex.: 25,00"
                  className="w-full bg-white border border-[#141414]/10 rounded-lg py-1.5 pl-7 pr-2 text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#141414]"
                />
              </div>
              <button type="button" disabled={configSaving} onClick={() => void savePlaygroundConfig()} className="bg-[#141414] text-white rounded-lg px-3 text-[9px] font-bold uppercase hover:opacity-80">{configSaving ? 'Salvando…' : 'Salvar'}</button>
            </div>
            <label className="flex items-center gap-2 text-[8px] font-semibold">
              <input
                type="checkbox"
                checked={pizzariaConfig.parquinhoChildNameRequired === true}
                disabled={configSaving}
                onChange={event => void persistPlaygroundConfig({
                  parquinhoChildNameRequired: event.target.checked,
                })}
                className="accent-[#141414]"
              />
              Nome da criança obrigatório
            </label>
            <p className={`text-[8px] ${pizzariaConfig.parquinhoPrice === null || pizzariaConfig.parquinhoPrice === undefined ? 'text-amber-700' : 'text-green-700'}`}>
              {pizzariaConfig.parquinhoPrice === null || pizzariaConfig.parquinhoPrice === undefined
                ? 'Sem preço configurado: lançamentos bloqueados.'
                : `Preço atual: ${formatPlaygroundMoney(pizzariaConfig.parquinhoPrice)} · item gerenciado em Outros`}
            </p>
          </div>
          <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-2.5">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck size={11} className="opacity-55" />
              <p className="text-[8px] font-black uppercase tracking-wider flex-1">Operadores cadastrados</p>
              <button type="button" onClick={() => void loadOperators()} disabled={operatorsLoading} className="p-1 rounded-md hover:bg-[#141414]/10 disabled:opacity-40" title="Atualizar operadores">
                <RefreshCcw size={10} className={operatorsLoading ? 'animate-spin' : ''} />
              </button>
            </div>
            {operatorsError && <p className="text-[8px] text-red-600 bg-red-50 border border-red-100 rounded-lg p-2 mb-2">{operatorsError}</p>}
            {operatorsLoading && operators.length === 0 ? (
              <p className="text-[8px] opacity-45 py-2">Carregando operadores…</p>
            ) : operators.length === 0 ? (
              <p className="text-[8px] opacity-45 py-2">Nenhum cadastro de operador ainda.</p>
            ) : (
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {operators.map(operator => (
                  <div key={operator.id} className="flex items-center gap-2 bg-white border border-[#141414]/8 rounded-lg px-2 py-1.5">
                    <div className="w-6 h-6 rounded-full bg-[#141414] text-white flex items-center justify-center text-[9px] font-black shrink-0">{operator.name?.slice(0, 1).toUpperCase() || '?'}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] font-bold truncate">{operator.name}</p>
                      <p className={`inline-flex text-[7px] font-bold px-1.5 py-0.5 rounded-full ${statusClasses(operator.status)}`}>{playgroundStatusLabel(operator.status)}</p>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      {operator.status !== 'approved' && <button type="button" onClick={() => void setOperatorStatus(operator.id, 'approved')} title="Aprovar" className="p-1 text-green-600 hover:bg-green-50 rounded"><CheckCircle size={12} /></button>}
                      {operator.status === 'approved' && <button type="button" onClick={() => void setOperatorStatus(operator.id, 'inactive')} title="Inativar" className="p-1 text-amber-600 hover:bg-amber-50 rounded"><UserMinus size={12} /></button>}
                      <button type="button" onClick={() => void setOperatorStatus(operator.id, 'revoke')} title="Revogar cadastro" className="p-1 text-red-500 hover:bg-red-50 rounded"><UserX size={12} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="flex items-center gap-1 text-[7px] opacity-40 mt-2"><LockKeyhole size={8} /> Senhas nunca são exibidas neste painel.</p>
          </div>
        </div>
        <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-2.5 flex flex-col items-center text-center">
          <div className="flex items-center gap-1.5 mb-2 self-stretch">
            <QrCode size={12} className="opacity-55" />
            <p className="text-[8px] font-black uppercase tracking-wider flex-1 text-left">QR do operador</p>
          </div>
          {pizzariaConfig.parquinhoEnabled ? (
            <>
              <div className="bg-white p-2 rounded-xl border border-[#141414]/10"><QRCodeSVG value={playgroundUrl} size={150} includeMargin /></div>
              <p className="text-[7px] opacity-45 mt-2 leading-relaxed">A rota contém somente o estabelecimento. O acesso exige cadastro e aprovação.</p>
              <div className="flex items-center gap-1.5 w-full mt-2">
                <code className="text-[7px] bg-white border border-[#141414]/10 rounded-lg px-2 py-1.5 flex-1 truncate text-left">{playgroundUrl}</code>
                <button type="button" onClick={() => void copyQr()} className="p-1.5 bg-[#141414] text-white rounded-lg" title="Copiar endereço">{qrCopied ? <CheckCircle size={11} /> : <Copy size={11} />}</button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center min-h-40 opacity-40"><QrCode size={38} /><p className="text-[9px] font-bold mt-2">Ative o módulo para gerar o QR</p></div>
          )}
        </div>
      </div>
      {isCashRegisterOpen && <p className="text-[7px] text-[#141414]/35 mt-2">O caixa está aberto; a configuração pode ser salva, mas novos lançamentos continuam sujeitos ao caixa e ao backend.</p>}
    </div>
  );
}
