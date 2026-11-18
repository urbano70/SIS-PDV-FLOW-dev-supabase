import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import socket from '../lib/socket';
import type { PizzeriaConfig } from '../types';
import {
  emitPlaygroundAck,
  formatPlaygroundMoney,
  parsePlaygroundPriceInput,
} from '../lib/playgroundClient';

interface PlaygroundAdminCardProps {
  tenantId: string;
  pizzariaConfig: PizzeriaConfig;
  isCashRegisterOpen: boolean;
  updatePizzeriaConfig: (config: PizzeriaConfig) => void;
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
  const [configSaving, setConfigSaving] = useState(false);

  useEffect(() => {
    const price = pizzariaConfig.parquinhoPrice;
    setPriceInput(price === null || price === undefined ? '' : String(price));
  }, [pizzariaConfig.parquinhoPrice]);

  const persistPlaygroundConfig = async (patch: Partial<PizzeriaConfig>) => {
    if (configSaving) return;
    setConfigSaving(true);
    try {
      const ack = await emitPlaygroundAck(socket, 'update_pizzaria_config', patch);
      if (!ack.ok) {
        toast.error(ack.message || 'O servidor não confirmou a configuração.');
        return;
      }
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

  return (
    <div className="bg-white p-4 rounded-2xl border border-[#141414]/10 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <ShieldCheck className="text-[#141414]" size={14} />
        <h3 className="font-serif italic text-sm leading-none flex-1">Modo Parquinho</h3>
        <span className={`text-[7px] font-black uppercase px-2 py-1 rounded-full ${pizzariaConfig.parquinhoEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {pizzariaConfig.parquinhoEnabled ? 'Ativo' : 'Desativado'}
        </span>
      </div>
      <p className="text-[8px] text-[#141414]/45 mb-4 leading-relaxed">
        Cobrança por criança, com exatamente uma unidade por lançamento. O preço é definido pelo ADM e vale apenas para novos lançamentos.
      </p>

      <div className="space-y-3">
        {/* Toggle ativar/desativar */}
        <div className="flex items-center justify-between rounded-xl border border-[#141414]/8 bg-[#fafafa] px-3 py-2.5">
          <div>
            <p className="text-[9px] font-bold">Ativar Modo Parquinho</p>
            <p className="text-[7px] opacity-45 mt-0.5">Desativar bloqueia novos lançamentos e preserva o histórico.</p>
          </div>
          <button
            type="button"
            aria-label="Ativar Modo Parquinho"
            disabled={configSaving}
            onClick={() => void persistPlaygroundConfig({ parquinhoEnabled: !pizzariaConfig.parquinhoEnabled })}
            className={`relative h-5 w-9 rounded-full transition-colors shrink-0 ml-3 ${pizzariaConfig.parquinhoEnabled ? 'bg-green-500' : 'bg-[#141414]/20'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${pizzariaConfig.parquinhoEnabled ? 'translate-x-4' : ''}`} />
          </button>
        </div>

        {/* Preço e configurações */}
        <div className="rounded-xl border border-[#141414]/8 bg-[#fafafa] p-3 space-y-2.5">
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
            <button
              type="button"
              disabled={configSaving}
              onClick={() => void savePlaygroundConfig()}
              className="bg-[#141414] text-white rounded-lg px-3 text-[9px] font-bold uppercase hover:opacity-80"
            >
              {configSaving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
          <label className="flex items-center gap-2 text-[8px] font-semibold">
            <input
              type="checkbox"
              checked={pizzariaConfig.parquinhoChildNameRequired === true}
              disabled={configSaving}
              onChange={event => void persistPlaygroundConfig({ parquinhoChildNameRequired: event.target.checked })}
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
      </div>

      {isCashRegisterOpen && (
        <p className="text-[7px] text-[#141414]/35 mt-3">
          O caixa está aberto; a configuração pode ser salva, mas novos lançamentos continuam sujeitos ao caixa e ao backend.
        </p>
      )}
    </div>
  );
}
