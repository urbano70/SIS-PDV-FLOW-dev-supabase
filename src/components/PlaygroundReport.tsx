import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, FileText, RefreshCcw } from 'lucide-react';
import socket from '../lib/socket';
import type { PlaygroundEntry } from '../lib/playgroundTypes';
import {
  emitPlaygroundAck,
  formatPlaygroundMoney,
  playgroundEntryStatusLabel,
} from '../lib/playgroundClient';

interface PlaygroundReportProps {
  visible: boolean;
  defaultShiftStartedAt?: string;
}

function toDatetimeLocal(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return '';
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function entryStatusClass(status: string): string {
  if (status === 'active') return 'bg-green-100 text-green-700';
  if (status === 'paid' || status === 'finalized') return 'bg-blue-100 text-blue-700';
  return 'bg-red-100 text-red-700';
}

export default function PlaygroundReport({ visible, defaultShiftStartedAt }: PlaygroundReportProps) {
  const [expanded, setExpanded] = useState(false);
  const [shiftInput, setShiftInput] = useState(() => toDatetimeLocal(defaultShiftStartedAt));
  const [entries, setEntries] = useState<PlaygroundEntry[]>([]);
  const [availableShifts, setAvailableShifts] = useState<string[]>([]);
  const [serverShiftStartedAt, setServerShiftStartedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (defaultShiftStartedAt && !shiftInput) setShiftInput(toDatetimeLocal(defaultShiftStartedAt));
  }, [defaultShiftStartedAt, shiftInput]);

  const loadReport = async () => {
    setLoading(true);
    setLoaded(false);
    setError('');
    const ack = await emitPlaygroundAck(socket, 'parquinho_get_report', {
      ...(toIso(shiftInput) ? { shiftStartedAt: toIso(shiftInput) } : {}),
    });
    if (!ack.ok) {
      setError(ack.message || 'Não foi possível carregar o relatório do Parquinho.');
      setLoading(false);
      return;
    }
    setEntries(Array.isArray(ack.entries) ? ack.entries : []);
    setAvailableShifts(Array.isArray(ack.shifts) ? ack.shifts : []);
    setServerShiftStartedAt(ack.shiftStartedAt || '');
    setLoaded(true);
    setLoading(false);
  };

  useEffect(() => {
    if (visible && expanded && !loaded && !loading) void loadReport();
    // Only opening the card should request the ADM report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expanded]);

  const total = useMemo(
    () => entries.reduce((sum, entry) => sum + (Number.isFinite(Number(entry.totalPrice)) ? Number(entry.totalPrice) : 0), 0),
    [entries],
  );
  const activeCount = useMemo(() => entries.filter(entry => entry.status === 'active').length, [entries]);

  return (
    <section className="bg-white rounded-2xl border border-[#141414]/10 shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(value => !value)}
        className="w-full flex items-center gap-3 text-left p-4 hover:bg-[#141414]/[0.02] transition-colors"
      >
        <div className="w-9 h-9 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center"><FileText size={17} /></div>
        <div className="flex-1 min-w-0">
          <h3 className="font-serif italic text-lg leading-none">Relatório do Parquinho</h3>
          <p className="text-[9px] opacity-55 mt-1">Histórico por turno de atendimento, inclusive atravessando a meia-noite.</p>
        </div>
        {expanded ? <ChevronUp size={16} className="opacity-50" /> : <ChevronDown size={16} className="opacity-50" />}
      </button>
      {expanded && (
        <div className="border-t border-[#141414]/8 p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-2 bg-[#fafafa] border border-[#141414]/8 rounded-xl p-3">
            <div className="flex-1">
              <label className="flex items-center gap-1 text-[8px] uppercase font-black opacity-50 mb-1"><CalendarClock size={10} /> Início do turno (ISO)</label>
              <input
                type="datetime-local"
                value={shiftInput}
                onChange={event => { setShiftInput(event.target.value); setLoaded(false); }}
                className="w-full bg-white border border-[#141414]/10 rounded-lg py-2 px-2 text-[10px] font-bold outline-none focus:ring-1 focus:ring-[#141414]"
              />
            </div>
            <button type="button" onClick={() => void loadReport()} disabled={loading} className="flex items-center justify-center gap-1.5 bg-[#141414] text-white rounded-lg px-3 py-2 text-[9px] font-bold uppercase disabled:opacity-50">
              <RefreshCcw size={11} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Carregando…' : 'Carregar turno'}
            </button>
          </div>
          {availableShifts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[8px] font-bold uppercase opacity-45 self-center mr-1">Turnos:</span>
              {availableShifts.slice(0, 8).map(shift => (
                <button key={shift} type="button" onClick={() => { setShiftInput(toDatetimeLocal(shift)); setLoaded(false); }} className="text-[8px] bg-[#141414]/5 hover:bg-[#141414]/10 rounded-lg px-2 py-1 font-mono">{new Date(shift).toLocaleString('pt-BR')}</button>
              ))}
            </div>
          )}
          {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl p-3 text-[10px]"><AlertTriangle size={13} className="shrink-0 mt-0.5" /><span>{error}</span></div>}
          {loading ? (
            <div className="py-10 text-center text-[10px] opacity-50 animate-pulse">Consultando lançamentos preservados do turno…</div>
          ) : !loaded ? (
            <div className="py-8 text-center text-[10px] opacity-50">Selecione o turno e carregue o relatório.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="bg-[#141414] text-white rounded-xl p-3"><p className="text-[8px] uppercase opacity-55 font-bold">Lançamentos</p><p className="text-xl font-mono font-black mt-1">{entries.length}</p></div>
                <div className="bg-white border border-[#141414]/10 rounded-xl p-3"><p className="text-[8px] uppercase opacity-55 font-bold">Ativos</p><p className="text-xl font-mono font-black mt-1">{activeCount}</p></div>
                <div className="bg-white border border-[#141414]/10 rounded-xl p-3"><p className="text-[8px] uppercase opacity-55 font-bold">Quantidade</p><p className="text-xl font-mono font-black mt-1">{entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)}</p></div>
                <div className="bg-green-50 border border-green-200 text-green-800 rounded-xl p-3"><p className="text-[8px] uppercase opacity-65 font-bold">Total</p><p className="text-lg font-mono font-black mt-1">{formatPlaygroundMoney(total)}</p></div>
              </div>
              {serverShiftStartedAt && <p className="text-[8px] opacity-45">Turno consultado: <span className="font-mono">{new Date(serverShiftStartedAt).toLocaleString('pt-BR')}</span></p>}
              {entries.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-[#141414]/15 rounded-xl text-[10px] opacity-50">Nenhum lançamento encontrado para o turno selecionado.</div>
              ) : (
                <div className="overflow-x-auto border border-[#141414]/10 rounded-xl">
                  <table className="w-full text-left min-w-[760px]">
                    <thead className="bg-[#141414]/5 text-[8px] uppercase font-black opacity-55">
                      <tr><th className="px-3 py-2">Mesa</th><th className="px-3 py-2">Horário</th><th className="px-3 py-2">Operador</th><th className="px-3 py-2">Criança</th><th className="px-3 py-2 text-center">Qtd.</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Situação</th></tr>
                    </thead>
                    <tbody className="text-[10px]">
                      {entries.map(entry => (
                        <tr key={entry.id} className="border-t border-[#141414]/5 hover:bg-[#141414]/[0.02]">
                          <td className="px-3 py-2 font-bold">Mesa {entry.tableId}</td>
                          <td className="px-3 py-2 font-mono whitespace-nowrap">{new Date(entry.createdAt).toLocaleString('pt-BR')}</td>
                          <td className="px-3 py-2">{entry.operatorName || 'Não informado'}</td>
                          <td className="px-3 py-2">{entry.childName?.trim() || 'Não informado'}</td>
                          <td className="px-3 py-2 text-center font-mono">{entry.quantity}</td>
                          <td className="px-3 py-2 text-right font-mono font-bold">{formatPlaygroundMoney(entry.totalPrice)}</td>
                          <td className="px-3 py-2"><span className={`inline-flex px-1.5 py-0.5 rounded-full text-[8px] font-bold ${entryStatusClass(entry.status)}`}>{playgroundEntryStatusLabel(entry.status)}</span></td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-[#141414]/5 border-t border-[#141414]/15"><tr><td colSpan={5} className="px-3 py-2 text-right text-[9px] font-black uppercase">Total do turno</td><td className="px-3 py-2 text-right font-mono font-black">{formatPlaygroundMoney(total)}</td><td /></tr></tfoot>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
