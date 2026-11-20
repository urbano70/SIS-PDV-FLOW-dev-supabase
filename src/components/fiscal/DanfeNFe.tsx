// DANFE NF-e — NT 2026.010 (Reforma Tributária) — Modelo 55, retrato A4
// Layout: cabeçalho com barcode Code 128 (jsbarcode), conforme DANFE tradicional

import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import type { DadosDanfeNFe, ItemDanfeNFe } from '../../lib/fiscal/danfe-nfe';

interface Props { dados: DadosDanfeNFe; }

const BRL = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const N4  = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });

const BD: React.CSSProperties = { border: '1px solid #000' };
const CELL: React.CSSProperties = { ...BD, padding: '1px 3px', fontSize: 7, fontFamily: 'Arial,sans-serif', verticalAlign: 'top' };
const LBL: React.CSSProperties  = { fontSize: 6, textTransform: 'uppercase', display: 'block', letterSpacing: '0.3px' };
const VAL: React.CSSProperties  = { fontSize: 8, fontWeight: 'bold', display: 'block' };
const HDR: React.CSSProperties  = { ...CELL, background: '#ddd', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', textAlign: 'center' };

const CRT_LABEL: Record<string, string> = {
  '1': 'Simples Nacional', '2': 'Simples Nacional – Exc.', '3': 'Regime Normal', '4': 'Simples Nacional – SIMEI',
};

function Cell({ label, value, style }: { label: string; value?: string; style?: React.CSSProperties }) {
  return (
    <td style={{ ...CELL, ...style }}>
      <span style={LBL}>{label}</span>
      <span style={VAL}>{value ?? ''}</span>
    </td>
  );
}
function Td({ children, style }: { children?: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ ...CELL, ...style }}>{children}</td>;
}
function SectionHead({ cols, title }: { cols: number; title: string }) {
  return <tr><td colSpan={cols} style={HDR}>{title}</td></tr>;
}

// ── Código de barras Code 128 ─────────────────────────────────────────────────
function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current && value) {
      try {
        JsBarcode(ref.current, value, {
          format: 'CODE128',
          width: 1,
          height: 40,
          displayValue: false,
          margin: 0,
          background: '#ffffff',
          lineColor: '#000000',
        });
      } catch { /* chave inválida — ignora */ }
    }
  }, [value]);
  return <svg ref={ref} style={{ width: '100%', height: 40 }} />;
}

// ── Faixa alerta ──────────────────────────────────────────────────────────────
function Alerta({ msg }: { msg: string }) {
  return (
    <div style={{ background: '#000', color: '#fff', textAlign: 'center', fontWeight: 'bold', fontSize: 9, padding: '3px 0', marginBottom: 2, fontFamily: 'Arial,sans-serif' }}>
      {msg}
    </div>
  );
}

// ── Canhoto ───────────────────────────────────────────────────────────────────
function Canhoto({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, marginBottom: 0 }}>
      <tbody>
        <tr>
          <Td style={{ width: '75%' }}>
            <span style={LBL}>
              Recebemos de {d.nomeFantasia || d.razaoSocial} os produtos/serviços constantes da Nota Fiscal Eletrônica indicada ao lado.
              Emissão: {d.dhEmissao.substring(0, 10)} &nbsp; Dest./Reme.: {d.xNomeDest || 'Consumidor Final'} &nbsp; Valor Total: {BRL(d.totais.vNF)}
            </span>
            <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
              <span style={LBL}>Data do Recebimento: ___/___/______</span>
              <span style={LBL}>Identificação e Assinatura do Recebedor:</span>
            </div>
          </Td>
          <Td style={{ width: '25%', textAlign: 'center', verticalAlign: 'middle' }}>
            <div style={{ fontSize: 12, fontWeight: 'bold', fontFamily: 'Arial', borderBottom: '1px solid #000', paddingBottom: 2, marginBottom: 2 }}>NF-e</div>
            <div style={{ fontSize: 7 }}>Nº {String(d.numero).padStart(9, '0')}</div>
            <div style={{ fontSize: 7 }}>Série {d.serie}</div>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Cabeçalho (emitente | DANFE+barcode+chave | NF-e#) ──────────────────────
function Cabecalho({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <tbody>
        <tr>
          {/* Emitente */}
          <td style={{ ...CELL, width: '38%', verticalAlign: 'middle', padding: '4px 6px' }}>
            <div style={{ fontSize: 10, fontWeight: 'bold' }}>{d.nomeFantasia || d.razaoSocial}</div>
            {d.nomeFantasia && <div style={{ fontSize: 7 }}>{d.razaoSocial}</div>}
            <div style={{ fontSize: 7, marginTop: 1 }}>{d.enderecoCompleto}</div>
            <div style={{ fontSize: 7 }}>{d.municipioUF} — CEP {d.cepFormatado}</div>
            {d.fone && <div style={{ fontSize: 7 }}>Fone: {d.fone}</div>}
            <div style={{ fontSize: 7, marginTop: 1 }}>CNPJ: {d.cnpjFormatado}</div>
            <div style={{ fontSize: 7 }}>IE: {d.ie}</div>
          </td>

          {/* DANFE label + barcode + chave de acesso */}
          <td style={{ ...CELL, width: '42%', textAlign: 'center', verticalAlign: 'top', padding: '4px 6px' }}>
            <div style={{ fontSize: 18, fontWeight: 'bold', fontFamily: 'Arial', lineHeight: 1 }}>DANFE</div>
            <div style={{ fontSize: 6, marginTop: 1, lineHeight: 1.4, textTransform: 'uppercase' }}>
              Documento Auxiliar da Nota Fiscal Eletrônica
            </div>
            <div style={{ fontSize: 7, marginTop: 3 }}>
              <span style={{ marginRight: 8 }}>0 – ENTRADA</span>
              <span>1 – SAÍDA</span>
            </div>
            <div style={{ fontSize: 7, fontWeight: 'bold' }}>Nº {String(d.numero).padStart(9, '0')}</div>
            <div style={{ fontSize: 7 }}>Série {d.serie} &nbsp; Folha 1/1</div>
            {/* Código de barras Code 128 da chave de acesso */}
            {d.chaveAcesso && (
              <div style={{ marginTop: 4, padding: '0 4px' }}>
                <Barcode value={d.chaveAcesso} />
              </div>
            )}
            <div style={{ marginTop: 2 }}>
              <span style={LBL}>Chave de Acesso</span>
              <div style={{ fontSize: 7, fontFamily: 'Courier New, monospace', letterSpacing: '0.3px', marginTop: 1 }}>
                {d.chaveAcessoFormatada}
              </div>
            </div>
            <div style={{ fontSize: 6, color: '#333', marginTop: 2 }}>
              Consulte a autenticidade em: {d.urlConsulta || 'www.sefaz.mt.gov.br'}
            </div>
          </td>

          {/* NF-e Nº (canto superior direito) */}
          <td style={{ ...CELL, width: '20%', textAlign: 'center', verticalAlign: 'top', padding: 4 }}>
            <div style={{ fontSize: 10, fontWeight: 'bold', fontFamily: 'Arial', borderBottom: '1px solid #000', paddingBottom: 2, marginBottom: 2 }}>NF-e</div>
            <div style={{ fontSize: 8, fontWeight: 'bold' }}>Nº {String(d.numero).padStart(9, '0')}</div>
            <div style={{ fontSize: 7 }}>Série {d.serie}</div>
            <div style={{ fontSize: 7, marginTop: 2 }}>Folha 1/1</div>
            {/* Entrada / Saída */}
            <div style={{ marginTop: 6, display: 'flex', justifyContent: 'center', gap: 8 }}>
              {(['ENTRADA', 'SAÍDA'] as const).map(t => (
                <div key={t} style={{ textAlign: 'center', fontSize: 6 }}>
                  <div style={{ width: 12, height: 12, border: '1px solid #000', background: d.tpNF === t ? '#000' : '#fff', display: 'inline-block' }} />
                  <div style={{ color: d.tpNF === t ? '#000' : '#888', fontWeight: d.tpNF === t ? 'bold' : 'normal' }}>{t}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 6, marginTop: 6, color: '#444', lineHeight: 1.3 }}>
              {CRT_LABEL[d.crt] || `CRT ${d.crt}`}
            </div>
          </td>
        </tr>
        {/* Chave de acesso */}
        <tr>
          <td colSpan={3} style={{ ...CELL }}>
            <span style={LBL}>Chave de Acesso</span>
            <span style={{ fontSize: 8, fontFamily: 'Courier New, monospace', letterSpacing: '0.5px', display: 'block' }}>
              {d.chaveAcessoFormatada}
            </span>
            <span style={{ fontSize: 6, color: '#333', display: 'block', marginTop: 1 }}>
              Consulte a autenticidade em: {d.urlConsulta || 'www.sefaz.mt.gov.br'}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Natureza + Protocolo + IE/CNPJ/CRT ───────────────────────────────────────
function NatOp({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <tbody>
        <tr>
          <Td style={{ width: '45%' }}>
            <span style={LBL}>Natureza da Operação</span>
            <span style={VAL}>{d.natOp}</span>
          </Td>
          <Td style={{ width: '15%' }}>
            <span style={LBL}>Finalidade</span>
            <span style={VAL}>{d.finNFe}</span>
          </Td>
          <Td style={{ width: '40%' }}>
            <span style={LBL}>Protocolo de Autorização de Uso</span>
            <span style={{ ...VAL, fontSize: 7 }}>
              {d.protocolo
                ? `${d.protocolo}${d.dhProtocolo ? ' · ' + d.dhProtocolo : ''}`
                : (d.contingencia ? 'CONTINGÊNCIA — Aguard. SEFAZ' : 'Aguardando autorização')}
            </span>
          </Td>
        </tr>
        <tr>
          <Td>
            <span style={LBL}>Data e Hora de Emissão</span>
            <span style={VAL}>{d.dhEmissao}</span>
          </Td>
          <Td>
            <span style={LBL}>Data e Hora de Saída/Entrada</span>
            <span style={VAL}>{d.dhSaida || d.dhEmissao}</span>
          </Td>
          <Td>
            <span style={LBL}>Ambiente</span>
            <span style={{ ...VAL, color: d.ambiente === 'homologacao' ? '#c00' : '#000' }}>
              {d.ambiente === 'homologacao' ? 'HOMOLOGAÇÃO — SEM VALOR FISCAL' : 'Produção'}
            </span>
          </Td>
        </tr>
        <tr>
          <Cell label="Inscrição Estadual" value={d.ie} />
          <Cell label="CNPJ / CPF" value={d.cnpjFormatado} />
          <Td>
            <span style={LBL}>Código do Regime Tributário</span>
            <span style={VAL}>{d.crt} – {CRT_LABEL[d.crt] || ''}</span>
          </Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Destinatário ──────────────────────────────────────────────────────────────
function Destinatario({ d }: { d: DadosDanfeNFe }) {
  const docDest = d.cnpjDestFormatado ? `CNPJ: ${d.cnpjDestFormatado}` : d.cpfDestFormatado ? `CPF: ${d.cpfDestFormatado}` : '—';
  const end = d.endDest;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={4} title="Destinatário / Remetente" /></thead>
      <tbody>
        <tr>
          <Td style={{ width: '50%' }}>
            <span style={LBL}>Nome / Razão Social</span>
            <span style={VAL}>{d.xNomeDest || 'Consumidor Final'}</span>
          </Td>
          <Td style={{ width: '30%' }}>
            <span style={LBL}>CNPJ / CPF</span>
            <span style={VAL}>{docDest}</span>
          </Td>
          <Td style={{ width: '20%' }}>
            <span style={LBL}>Data de Emissão</span>
            <span style={VAL}>{d.dhEmissao.substring(0, 10)}</span>
          </Td>
        </tr>
        {end?.logradouro && (
          <tr>
            <Td style={{ width: '50%' }}>
              <span style={LBL}>Endereço</span>
              <span style={VAL}>{end.logradouro}{end.numero ? ', ' + end.numero : ''}</span>
            </Td>
            <Td style={{ width: '15%' }}>
              <span style={LBL}>Bairro / Distrito</span>
              <span style={VAL}>{end.bairro || ''}</span>
            </Td>
            <Td style={{ width: '15%' }}>
              <span style={LBL}>CEP</span>
              <span style={VAL}>{end.cep || ''}</span>
            </Td>
            <Td style={{ width: '20%' }}>
              <span style={LBL}>Data Entrada/Saída</span>
              <span style={VAL}>{d.dhSaida || d.dhEmissao}</span>
            </Td>
          </tr>
        )}
        {end?.municipio && (
          <tr>
            <Td style={{ width: '35%' }}>
              <span style={LBL}>Município</span>
              <span style={VAL}>{end.municipio}</span>
            </Td>
            <Td style={{ width: '15%' }}>
              <span style={LBL}>Fone / Fax</span>
              <span style={VAL}>{end.telefone || ''}</span>
            </Td>
            <Td style={{ width: '10%' }}>
              <span style={LBL}>UF</span>
              <span style={VAL}>{end.uf || ''}</span>
            </Td>
            <Td style={{ width: '20%' }}>
              <span style={LBL}>Inscrição Estadual</span>
              <span style={VAL}>{d.ieDest || ''}</span>
            </Td>
            <Td style={{ width: '20%' }}>
              <span style={LBL}>Hora de Saída</span>
              <span style={VAL}>{(d.dhSaida || d.dhEmissao).substring(11, 16)}</span>
            </Td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

// ── Total dos Produtos e Total da Nota ───────────────────────────────────────
function TotalProdutos({ d }: { d: DadosDanfeNFe }) {
  const t = d.totais;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={6} title="Total dos Produtos e Total da Nota" /></thead>
      <tbody>
        <tr>
          <Cell label="Valor Total dos Produtos" value={`R$ ${BRL(t.vProd)}`} />
          <Cell label="Valor do Frete"           value={`R$ ${BRL(t.vFrete)}`} />
          <Cell label="Valor do Seguro"          value={`R$ ${BRL(t.vSeg)}`} />
          <Cell label="Desconto"                 value={`R$ ${BRL(t.vDesc)}`} />
          <Cell label="Outras Despesas"          value={`R$ ${BRL(t.vOutro)}`} />
          <Cell label="Valor Total da Nota"      value={`R$ ${BRL(t.vNF)}`} style={{ fontWeight: 'bold' }} />
        </tr>
      </tbody>
    </table>
  );
}

// ── Total do ICMS / IPI ───────────────────────────────────────────────────────
function TotalICMS({ d }: { d: DadosDanfeNFe }) {
  const t = d.totais;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={6} title="Total do ICMS / IPI" /></thead>
      <tbody>
        <tr>
          <Cell label="Base de Cálculo ICMS"  value={`R$ ${BRL(t.vBC)}`} />
          <Cell label="Valor do ICMS"         value={`R$ ${BRL(t.vICMS)}`} />
          <Cell label="BC ICMS ST"            value={`R$ ${BRL(t.vBCST)}`} />
          <Cell label="Valor ICMS ST"         value={`R$ ${BRL(t.vST)}`} />
          <Cell label="Valor IPI"             value={`R$ ${BRL(t.vIPI)}`} />
          <Cell label="Trib. Aprox. Total"    value={`R$ ${BRL(t.vTotTrib)}`} />
        </tr>
        <tr>
          <Cell label="Valor do FCP"              value="R$ 0,00" />
          <Cell label="Valor FCP retido por ST"   value="R$ 0,00" />
          <Cell label="Valor DIFAL na UF dest."   value="R$ 0,00" />
          <Cell label="Valor FCP na UF dest."     value="R$ 0,00" />
          <Cell label="BC ICMS Monofásico"        value="R$ 0,00" />
          <Cell label="Valor ICMS Monofásico"     value="R$ 0,00" />
        </tr>
      </tbody>
    </table>
  );
}

// ── Total do IBS / CBS / IS (NT 2026.010) ────────────────────────────────────
function TotalIBSCBS({ d }: { d: DadosDanfeNFe }) {
  const r = d.ibscbs;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={4} title="Total do IBS / CBS / IS" /></thead>
      <tbody>
        <tr>
          <Cell label="Valor da CBS"             value={`R$ ${BRL(r.vCBS)}`} />
          <Cell label="Valor do IBS UF"          value={`R$ ${BRL(r.vIBSUF)}`} />
          <Cell label="Valor do IBS Município"   value={`R$ ${BRL(r.vIBSMun)}`} />
          <Cell label="Valor do Imposto Seletivo" value={`R$ ${BRL(r.vIS)}`} />
        </tr>
        <tr>
          <Cell label="Valor IBS Monofásico"           value="R$ 0,00" />
          <Cell label="Valor CBS Monofásica"           value="R$ 0,00" />
          <Cell label="Valor IBS Monof. por Retenção"  value="R$ 0,00" />
          <Cell label="Valor CBS Monof. por Retenção"  value="R$ 0,00" />
        </tr>
      </tbody>
    </table>
  );
}

// ── Transportador ─────────────────────────────────────────────────────────────
function Transportador() {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={4} title="Transportador / Volumes Transportados" /></thead>
      <tbody>
        <tr>
          <Td style={{ width: '20%' }}><span style={LBL}>Frete por Conta de</span><span style={VAL}>9 – Sem frete</span></Td>
          <Td style={{ width: '30%' }}><span style={LBL}>Nome / Razão Social</span><span style={VAL}> </span></Td>
          <Td style={{ width: '25%' }}><span style={LBL}>CNPJ</span><span style={VAL}> </span></Td>
          <Td style={{ width: '25%' }}><span style={LBL}>Inscrição Estadual</span><span style={VAL}> </span></Td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Dados dos Produtos / Serviços ─────────────────────────────────────────────
function TabelaItens({ d }: { d: DadosDanfeNFe }) {
  const temICMS = d.itens.some(i => !i.isSimples);
  const temIBS  = d.ibscbs.vCBS + d.ibscbs.vIBSUF + d.ibscbs.vIBSMun + d.ibscbs.vIS > 0;

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none', fontSize: 7 }}>
      <thead>
        <SectionHead cols={temICMS || temIBS ? 12 : 9} title="Dados dos Produtos / Serviços" />
        <tr style={{ background: '#eee' }}>
          <th style={{ ...CELL, textAlign: 'center', width: '3%' }}>Nº</th>
          <th style={{ ...CELL, width: '7%' }}>Código</th>
          <th style={CELL}>Descrição do Produto / Serviço</th>
          <th style={{ ...CELL, width: '7%' }}>NCM/SH</th>
          <th style={{ ...CELL, width: '5%' }}>CST/<br />CFOP</th>
          <th style={{ ...CELL, width: '4%' }}>Un</th>
          <th style={{ ...CELL, width: '7%', textAlign: 'right' }}>QTD</th>
          <th style={{ ...CELL, width: '9%', textAlign: 'right' }}>Vl.Unit</th>
          <th style={{ ...CELL, width: '9%', textAlign: 'right' }}>Vl.Total</th>
          {temICMS && <>
            <th style={{ ...CELL, width: '7%', textAlign: 'right' }}>BC<br />ICMS</th>
            <th style={{ ...CELL, width: '7%', textAlign: 'right' }}>Vl.<br />ICMS</th>
            <th style={{ ...CELL, width: '5%', textAlign: 'right' }}>%<br />ICMS</th>
          </>}
          {temIBS && <>
            <th style={{ ...CELL, width: '8%', textAlign: 'right' }}>Vl.CBS/<br />IBS</th>
            <th style={{ ...CELL, width: '5%', textAlign: 'right' }}>Vl.IS</th>
          </>}
        </tr>
      </thead>
      <tbody>
        {d.itens.map((item: ItemDanfeNFe) => (
          <tr key={item.seq}>
            <td style={{ ...CELL, textAlign: 'center' }}>{item.seq}</td>
            <td style={CELL}>{item.codigo}</td>
            <td style={CELL}>{item.descricao}</td>
            <td style={CELL}>{item.ncm}</td>
            <td style={CELL}>{item.origem}/{item.cstOuCsosn}<br />{item.cfop}</td>
            <td style={CELL}>{item.unidade}</td>
            <td style={{ ...CELL, textAlign: 'right' }}>{N4(item.quantidade)}</td>
            <td style={{ ...CELL, textAlign: 'right' }}>{BRL(item.valorUnitario)}</td>
            <td style={{ ...CELL, textAlign: 'right', fontWeight: 'bold' }}>{BRL(item.valorTotal)}</td>
            {temICMS && <>
              <td style={{ ...CELL, textAlign: 'right' }}>{item.isSimples ? '' : BRL(item.bcICMS)}</td>
              <td style={{ ...CELL, textAlign: 'right' }}>{item.isSimples ? '' : BRL(item.vICMS)}</td>
              <td style={{ ...CELL, textAlign: 'right' }}>{item.isSimples ? '' : item.pICMS + '%'}</td>
            </>}
            {temIBS && <>
              <td style={{ ...CELL, textAlign: 'right' }}>–</td>
              <td style={{ ...CELL, textAlign: 'right' }}>–</td>
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
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={3} title="Forma de Pagamento" /></thead>
      <tbody>
        {d.pagamentos.map((p, i) => (
          <tr key={i}>
            <td style={{ ...CELL, width: '55%' }}><span style={LBL}>Forma</span><span style={VAL}>{p.descricao}</span></td>
            <td style={{ ...CELL, width: '20%', textAlign: 'right' }}><span style={LBL}>Valor</span><span style={VAL}>R$ {BRL(p.valor)}</span></td>
            <td style={CELL} />
          </tr>
        ))}
        <tr>
          <td colSpan={2} style={{ ...CELL, fontWeight: 'bold', textAlign: 'right' }}>
            Troco: R$ {BRL(Math.max(0, d.totalPago - d.totais.vNF))}
          </td>
          <td style={CELL} />
        </tr>
      </tbody>
    </table>
  );
}

// ── Dados Adicionais + QR Code ────────────────────────────────────────────────
function DadosAdicionais({ d }: { d: DadosDanfeNFe }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', ...BD, borderTop: 'none' }}>
      <thead><SectionHead cols={3} title="Dados Adicionais" /></thead>
      <tbody>
        <tr>
          <Td style={{ width: '55%', minHeight: 36 }}>
            <span style={LBL}>Informações Complementares</span>
            <span style={{ fontSize: 7, display: 'block', marginTop: 2, whiteSpace: 'pre-wrap' }}>
              {d.observacoes || ''}
            </span>
          </Td>
          <Td style={{ width: '25%', minHeight: 36 }}>
            <span style={LBL}>Reservado ao Fisco</span>
          </Td>
          <Td style={{ width: '20%', textAlign: 'center', verticalAlign: 'middle' }}>
            <span style={LBL}>QR Code</span>
            {/* QR Code — NT a ser publicada (NT 2026.010 §4.5) */}
            <div style={{ width: 60, height: 60, border: '1px dashed #aaa', margin: '2px auto', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 5, color: '#aaa', textAlign: 'center' }}>NT §4.5<br />(pendente)</span>
            </div>
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
          @page { margin: 8mm; size: A4 portrait; }
          .danfe-nfe-actions { display: none !important; }
        }
        #danfe-nfe-root { background: #fff; }
      `}</style>

      <div id="danfe-nfe-root" style={{ width: '210mm', minHeight: '297mm', background: '#fff', padding: 0, boxSizing: 'border-box', fontFamily: 'Arial,sans-serif' }}>

        {dados.ambiente === 'homologacao' && (
          <Alerta msg="SEM VALOR FISCAL — DOCUMENTO EMITIDO EM HOMOLOGAÇÃO" />
        )}
        {dados.contingencia && (
          <Alerta msg="EMITIDO EM CONTINGÊNCIA — AGUARDANDO TRANSMISSÃO SEFAZ" />
        )}

        <Canhoto d={dados} />
        <Cabecalho d={dados} />
        <NatOp d={dados} />
        <Destinatario d={dados} />
        <TotalProdutos d={dados} />
        <TotalICMS d={dados} />
        <TotalIBSCBS d={dados} />
        <Transportador />
        <TabelaItens d={dados} />
        <Pagamentos d={dados} />
        <DadosAdicionais d={dados} />

        <div style={{ marginTop: 4, fontSize: 6, textAlign: 'center', color: '#666', fontFamily: 'Arial' }}>
          NF-e nº {String(dados.numero).padStart(9, '0')} · Série {dados.serie} · Chave: {dados.chaveAcesso}
        </div>
      </div>
    </>
  );
}
