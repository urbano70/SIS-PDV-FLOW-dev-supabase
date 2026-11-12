// DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
// Layout conforme NT 2016.001 / MOC NFC-e 7.0
// Responsivo: 58mm ou 80mm (impressão térmica).

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DadosDanfe } from '../../lib/fiscal/danfe-nfce';

interface Props {
  dados: DadosDanfe;
  largura?: '58mm' | '80mm' | 'auto';
}

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const HR = () => (
  <div style={{ borderTop: '1px dashed #000', margin: '3px 0' }} />
);

export default function DanfeNFCe({ dados, largura = '80mm' }: Props) {
  const larguraStyle = largura === 'auto' ? {} : { width: largura };
  const qrSize = largura === '58mm' ? 110 : 150;

  const isHom = dados.ambiente === 'homologacao';

  // URL de consulta para impressão (use qrCodeUrl se disponível, senão urlConsulta)
  const urlImpressao = dados.qrCodeUrl || dados.urlConsulta;

  return (
    <>
      <style>{`
        @media print {
          body > *:not(#danfe-nfce-root) { display: none !important; }
          #danfe-nfce-root { display: block !important; }
          @page { margin: 0; size: ${largura === '58mm' ? '58mm' : '80mm'} auto; }
          .danfe-actions { display: none !important; }
          #danfe-nfce-root .qrcode-wrap { display: flex !important; justify-content: center !important; }
        }
        #danfe-nfce-root {
          font-family: 'Courier New', Courier, monospace;
          font-size: 9px;
          line-height: 1.4;
          color: #000;
          background: #fff;
        }
        #danfe-nfce-root .center { text-align: center; }
        #danfe-nfce-root .bold   { font-weight: bold; }
        #danfe-nfce-root .upper  { text-transform: uppercase; }
        #danfe-nfce-root .alerta-hom {
          background: #000; color: #fff;
          text-align: center; font-weight: bold;
          padding: 2px 4px; font-size: 7px;
          text-transform: uppercase; margin-bottom: 2px;
        }
      `}</style>

      <div id="danfe-nfce-root" style={{ ...larguraStyle, padding: '5px 6px', boxSizing: 'border-box' }}>

        {/* Alerta homologação */}
        {isHom && (
          <div className="alerta-hom">SEM VALOR FISCAL — HOMOLOGAÇÃO</div>
        )}

        {/* ── CABEÇALHO ─────────────────────────────────────── */}
        <div className="center bold" style={{ fontSize: 10, marginBottom: 1 }}>
          {dados.razaoSocial}
        </div>
        {dados.nomeFantasia && (
          <div className="center" style={{ fontSize: 8 }}>{dados.nomeFantasia}</div>
        )}

        <div className="center" style={{ fontSize: 8 }}>
          CNPJ: {dados.cnpjFormatado}&nbsp;&nbsp;IE: {dados.ie}
        </div>

        {dados.telefone && (
          <div className="center" style={{ fontSize: 8 }}>
            FONE: {dados.telefone}
          </div>
        )}

        <div className="center" style={{ fontSize: 8 }}>
          {dados.logradouro}, {dados.numero}
        </div>
        <div className="center" style={{ fontSize: 8 }}>
          {dados.bairro}, {dados.municipio}, {dados.uf}
        </div>

        <div className="center" style={{ fontSize: 8, margin: '3px 0 1px' }}>
          Documento Auxiliar da Nota Fiscal de<br />Consumidor Eletronica
        </div>

        {/* Mesa */}
        {dados.mesa && (
          <div className="center bold" style={{ fontSize: 10, marginTop: 2 }}>
            MESAS {dados.mesa}
          </div>
        )}

        <HR />

        {/* ── ITENS ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid #000', paddingBottom: 1, marginBottom: 2, fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' }}>
          <span style={{ flex: 1 }}>Cod / Descricao</span>
          <span style={{ width: '10%', textAlign: 'right' }}>Qtde</span>
          <span style={{ width: '7%', textAlign: 'center' }}>Un</span>
          <span style={{ width: '17%', textAlign: 'right' }}>Vl.Unit</span>
          <span style={{ width: '17%', textAlign: 'right' }}>Vl.Total</span>
        </div>

        {dados.itens.map(item => (
          <div key={item.seq} style={{ marginBottom: 3 }}>
            {/* Linha 1: código + descrição */}
            <div style={{ fontSize: 8 }}>
              <span style={{ fontWeight: 'bold' }}>{item.codigo}</span>
              {' '}{item.descricao}
            </div>
            {/* Linha 2: qtde / un / preços alinhados à direita */}
            <div style={{ display: 'flex', fontSize: 8 }}>
              <span style={{ flex: 1 }} />
              <span style={{ width: '10%', textAlign: 'right' }}>
                {item.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </span>
              <span style={{ width: '7%', textAlign: 'center' }}>{item.unidade}</span>
              <span style={{ width: '17%', textAlign: 'right' }}>{BRL(item.valorUnitario)}</span>
              <span style={{ width: '17%', textAlign: 'right' }}>{BRL(item.valorTotal)}</span>
            </div>
          </div>
        ))}

        <HR />

        {/* ── TOTAIS ────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
          <span>Qtde. total de itens</span>
          <span>{dados.itens.length}</span>
        </div>

        {dados.desconto > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
            <span>Desconto</span>
            <span>-R$ {BRL(dados.desconto)}</span>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 11, margin: '2px 0' }}>
          <span>VALOR TOTAL R$</span>
          <span>{BRL(dados.totalNota)}</span>
        </div>

        <HR />

        {/* ── PAGAMENTOS ────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', borderBottom: '1px solid #000', paddingBottom: 1, marginBottom: 2 }}>
          <span>Forma de Pagamento</span>
          <span>Valor Pago</span>
        </div>

        {dados.pagamentos.map((p, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8 }}>
            <span>{p.descricao}</span>
            <span>{BRL(p.valor)}</span>
          </div>
        ))}

        {dados.troco > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, fontWeight: 'bold' }}>
            <span>Troco</span>
            <span>{BRL(dados.troco)}</span>
          </div>
        )}

        <HR />

        {/* ── CONSULTA ──────────────────────────────────────── */}
        <div className="center" style={{ fontSize: 7 }}>
          Consulte pela Chave de Acesso em
        </div>
        {urlImpressao && (
          <div style={{ fontSize: 6, textAlign: 'center', wordBreak: 'break-all', margin: '1px 0 2px', color: '#000' }}>
            {urlImpressao}
          </div>
        )}

        {/* Chave formatada em grupos de 4 */}
        <div style={{ fontSize: 7, textAlign: 'center', wordBreak: 'break-all', letterSpacing: '0.5px', margin: '1px 0 3px' }}>
          {dados.chaveAcessoFormatada}
        </div>

        {/* Linha: NFC-e nº XXXX Serie X DD/MM/AAAA HH:MM:SS */}
        <div className="center" style={{ fontSize: 8 }}>
          NFC-e n&#186; {dados.nroNota} Serie {dados.serie} {dados.dhEmissao}
        </div>

        {/* Contingência */}
        {dados.contingencia && (
          <>
            <div className="center bold" style={{ fontSize: 9, marginTop: 2, textTransform: 'uppercase' }}>
              Emitida em Contingencia
            </div>
            <div className="center" style={{ fontSize: 8 }}>
              Pendente de autorizacao
            </div>
          </>
        )}

        {/* Protocolo (autorizado) */}
        {dados.protocolo && (
          <div className="center" style={{ fontSize: 7, marginTop: 1 }}>
            Protocolo: {dados.protocolo}
            {dados.dhProtocolo && ` - ${dados.dhProtocolo}`}
          </div>
        )}

        <HR />

        {/* ── CONSUMIDOR ────────────────────────────────────── */}
        {dados.xNomeConsumidor || dados.cpfConsumidor || dados.cnpjConsumidor ? (
          <div>
            {dados.xNomeConsumidor && (
              <div className="center" style={{ fontSize: 8 }}>{dados.xNomeConsumidor}</div>
            )}
            {dados.cpfConsumidor && (
              <div className="center" style={{ fontSize: 8 }}>CPF: {dados.cpfConsumidor}</div>
            )}
            {dados.cnpjConsumidor && (
              <div className="center" style={{ fontSize: 8 }}>CNPJ: {dados.cnpjConsumidor}</div>
            )}
          </div>
        ) : (
          <div className="center" style={{ fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase' }}>
            Consumidor Nao Identificado
          </div>
        )}

        {/* ── QR CODE ───────────────────────────────────────── */}
        {dados.qrCodeUrl ? (
          <div className="qrcode-wrap" style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
            <QRCodeSVG value={dados.qrCodeUrl} size={qrSize} includeMargin />
          </div>
        ) : (
          <div className="center" style={{ fontSize: 7, color: '#555', margin: '4px 0' }}>
            {dados.contingencia ? 'QR Code disponivel apos autorizacao SEFAZ' : 'QR Code indisponivel'}
          </div>
        )}

        {/* Observações */}
        {dados.observacoes && (
          <>
            <HR />
            <div style={{ fontSize: 7, textAlign: 'center' }}>{dados.observacoes}</div>
          </>
        )}

        {/* ── TRIBUTOS ──────────────────────────────────────── */}
        <div style={{ fontSize: 7, textAlign: 'center', marginTop: 2 }}>
          Tributos Totais Incidentes (Lei F) R$ 0,00
        </div>

        <div style={{ height: 6 }} />
      </div>
    </>
  );
}
