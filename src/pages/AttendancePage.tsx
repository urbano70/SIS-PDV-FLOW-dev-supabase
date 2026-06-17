import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

interface EmployeeInfo {
  id: string;
  name: string;
  confirmed: boolean;
}

export default function AttendancePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [employees, setEmployees] = useState<EmployeeInfo[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [successName, setSuccessName] = useState('');

  useEffect(() => {
    fetch(`/api/attendance/${token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else { setDate(data.date); setEmployees(data.employees); }
        setLoading(false);
      })
      .catch(() => { setError('Erro ao carregar. Verifique sua conexão.'); setLoading(false); });
  }, [token]);

  const confirm = async (empId: string) => {
    if (successName || confirming) return;
    setConfirming(empId);
    try {
      const r = await fetch(`/api/attendance/${token}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: empId }),
      });
      const data = await r.json();
      if (data.ok) {
        setSuccessName(data.name);
        setEmployees(prev => prev.map(e => e.id === empId ? { ...e, confirmed: true } : e));
      } else {
        setError(data.error || 'Erro ao confirmar presença.');
      }
    } catch {
      setError('Erro de conexão.');
    }
    setConfirming(null);
  };

  const formattedDate = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : '';

  if (loading) return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 bg-[#141414] rounded-full animate-pulse" />
        <p className="font-serif italic text-lg">Carregando...</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-sm border border-[#141414]/10">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4 text-red-600 text-xl font-bold">✕</div>
        <h2 className="font-serif italic text-xl mb-2">QR Code Inválido</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  );

  if (successName) return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center shadow-sm border border-green-200">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 text-3xl">✓</div>
        <h2 className="font-serif italic text-2xl mb-1">Presença Confirmada!</h2>
        <p className="font-semibold text-gray-700 mb-1">{successName}</p>
        <p className="text-sm text-gray-400 capitalize">{formattedDate}</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center pt-10 p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="w-11 h-11 bg-[#141414] rounded-full mx-auto mb-3" />
          <h1 className="font-serif italic text-2xl">FechaConta</h1>
          <p className="text-xs text-gray-500 mt-1">Registro de Presença</p>
        </div>

        <div className="bg-white rounded-2xl p-6 shadow-sm border border-[#141414]/10">
          <div className="text-center mb-5">
            <p className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1">Data</p>
            <p className="font-semibold text-sm capitalize">{formattedDate}</p>
          </div>

          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">
            Selecione seu nome para confirmar presença
          </p>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {employees.map(emp => (
              <button
                key={emp.id}
                disabled={!!successName || emp.confirmed || confirming === emp.id}
                onClick={() => confirm(emp.id)}
                className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left transition-all
                  ${emp.confirmed
                    ? 'bg-green-50 border-green-200 cursor-default'
                    : successName
                    ? 'opacity-30 cursor-not-allowed bg-gray-50 border-gray-100'
                    : confirming === emp.id
                    ? 'opacity-60 cursor-wait bg-[#F5F5F3] border-[#141414]/10'
                    : 'bg-[#F5F5F3] border-[#141414]/10 hover:border-[#141414]/25 hover:bg-[#EAEAE5] active:scale-[0.98]'
                  }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                    ${emp.confirmed ? 'bg-green-200 text-green-800' : 'bg-[#141414]/10 text-[#141414]'}`}>
                    {emp.name[0]}
                  </div>
                  <span className={`font-semibold text-sm ${emp.confirmed ? 'text-green-700' : 'text-[#141414]'}`}>
                    {emp.name}
                  </span>
                </div>
                {emp.confirmed && <span className="text-green-600 text-xs font-bold">✓ Confirmado</span>}
                {confirming === emp.id && <span className="text-gray-400 text-xs">Aguarde...</span>}
              </button>
            ))}
            {employees.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-6">Nenhum colaborador cadastrado.</p>
            )}
          </div>
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-4 px-4">
          Cada colaborador pode confirmar sua presença uma única vez por dia.
        </p>
      </div>
    </div>
  );
}
