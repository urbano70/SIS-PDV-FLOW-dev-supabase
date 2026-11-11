// DANFE NFC-e — Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
// Layout conforme NT 2016.001 / MOC NFC-e 7.0
// Responsivo: 58mm (browser/impressão térmica) ou largura livre (pré-visualização).

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { DadosDanfe } from '../../lib/fiscal/danfe-nfce';

interface Props {
  dados: DadosDanfe;
  largura?: '58mm' | '80mm' | 'auto';
}

const BRL = (v: number) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const Linha: React.FC<{ label: string; valor: string; negrito?: boolean }> = ({ label, valor, negrito }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
    <span>{label}</span>
    <span style={{ fontWeight: negrito ? 'bold' : undefined }}>{valor}</span>
  </div>
);

const HR = () => (
  <hr style={{ borderTop: '1px dashed #000', margin: '4px 0', borderBottom: 'none', borderLeft: 'none', borderRight: 'none' }} />
);

export default function DanfeNFCe({ dados, largura = '80mm' }: Props) {
  const larguraStyle = largura === 'auto' ? {} : { width: largura };
  const qrSize = largura === '58mm' ? 120 : 160;

  const isHom = dados.ambiente === 'homologacao';
  const isOk = !!dados.protocolo;

  return (
    <>
      {/* CSS isolado — inline para funcionar em impressão e em modal */}
      <style>{`
        @media print {
          body > *:not(#danfe-nfce-root) { display: none !important; }
          #danfe-nfce-root { display: block !important; }
          @page { margin: 0; size: ${largura === '58mm' ? '58mm' : '80mm'} auto; }
        }
        #danfe-nfce-root { font-family: 'Courier New', monospace; font-size: 9px; line-height: 1.35; color: #000; background: #fff; }
        #danfe-nfce-root .titulo { font-size: 8px; text-align: center; text-transform: uppercase; font-weight: bold; }
        #danfe-nfce-root .subtitulo { font-size: 7px; text-align: center; color: #444; }
        #danfe-nfce-root .emitente { text-align: center; font-weight: bold; font-size: 10px; }
        #danfe-nfce-root .chave { font-size: 7px; word-break: break-all; text-align: center; letter-spacing: 0.5px; }
        #danfe-nfce-root table { width: 100%; border-collapse: collapse; font-size: 8px; }
        #danfe-nfce-root th { text-align: left; border-bottom: 1px solid #000; padding: 1px 0; font-size: 7px; text-transform: uppercase; }
        #danfe-nfce-root td { padding: 1px 0; vertical-align: top; }
        #danfe-nfce-root .num { text-align: right; }
        #danfe-nfce-root .alerta { background: #000; color: #fff; text-align: center; font-weight: bold; padding: 3px; font-size: 8px; }
        #danfe-nfce-root .proto { font-size: 7px; text-align: center; }
      `}</style>

      <div id="danfe-nfce-root" style={{ ...larguraStyle, padding: '4px 6px', boxSizing: 'border-box' }}>

        {/* Alerta homologação */}
        {isHom && (
          <div className="alerta">SEM VALOR FISCAL — HOMOLOGAÇÃO</div>
        )}

        {/* Alerta contingência */}
        {dados.contingencia && (
          <div className="alerta" style={{ marginTop: 2 }}>
            EMITIDA EM CONTINGÊNCIA — AGUARDANDO TRANSMISSÃO SEFAZ
          </div>
        )}

        {/* Emitente */}
        <div style={{ textAlign: 'center', margin: '4px 0 2px' }}>
          <div className="emitente">{dados.nomeFantasia || dados.razaoSocial}</div>
          {dados.nomeFantasia && <div style={{ fontSize: 8 }}>{dados.razaoSocial}</div>}
          <div style={{ fontSize: 8 }}>CNPJ: {dados.cnpjFormatado}</div>
          <div style={{ fontSize: 7, color: '#333' }}>IE: {dados.ie}</div>
          <div style={{ fontSize: 7, color: '#333' }}>{dados.enderecoCompleto}</div>
        </div>

        <HR />

        {/* Título */}
        <div className="titulo">Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</div>
        <div className="subtitulo">Não é documento fiscal</div>

        <HR />

        {/* Identificação */}
        <Linha label="NFC-e nº:" valor={`${String(dados.numero).padStart(9, '0')} · Série ${dados.serie}`} />
        <Linha label="Emissão:" valor={dados.dhEmissao} />

        {/* Consumidor */}
        {(dados.cpfConsumidor || dados.cnpjConsumidor || dados.xNomeConsumidor) && (
          <>
            <HR />
            <div style={{ fontSize: 8, fontWeight: 'bold', marginBottom: 1 }}>CONSUMIDOR</div>
            {dados.xNomeConsumidor && <div style={{ fontSize: 8 }}>{dados.xNomeConsumidor}</div>}
            {dados.cpfConsumidor && <Linha label="CPF:" valor={dados.cpfConsumidor} />}
            {dados.cnpjConsumidor && <Linha label="CNPJ:" valor={dados.cnpjConsumidor} />}
          </>
        )}

        <HR />
        <div style={{ fontSize: 7, fontWeight: 'bold', marginBottom: 2, textTransform: 'uppercase' }}>Itens</div>

        {/* Tabela de itens */}
        <table>
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Descrição</th>
              <th style={{ width: '15%', textAlign: 'right' }}>Qtd</th>
              <th style={{ width: '20%', textAlign: 'right' }}>Vl.Un</th>
              <th style={{ width: '25%', textAlign: 'right' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {dados.itens.map(item => (
              <tr key={item.seq}>
                <td style={{ paddingRight: 2 }}>{item.descricao}</td>
                <td className="num">{item.quantidade.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</td>
                <td className="num">{BRL(item.valorUnitario)}</td>
                <td className="num">{BRL(item.valorTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <HR />

        {/* Totais */}
        <Linha label={`Qtd itens: ${dados.itens.length}`} valor={`Total produtos: R$ ${BRL(dados.totalProdutos)}`} />
        {dados.desconto > 0 && <Linha label="Desconto:" valor={`-R$ ${BRL(dados.desconto)}`} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 11, marginTop: 2 }}>
          <span>TOTAL</span>
          <span>R$ {BRL(dados.totalNota)}</span>
        </div>

        <HR />

        {/* Pagamentos */}
        <div style={{ fontSize: 8, fontWeight: 'bold', marginBottom: 1, textTransform: 'uppercase' }}>Pagamento</div>
        {dados.pagamentos.map((p, i) => (
          <Linha key={i} label={p.descricao} valor={`R$ ${BRL(p.valor)}`} />
        ))}
        {dados.troco > 0 && (
          <Linha label="Troco:" valor={`R$ ${BRL(dados.troco)}`} negrito />
        )}

        {/* Observações */}
        {dados.observacoes && (
          <>
            <HR />
            <div style={{ fontSize: 7, fontStyle: 'italic', textAlign: 'center' }}>{dados.observacoes}</div>
          </>
        )}

        <HR />

        {/* Consulta */}
        <div style={{ fontSize: 7, textAlign: 'center', marginBottom: 2 }}>
          Consulte pela Chave de Acesso em:
        </div>
        {dados.urlConsulta && (
          <div style={{ fontSize: 6, textAlign: 'center', wordBreak: 'break-all', marginBottom: 3, color: '#333' }}>
            {dados.urlConsulta}
          </div>
        )}

        {/* Chave de acesso */}
        <div className="chave">{dados.chaveAcessoFormatada}</div>

        <HR />

        {/* QR Code */}
        {dados.qrCodeUrl ? (
          <div style={{ textAlign: 'center', margin: '4px 0' }}>
            <QRCodeSVG value={dados.qrCodeUrl} size={qrSize} includeMargin />
          </div>
        ) : (
          <div style={{ fontSize: 7, textAlign: 'center', color: '#666', margin: '4px 0' }}>
            {dados.contingencia ? 'QR Code disponível após autorização SEFAZ' : 'QR Code indisponível'}
          </div>
        )}

        {/* Protocolo */}
        {isOk && (
          <div className="proto">
            Protocolo: {dados.protocolo}
            {dados.dhProtocolo && ` · ${dados.dhProtocolo}`}
          </div>
        )}
        {!isOk && !dados.contingencia && (
          <div className="proto" style={{ color: '#c00' }}>Aguardando autorização SEFAZ</div>
        )}

        <div style={{ height: 8 }} />
      </div>
    </>
  );
}
