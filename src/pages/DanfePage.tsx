// Página pública do DANFE NFC-e — sem autenticação, como /chamar/:tenantId/:tableId.
// URL: /danfe/nfce/:chaveAcesso?tenant=<tenantId>

import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import DanfeNFCe from '../components/fiscal/DanfeNFCe';
import { extrairDadosDanfe, type DadosDanfe } from '../lib/fiscal/danfe-nfce';

export default function DanfePage() {
  const { chaveAcesso } = useParams<{ chaveAcesso: string }>();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('tenant') ?? '';
  const printRef = useRef<HTMLDivElement>(null);

  const [dados, setDados] = useState<DadosDanfe | null>(null);
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
        setDados(extrairDadosDanfe(d.intencao));
      })
      .catch(e => setErro(e.message ?? 'Erro ao carregar DANFE'))
      .finally(() => setCarregando(false));
  }, [chaveAcesso, tenantId]);

  const handlePrint = () => window.print();

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
    <div style={{ minHeight: '100vh', background: '#f4f4f4', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 16 }}>
      {/* Barra de ações — oculta na impressão */}
      <div className="danfe-actions" style={{ marginBottom: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={handlePrint}
          style={{ padding: '8px 20px', background: '#141414', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'sans-serif', fontSize: 13 }}
        >
          Imprimir / Salvar PDF
        </button>
      </div>

      {/* DANFE */}
      <div ref={printRef} style={{ background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
        <DanfeNFCe dados={dados} largura="80mm" />
      </div>

      <style>{`
        @media print {
          .danfe-actions { display: none !important; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
  );
}
