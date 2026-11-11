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

function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}

// ── Eventos (cancelamento, 110112) ───────────────────────────────────────────

/**
 * Monta o XML do evento (unsigned) — assinar com assinarXmlElemento(xml, 'infEvento', ...) antes de transmitir.
 */
export function montarXmlEvento(
  chaveAcesso: string,
  tpEvento: string,
  tpAmb: '1' | '2',
  dhEvento: string,
  detEvento: string,
  nSeqEvento = '1',
  cOrgao = '51',
): string {
  const idEvento = `ID${tpEvento}${chaveAcesso}${pad(nSeqEvento, 2)}`;
  const infEvento =
    `<infEvento Id="${idEvento}">` +
    `<cOrgao>${cOrgao}</cOrgao>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<CNPJ>${chaveAcesso.substring(6, 20)}</CNPJ>` +
    `<chNFe>${chaveAcesso}</chNFe>` +
    `<dhEvento>${dhEvento}</dhEvento>` +
    `<tpEvento>${tpEvento}</tpEvento>` +
    `<nSeqEvento>${nSeqEvento}</nSeqEvento>` +
    `<verEvento>1.00</verEvento>` +
    detEvento +
    `</infEvento>`;

  return `<evento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">${infEvento}</evento>`;
}

/** Envolve um evento já assinado no envelope SOAP de RecepcaoEvento4. */
export function montarEnvelopeEvento(eventoAssinado: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
    `<envEvento versao="1.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<idLote>${Date.now()}</idLote>` +
    eventoAssinado +
    `</envEvento>` +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
}

/** detEvento para cancelamento ordinário (tpEvento=110111). */
export function detCancelamento(protocolo: string, motivo: string): string {
  return (
    `<detEvento versao="1.00">` +
    `<descEvento>Cancelamento</descEvento>` +
    `<nProt>${protocolo}</nProt>` +
    `<xJust>${motivo.substring(0, 255)}</xJust>` +
    `</detEvento>`
  );
}

/** detEvento para cancelamento por substituição de NFC-e contingente (tpEvento=110112, NT 2018.004). */
export function detCancelamentoPorSubstituicao(
  protocolo: string, motivo: string, chaveNFCeContingente: string,
): string {
  return (
    `<detEvento versao="1.01">` +
    `<descEvento>Cancelamento por substituicao</descEvento>` +
    `<cOrgaoAutor>51</cOrgaoAutor>` +
    `<tpAutor>1</tpAutor>` +
    `<verAplic>1.0.0</verAplic>` +
    `<nProt>${protocolo}</nProt>` +
    `<xJust>${motivo.substring(0, 255)}</xJust>` +
    `<chNFeRef>${chaveNFCeContingente}</chNFeRef>` +
    `</detEvento>`
  );
}

// ── EPEC (tpEvento=110140, NT 2015.001) ──────────────────────────────────────

export interface ParamsDetEpec {
  dhEmi: string;              // ISO 8601 com offset, ex: "2026-11-11T10:30:00-04:00"
  tpNF: '0' | '1';           // 0=entrada, 1=saída
  ie: string;                 // IE do emitente, somente dígitos
  destUF: string;             // UF do destinatário
  destCNPJ?: string;          // CNPJ do destinatário (14 dígitos)
  destCPF?: string;           // CPF do destinatário (11 dígitos)
  destIE?: string;            // IE do destinatário ou 'ISENTO'
  vNF: string;                // valor total (2 casas decimais, ex: "150.00")
  vICMS: string;              // valor ICMS
  vST: string;                // valor ICMS-ST
}

/** detEvento para EPEC (tpEvento=110140) — transmitido ao SVC-RS/SVC-AN. */
export function montarDetEventoEpec(p: ParamsDetEpec): string {
  const docDest = p.destCNPJ
    ? `<CNPJ>${p.destCNPJ}</CNPJ>`
    : p.destCPF
    ? `<CPF>${p.destCPF}</CPF>`
    : `<CNPJ></CNPJ>`;
  return (
    `<detEvento versao="1.00">` +
    `<descEvento>EPEC</descEvento>` +
    `<cOrgaoAutor>51</cOrgaoAutor>` +
    `<tpAutor>1</tpAutor>` +
    `<verAplic>1.0.0</verAplic>` +
    `<dhEmi>${p.dhEmi}</dhEmi>` +
    `<tpNF>${p.tpNF}</tpNF>` +
    `<IE>${p.ie}</IE>` +
    `<dest>` +
    `<UF>${p.destUF}</UF>` +
    docDest +
    `<IE>${p.destIE ?? 'ISENTO'}</IE>` +
    `</dest>` +
    `<vNF>${p.vNF}</vNF>` +
    `<vICMS>${p.vICMS}</vICMS>` +
    `<vST>${p.vST}</vST>` +
    `</detEvento>`
  );
}

// ── Inutilização ─────────────────────────────────────────────────────────────

export interface ParamsInutilizacao {
  tpAmb: '1' | '2';
  cnpj: string;
  mod: '55' | '65';
  serie: string;
  nNFIni: number;
  nNFFin: number;
  xJust: string;
  ano?: number; // padrão: ano atual
}

/** Monta o XML de inutilização (unsigned) — assinar com assinarXmlElemento(xml, 'infInut', ...) antes de transmitir. */
export function montarXmlInutilizacao(p: ParamsInutilizacao): string {
  const ano = p.ano ?? new Date().getFullYear() % 100;
  const cnpj = p.cnpj.replace(/\D/g, '');
  const idInut =
    `ID${pad(51, 2)}${pad(ano, 2)}${pad(cnpj, 14)}${p.mod}${pad(p.serie, 3)}${pad(p.nNFIni, 9)}${pad(p.nNFFin, 9)}`;

  const infInut =
    `<infInut Id="${idInut}">` +
    `<tpAmb>${p.tpAmb}</tpAmb>` +
    `<cUF>51</cUF>` +
    `<ano>${pad(ano, 2)}</ano>` +
    `<CNPJ>${cnpj}</CNPJ>` +
    `<mod>${p.mod}</mod>` +
    `<serie>${p.serie}</serie>` +
    `<nNFIni>${p.nNFIni}</nNFIni>` +
    `<nNFFin>${p.nNFFin}</nNFFin>` +
    `<xJust>${p.xJust.substring(0, 255)}</xJust>` +
    `</infInut>`;

  return `<?xml version="1.0" encoding="UTF-8"?><inutNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">${infInut}</inutNFe>`;
}

/** Envelope SOAP para NfeInutilizacao4. */
export function montarEnvelopeInutilizacao(xmlInutAssinado: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">` +
    `<soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeInutilizacao4">` +
    xmlInutAssinado +
    `</nfeDadosMsg>` +
    `</soap12:Body>` +
    `</soap12:Envelope>`
  );
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
