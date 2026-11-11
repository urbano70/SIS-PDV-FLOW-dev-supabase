// Página pública do DANFE NF-e — sem autenticação, como /chamar/:tenantId/:tableId.
// URL: /danfe/nfe/:chaveAcesso?tenant=<tenantId>

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import DanfeNFe from '../components/fiscal/DanfeNFe';
import { extrairDadosDanfeNFe, type DadosDanfeNFe } from '../lib/fiscal/danfe-nfe';

export default function DanfeNFePage() {
  const { chaveAcesso } = useParams<{ chaveAcesso: string }>();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') ?? '';

  const [dados, setDados] = useState<DadosDanfeNFe | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!chaveAcesso || !tenantId) {
      setErro('Parâmetros ausentes na URL.');
      setCarregando(false);
      return;
    }
    fetch(`/api/fiscal/danfe/${chaveAcesso}?tenant=${encodeURIComponent(tenantId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setErro(d.error); return; }
        setDados(extrairDadosDanfeNFe(d.intencao));
      })
      .catch(e => setErro(e.message ?? 'Erro ao carregar DANFE'))
      .finally(() => setCarregando(false));
  }, [chaveAcesso, tenantId]);

  if (carregando) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif' }}>
        Carregando DANFE…
      </div>
    );
  }

  if (erro || !dados) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'sans-serif', color: '#c00' }}>
        {erro ?? 'DANFE não encontrado'}
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f4f4', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16, paddingBottom: 32 }}>
      {/* Barra de ações — oculta na impressão */}
      <div className="danfe-nfe-actions" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={() => window.print()}
          style={{ padding: '8px 20px', background: '#141414', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 13 }}
        >
          Imprimir / Salvar PDF
        </button>
      </div>

      {/* DANFE */}
      <div style={{ background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
        <DanfeNFe dados={dados} />
      </div>

      <style>{`
        @media print {
          .danfe-nfe-actions { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
