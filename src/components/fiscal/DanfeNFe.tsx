// DANFE NF-e — Documento Auxiliar da Nota Fiscal Eletrônica
// Layout A4 portrait conforme NT 2003.003 / MOC NF-e 7.0

import React from 'react';
import type { DadosDanfeNFe, ItemDanfeNFe } from '../../lib/fiscal/danfe-nfe';

interface Props {
  dados: DadosDanfeNFe;
}

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const N4 = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

// ── Primitivos de layout ──────────────────────────────────────────────────────

const BORDER = '1px solid #000';
const CELL_STYLE: React.CSSProperties = {
  border: BORDER, padding: '1px 3px', fontSize: 7, fontFamily: 'Arial, sans-serif', verticalAlign: 'top',
};
const LABEL_STYLE: React.CSSProperties = {
  fontSize: 6, color: '#000', textTransform: 'uppercase', display: 'block', letterSpacing: '0.3px',
};
const VALUE_STYLE: React.CSSProperties = {
  fontSize: 8, fontWeight: 'bold', display: 'block',
};

function Cell({ label, value, style }: { label: string; value?: string; style?: React.CSSProperties }) {
  return (
    <td style={{ ...CELL_STYLE, ...style }}>
      <span style={LABEL_STYLE}>{label}</span>
      <span style={VALUE_STYLE}>{value ?? ''}</span>
    </td>
  );
}

function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...CELL_STYLE, ...style }}>{children}</td>;
}

// ── Alerta faixa (homologação / contingência) ─────────────────────────────────

function Alerta({ msg }: { msg: string }) {
  return (
    <div style={{
      background: '#000', color: '#fff', textAlign: 'center',
      fontWeight: 'bold', fontSize: 9, padding: '3px 0', marginBottom: 2,
      fontFamily: 'Arial, sans-serif',
    }}>
      {msg}
    </div>
  );
}

// ── Cabeçalho ─────────────────────────────────────────────────────────────────

function Cabecalho({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER }}>
      <tbody>
        <tr>
          {/* Coluna DANFE label */}
          <td style={{ ...CELL_STYLE, width: '15%', textAlign: 'center', verticalAlign: 'middle', padding: 4 }}>
            <div style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'Arial', lineHeight: 1 }}>DANFE</div>
            <div style={{ fontSize: 6, marginTop: 2, lineHeight: 1.3, textTransform: 'uppercase' }}>
              Documento Auxiliar<br />da Nota Fiscal<br />Eletrônica
            </div>
          </td>

          {/* Coluna emitente */}
          <td style={{ ...CELL_STYLE, width: '65%', verticalAlign: 'middle', padding: '3px 6px' }}>
            <div style={{ fontSize: 10, fontWeight: 'bold' }}>{d.nomeFantasia || d.razaoSocial}</div>
            {d.nomeFantasia && <div style={{ fontSize: 7 }}>{d.razaoSocial}</div>}
            <div style={{ fontSize: 7 }}>{d.enderecoCompleto}</div>
            <div style={{ fontSize: 7 }}>{d.municipioUF} — CEP {d.cepFormatado}{d.fone ? ' — Fone: ' + d.fone : ''}</div>
            <div style={{ fontSize: 7, marginTop: 1 }}>CNPJ: {d.cnpjFormatado} &nbsp;&nbsp; IE: {d.ie}</div>
          </td>

          {/* Coluna NF-e nº */}
          <td style={{ ...CELL_STYLE, width: '20%', textAlign: 'center', verticalAlign: 'middle', padding: 3 }}>
            <div style={{ fontSize: 7, fontWeight: 'bold', borderBottom: BORDER, paddingBottom: 2, marginBottom: 2 }}>
              NF-e Nº {String(d.numero).padStart(9, '0')}
            </div>
            <div style={{ fontSize: 7 }}>Série {d.serie}</div>
            <div style={{ fontSize: 7, marginTop: 4 }}>Folha 1/1</div>
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', gap: 8 }}>
              {(['ENTRADA', 'SAÍDA'] as const).map(t => (
                <div key={t} style={{ textAlign: 'center', fontSize: 6 }}>
                  <div style={{
                    width: 14, height: 14, border: BORDER,
                    background: d.tpNF === t ? '#000' : '#fff',
                    display: 'inline-block',
                  }} />
                  <div style={{ color: d.tpNF === t ? '#000' : '#888', fontWeight: d.tpNF === t ? 'bold' : 'normal' }}>{t}</div>
                </div>
              ))}
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Natureza + Protocolo ──────────────────────────────────────────────────────

function NatOpProtocolo({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <tbody>
        <tr>
          <Td style={{ width: '55%' }}>
            <span style={LABEL_STYLE}>Natureza da Operação</span>
            <span style={VALUE_STYLE}>{d.natOp}</span>
          </Td>
          <Td style={{ width: '20%' }}>
            <span style={LABEL_STYLE}>Finalidade</span>
            <span style={VALUE_STYLE}>{d.finNFe}</span>
          </Td>
          <Td style={{ width: '25%' }}>
            <span style={LABEL_STYLE}>Protocolo de Autorização</span>
            <span style={{ ...VALUE_STYLE, fontSize: 7 }}>
              {d.protocolo
                ? `${d.protocolo}${d.dhProtocolo ? ' · ' + d.dhProtocolo : ''}`
                : (d.contingencia ? 'CONTINGÊNCIA — Aguard. SEFAZ' : 'Aguardando autorização')}
            </span>
          </Td>
        </tr>
        <tr>
          <Td>
            <span style={LABEL_STYLE}>Data e Hora de Emissão</span>
            <span style={VALUE_STYLE}>{d.dhEmissao}</span>
          </Td>
          <Td>
            <span style={LABEL_STYLE}>Data e Hora de Saída/Entrada</span>
            <span style={VALUE_STYLE}>{d.dhSaida || d.dhEmissao}</span>
          </Td>
          <Td>
            <span style={LABEL_STYLE}>Ambiente</span>
            <span style={{ ...VALUE_STYLE, color: d.ambiente === 'homologacao' ? '#c00' : '#000' }}>
              {d.ambiente === 'homologacao' ? 'HOMOLOGAÇÃO — SEM VALOR FISCAL' : 'Produção'}
            </span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Chave de acesso ───────────────────────────────────────────────────────────

function ChaveAcesso({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <tbody>
        <tr>
          <Td>
            <span style={LABEL_STYLE}>Chave de Acesso</span>
            <span style={{ fontSize: 8, fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', display: 'block' }}>
              {d.chaveAcessoFormatada}
            </span>
          </Td>
        </tr>
        <tr>
          <Td>
            <span style={{ fontSize: 7, color: '#333' }}>
              Consulte pela Chave de Acesso em: {d.urlConsulta || 'www.sefaz.mt.gov.br'}
            </span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Destinatário ──────────────────────────────────────────────────────────────

function Destinatario({ d }: { d: DadosDanfeNFe }) {
  const docDest = d.cnpjDestFormatado
    ? `CNPJ: ${d.cnpjDestFormatado}`
    : d.cpfDestFormatado
      ? `CPF: ${d.cpfDestFormatado}`
      : '—';

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <thead>
        <tr>
          <td colSpan={3} style={{ ...CELL_STYLE, background: '#eee', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>
            Destinatário / Remetente
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td style={{ width: '55%' }}>
            <span style={LABEL_STYLE}>Nome / Razão Social</span>
            <span style={VALUE_STYLE}>{d.xNomeDest || 'Consumidor Final'}</span>
          </Td>
          <Td style={{ width: '30%' }}>
            <span style={LABEL_STYLE}>CNPJ / CPF</span>
            <span style={VALUE_STYLE}>{docDest}</span>
          </Td>
          <Td style={{ width: '15%' }}>
            <span style={LABEL_STYLE}>Data de Emissão</span>
            <span style={VALUE_STYLE}>{d.dhEmissao.substring(0, 10)}</span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Cálculo do Imposto ────────────────────────────────────────────────────────

function CalcImposto({ d }: { d: DadosDanfeNFe }) {
  const t = d.totais;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <thead>
        <tr>
          <td colSpan={6} style={{ ...CELL_STYLE, background: '#eee', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>
            Cálculo do Imposto
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Cell label="Base de Cálculo ICMS"   value={`R$ ${BRL(t.vBC)}`}    style={{ width: '1%', whiteSpace: 'nowrap' }} />
          <Cell label="Valor do ICMS"           value={`R$ ${BRL(t.vICMS)}`}  style={{ width: '1%', whiteSpace: 'nowrap' }} />
          <Cell label="BC ICMS ST"              value={`R$ ${BRL(t.vBCST)}`}  style={{ width: '1%', whiteSpace: 'nowrap' }} />
          <Cell label="Valor ICMS ST"           value={`R$ ${BRL(t.vST)}`}    style={{ width: '1%', whiteSpace: 'nowrap' }} />
          <Cell label="Valor IPI"               value={`R$ ${BRL(t.vIPI)}`}   style={{ width: '1%', whiteSpace: 'nowrap' }} />
          <Cell label="Valor Total dos Produtos" value={`R$ ${BRL(t.vProd)}`} />
        </tr>
        <tr>
          <Cell label="Valor do Frete"    value={`R$ ${BRL(t.vFrete)}`} />
          <Cell label="Valor do Seguro"   value={`R$ ${BRL(t.vSeg)}`} />
          <Cell label="Desconto"          value={`R$ ${BRL(t.vDesc)}`} />
          <Cell label="Outras Despesas"   value={`R$ ${BRL(t.vOutro)}`} />
          <Cell label="Valor Total NF"    value={`R$ ${BRL(t.vNF)}`} style={{ fontWeight: 'bold' }} />
          <Cell label="Trib. Aprox. Total" value={`R$ ${BRL(t.vTotTrib)}`} />
        </tr>
      </tbody>
    </table>
  );
}

// ── Transportador ─────────────────────────────────────────────────────────────

function Transportador() {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <thead>
        <tr>
          <td colSpan={4} style={{ ...CELL_STYLE, background: '#eee', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>
            Transportador / Volumes Transportados
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td style={{ width: '20%' }}>
            <span style={LABEL_STYLE}>Frete por conta de</span>
            <span style={VALUE_STYLE}>9 - Sem frete</span>
          </Td>
          <Td style={{ width: '30%' }}>
            <span style={LABEL_STYLE}>Nome / Razão Social</span>
            <span style={VALUE_STYLE}> </span>
          </Td>
          <Td style={{ width: '25%' }}>
            <span style={LABEL_STYLE}>CNPJ</span>
            <span style={VALUE_STYLE}> </span>
          </Td>
          <Td style={{ width: '25%' }}>
            <span style={LABEL_STYLE}>Inscrição Estadual</span>
            <span style={VALUE_STYLE}> </span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Tabela de itens ───────────────────────────────────────────────────────────

function TabelaItens({ d }: { d: DadosDanfeNFe }) {
  const temICMS = d.itens.some(i => !i.isSimples);

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none', fontSize: 7 }}>
      <thead>
        <tr style={{ background: '#eee' }}>
          <th style={{ ...CELL_STYLE, textAlign: 'center', width: '4%' }}>Nº</th>
          <th style={{ ...CELL_STYLE, width: '8%' }}>Código</th>
          <th style={{ ...CELL_STYLE }}>Descrição do Produto / Serviço</th>
          <th style={{ ...CELL_STYLE, width: '7%' }}>NCM/SH</th>
          <th style={{ ...CELL_STYLE, width: '5%' }}>O/CST</th>
          <th style={{ ...CELL_STYLE, width: '5%' }}>CFOP</th>
          <th style={{ ...CELL_STYLE, width: '4%' }}>Un</th>
          <th style={{ ...CELL_STYLE, width: '7%', textAlign: 'right' }}>Qtd</th>
          <th style={{ ...CELL_STYLE, width: '9%', textAlign: 'right' }}>Vl.Unit</th>
          <th style={{ ...CELL_STYLE, width: '9%', textAlign: 'right' }}>Vl.Total</th>
          {temICMS && <>
            <th style={{ ...CELL_STYLE, width: '7%', textAlign: 'right' }}>BC ICMS</th>
            <th style={{ ...CELL_STYLE, width: '7%', textAlign: 'right' }}>Vl.ICMS</th>
            <th style={{ ...CELL_STYLE, width: '5%', textAlign: 'right' }}>%ICMS</th>
          </>}
        </tr>
      </thead>
      <tbody>
        {d.itens.map((item: ItemDanfeNFe) => (
          <tr key={item.seq}>
            <td style={{ ...CELL_STYLE, textAlign: 'center' }}>{item.seq}</td>
            <td style={CELL_STYLE}>{item.codigo}</td>
            <td style={CELL_STYLE}>{item.descricao}</td>
            <td style={CELL_STYLE}>{item.ncm}</td>
            <td style={CELL_STYLE}>{item.origem}/{item.cstOuCsosn}</td>
            <td style={CELL_STYLE}>{item.cfop}</td>
            <td style={CELL_STYLE}>{item.unidade}</td>
            <td style={{ ...CELL_STYLE, textAlign: 'right' }}>{N4(item.quantidade)}</td>
            <td style={{ ...CELL_STYLE, textAlign: 'right' }}>{BRL(item.valorUnitario)}</td>
            <td style={{ ...CELL_STYLE, textAlign: 'right', fontWeight: 'bold' }}>{BRL(item.valorTotal)}</td>
            {temICMS && <>
              <td style={{ ...CELL_STYLE, textAlign: 'right' }}>{item.isSimples ? '' : BRL(item.bcICMS)}</td>
              <td style={{ ...CELL_STYLE, textAlign: 'right' }}>{item.isSimples ? '' : BRL(item.vICMS)}</td>
              <td style={{ ...CELL_STYLE, textAlign: 'right' }}>{item.isSimples ? '' : item.pICMS + '%'}</td>
            </>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Pagamentos ────────────────────────────────────────────────────────────────

function Pagamentos({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <thead>
        <tr>
          <td colSpan={3} style={{ ...CELL_STYLE, background: '#eee', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>
            Forma de Pagamento
          </td>
        </tr>
      </thead>
      <tbody>
        {d.pagamentos.map((p, i) => (
          <tr key={i}>
            <td style={{ ...CELL_STYLE, width: '50%' }}>
              <span style={LABEL_STYLE}>Forma</span>
              <span style={VALUE_STYLE}>{p.descricao}</span>
            </td>
            <td style={{ ...CELL_STYLE, width: '25%', textAlign: 'right' }}>
              <span style={LABEL_STYLE}>Valor</span>
              <span style={VALUE_STYLE}>R$ {BRL(p.valor)}</span>
            </td>
            <td style={{ ...CELL_STYLE, width: '25%' }} />
          </tr>
        ))}
        <tr>
          <td style={{ ...CELL_STYLE, fontWeight: 'bold', textAlign: 'right' }} colSpan={2}>
            Troco: R$ {BRL(Math.max(0, d.totalPago - d.totais.vNF))}
          </td>
          <td style={CELL_STYLE} />
        </tr>
      </tbody>
    </table>
  );
}

// ── Dados adicionais ──────────────────────────────────────────────────────────

function DadosAdicionais({ d }: { d: DadosDanfeNFe }) {
  if (!d.observacoes) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', border: BORDER, borderTop: 'none' }}>
      <thead>
        <tr>
          <td colSpan={2} style={{ ...CELL_STYLE, background: '#eee', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' }}>
            Dados Adicionais
          </td>
        </tr>
      </thead>
      <tbody>
        <tr>
          <Td style={{ width: '65%', minHeight: 32 }}>
            <span style={LABEL_STYLE}>Informações Complementares</span>
            <span style={{ fontSize: 7, display: 'block', marginTop: 2, whiteSpace: 'pre-wrap' }}>{d.observacoes}</span>
          </Td>
          <Td style={{ width: '35%', minHeight: 32 }}>
            <span style={LABEL_STYLE}>Reservado ao Fisco</span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function DanfeNFe({ dados }: Props) {
  return (
    <>
      <style>{`
        @media print {
          body > *:not(#danfe-nfe-root) { display: none !important; }
          #danfe-nfe-root { display: block !important; }
          @page { margin: 8mm; size: A4 portrait; }
          .danfe-nfe-actions { display: none !important; }
        }
        #danfe-nfe-root { background: #fff; }
      `}</style>

      <div id="danfe-nfe-root" style={{ width: '210mm', minHeight: '297mm', background: '#fff', padding: 0, boxSizing: 'border-box', fontFamily: 'Arial, sans-serif' }}>

        {dados.ambiente === 'homologacao' && (
          <Alerta msg="SEM VALOR FISCAL — DOCUMENTO EMITIDO EM HOMOLOGAÇÃO" />
        )}
        {dados.contingencia && (
          <Alerta msg="EMITIDO EM CONTINGÊNCIA — AGUARDANDO TRANSMISSÃO SEFAZ" />
        )}

        <Cabecalho d={dados} />
        <NatOpProtocolo d={dados} />
        <ChaveAcesso d={dados} />
        <Destinatario d={dados} />
        <CalcImposto d={dados} />
        <Transportador />
        <TabelaItens d={dados} />
        <Pagamentos d={dados} />
        <DadosAdicionais d={dados} />

        {/* Rodapé discreto */}
        <div style={{ marginTop: 4, fontSize: 6, textAlign: 'center', color: '#666', fontFamily: 'Arial' }}>
          NF-e nº {String(dados.numero).padStart(9, '0')} · Série {dados.serie} · Chave: {dados.chaveAcesso}
        </div>
      </div>
    </>
  );
}
