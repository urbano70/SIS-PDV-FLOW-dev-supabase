import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface ReservationFormProps {
  onGenerate: (name: string) => Promise<void>;
}

export function ReservationForm({ onGenerate }: ReservationFormProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError('Informe o nome para continuar.'); return; }
    if (trimmed.length > 100) { setError('O nome deve ter no máximo 100 caracteres.'); return; }
    setError(null);
    setLoading(true);
    try {
      await onGenerate(trimmed);
    } catch (err: any) {
      setError(err?.message ?? 'Não foi possível gerar a reserva. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1">
        <label className="block text-xs font-bold uppercase tracking-widest text-[#141414]/50">
          Nome
        </label>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setError(null); }}
          placeholder="Ex: Maria Júlia"
          maxLength={100}
          disabled={loading}
          className="w-full px-4 py-3 rounded-xl border-2 border-[#141414]/10 focus:border-[#141414] outline-none text-base font-medium transition-colors disabled:opacity-50"
          autoFocus
        />
        {error && (
          <p className="text-xs text-red-500 font-medium mt-1">{error}</p>
        )}
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3.5 rounded-xl bg-[#141414] text-[#E4E3E0] font-bold text-sm uppercase tracking-widest hover:bg-[#2a2a2a] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Gerando sua reserva...
          </>
        ) : (
          'Gerar Reserva'
        )}
      </button>
    </form>
  );
}
