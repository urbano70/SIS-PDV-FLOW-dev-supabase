// Comunicação direta com SEFAZ-MT via SOAP 1.2 + mTLS (certificado cliente)
// Roda somente no servidor Node.js — sem REST, sem API intermediária.

import https from 'node:https';
import type { CertificadoCarregado } from './certificate.js';

export interface SoapResponse {
  status: number;
  body: string;
}

/** Envolve o XML da NFC-e no envelope SOAP 1.2 para NfeAutorizacao4 */
export function montarEnvelopeAutorizacao(xmlNFe: string, versao = '4.00'): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">` +
    `<enviNFe versao="${versao}" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${Date.now()}</idLote>` +
    `<indSinc>1</indSinc>` +
    xmlNFe +
    `</enviNFe>` +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

export function montarEnvelopeStatusServico(cUF: string, tpAmb: '1' | '2'): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">` +
    `<consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<cUF>${cUF}</cUF>` +
    `<xServ>STATUS</xServ>` +
    `</consStatServ>` +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

export function montarEnvelopeCancelamento(
  chaveAcesso: string, protocolo: string, motivo: string,
  tpAmb: '1' | '2', dhEvento: string, nSeqEvento = '1',
): string {
  const detEvento =
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${protocolo}</nProt>` +
    `<xJust>${motivo.substring(0, 255)}</xJust>` +
    `</detEvento>`;

  const infEvento =
    `<infEvento Id="ID11010${chaveAcesso}${pad(nSeqEvento, 2)}">` +
    `<cOrgao>51</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${chaveAcesso.substring(6, 20)}</CNPJ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>110111</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    detEvento +
    `</infEvento>`;

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${Date.now()}</idLote>` +
    `<evento versao="1.00"><${infEvento}</evento>` +
    `</envEvento>` +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}

/** Chamada SOAP com mTLS — certificado A1 usado como client certificate */
export async function soapCall(
  url: string,
  soapBody: string,
  cert: CertificadoCarregado,
  timeoutMs = 30_000,
): Promise<SoapResponse> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const bodyBuf = Buffer.from(soapBody, 'utf8');

    const options: https.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'Content-Length': bodyBuf.length,
        'SOAPAction': '',
      },
      // mTLS — usar PEM já extraídos pelo node-forge (evita mac verify failure do PFX)
      key: cert.privateKeyPem,
      cert: cert.certificatePem,
      ca: cert.caCertsPem.length > 0 ? cert.caCertsPem : undefined,
      // SEFAZ-MT usa certificados ICP-Brasil não presentes no bundle padrão do Node
      rejectUnauthorized: false,
      timeout: timeoutMs,
    };

    const req = https.request(options, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
      });
    });

    req.on('timeout', () => { req.destroy(); reject(new Error('SOAP_TIMEOUT')); });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

/** Extrai um campo do XML de resposta SEFAZ */
export function extrairCampo(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
  return m?.[1] ?? '';
}
