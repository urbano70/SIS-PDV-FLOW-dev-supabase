import React, { useState, useRef } from 'react';
import { Upload, Save, RotateCcw, FileText, Loader2, CheckCircle } from 'lucide-react';
import {
  ReservationConfig,
  ReservationFieldConfig,
  DEFAULT_CONFIG,
  saveReservationConfig,
  uploadTemplate,
} from '../../lib/pdf/reservationConfig';

interface ReservationConfigProps {
  config: ReservationConfig;
  onSaved: (config: ReservationConfig) => void;
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold uppercase tracking-widest text-[#141414]/50">
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-[#141414]/35 leading-snug">{hint}</p>}
    </div>
  );
}

function NumberInput({
  value, onChange, min, max, step = 1,
}: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full px-3 py-2 rounded-xl border-2 border-[#141414]/10 focus:border-[#141414] outline-none text-sm font-medium transition-colors"
    />
  );
}

export function ReservationConfig({ config, onSaved }: ReservationConfigProps) {
  const [field, setField] = useState<ReservationFieldConfig>({ ...config.field });
  const [templateFile, setTemplateFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const updateField = <K extends keyof ReservationFieldConfig>(key: K, value: ReservationFieldConfig[K]) => {
    setField(prev => ({ ...prev, [key]: value }));
    setSaved(false);
    setError(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.type !== 'application/pdf') { setError('Selecione um arquivo PDF válido.'); return; }
    if (f.size > 10 * 1024 * 1024) { setError('O arquivo deve ter no máximo 10 MB.'); return; }
    setTemplateFile(f);
    setError(null);
    setSaved(false);
  };

  const handleReset = () => {
    setField({ ...DEFAULT_CONFIG.field });
    setTemplateFile(null);
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    if (field.maxFontSize < field.minFontSize) {
      setError('Tamanho máximo deve ser maior que o mínimo.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      let hasCustomTemplate = config.hasCustomTemplate;
      if (templateFile) {
        await uploadTemplate(templateFile);
        hasCustomTemplate = true;
      }
      const next: ReservationConfig = { field, hasCustomTemplate };
      saveReservationConfig(next);
      setSaved(true);
      setTemplateFile(null);
      onSaved(next);
    } catch (err: any) {
      setError(err?.message ?? 'Não foi possível salvar as configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Template file */}
      <Field
        label="Arquivo do Template (PDF)"
        hint="O nome será inserido sobre este PDF sem alterar o original."
      >
        <div
          onClick={() => fileRef.current?.click()}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-dashed cursor-pointer transition-colors ${
            templateFile ? 'border-green-500 bg-green-50' : 'border-[#141414]/15 hover:border-[#141414]/30'
          }`}
        >
          {templateFile ? (
            <FileText size={16} className="text-green-600 shrink-0" />
          ) : (
            <Upload size={16} className="text-[#141414]/30 shrink-0" />
          )}
          <span className="text-sm truncate text-[#141414]/60">
            {templateFile
              ? templateFile.name
              : config.hasCustomTemplate
              ? 'Template personalizado ativo — clique para substituir'
              : 'Clique para selecionar um arquivo PDF'}
          </span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />
      </Field>

      {/* Font size */}
      <div className="bg-[#141414]/[0.03] rounded-2xl p-4 space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40">
          Tamanho da fonte
        </p>
        <p className="text-[10px] text-[#141414]/40 -mt-2 leading-snug">
          Nomes curtos usam o tamanho máximo; nomes longos diminuem automaticamente até o mínimo.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Máximo (pt)">
            <NumberInput value={field.maxFontSize} onChange={v => updateField('maxFontSize', v)} min={8} max={200} />
          </Field>
          <Field label="Mínimo (pt)">
            <NumberInput value={field.minFontSize} onChange={v => updateField('minFontSize', v)} min={6} max={200} />
          </Field>
        </div>
      </div>

      {/* Color */}
      <Field label="Cor do texto">
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={field.color}
            onChange={e => updateField('color', e.target.value)}
            className="w-10 h-10 rounded-lg border-2 border-[#141414]/10 cursor-pointer p-0.5"
          />
          <input
            type="text"
            value={field.color}
            onChange={e => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) updateField('color', e.target.value);
            }}
            className="flex-1 px-3 py-2 rounded-xl border-2 border-[#141414]/10 focus:border-[#141414] outline-none text-sm font-mono transition-colors"
            placeholder="#1a1a1a"
          />
        </div>
      </Field>

      {/* Error */}
      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={handleReset}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border-2 border-[#141414]/10 text-sm font-bold hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <RotateCcw size={13} />
          Padrão
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-[#141414] text-[#E4E3E0] text-sm font-bold uppercase tracking-widest hover:bg-[#2a2a2a] active:scale-95 transition-all disabled:opacity-50"
        >
          {saving ? (
            <><Loader2 size={14} className="animate-spin" /> Salvando...</>
          ) : saved ? (
            <><CheckCircle size={14} /> Salvo!</>
          ) : (
            <><Save size={14} /> Salvar</>
          )}
        </button>
      </div>
    </div>
  );
}
