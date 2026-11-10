// SefazMtDirect — adaptador de domínio para emissão fiscal direta na SEFAZ-MT
// Substitui completamente a DotCompany. Sem API intermediária, sem fallback remoto.
// Roda somente no servidor Node.js.

import crypto from 'node:crypto';
import type { IntencaoFiscal, FiscalDocStatus, AmbienteFiscal, ModeloFiscal } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { getEndpoint, C_UF_MT, TP_AMB, T_PAG } from './endpoints.js';
import {
  gerarChaveAcesso, gerarXmlNFCe, assinarXml, gerarQRCode,
} from './xml-nfce.js';
import {
  montarEnvelopeAutorizacao, montarEnvelopeStatusServico,
  montarEnvelopeCancelamento, soapCall, extrairCampo,
} from './sefaz-soap.js';

// ── Controle de numeração por série (em memória — deve ser persistido no Supabase) ───
const _contadores = new Map<string, number>(); // key: `${tenantId}:${modelo}:${serie}:${ambiente}`

function chaveContador(tenantId: string, modelo: ModeloFiscal, serie: string, ambiente: AmbienteFiscal): string {
  return `${tenantId}:${modelo}:${serie}:${ambiente}`;
}

/** Reserva o próximo número de forma exclusiva (por processo). Para multi-nós, usar lock no banco. */
export function reservarNumero(
  tenantId: string, modelo: ModeloFiscal, serie: string,
  ambiente: AmbienteFiscal, highWaterMark: number,
): number {
  const key = chaveContador(tenantId, modelo, serie, ambiente);
  const atual = Math.max(_contadores.get(key) ?? 0, highWaterMark);
  const proximo = atual + 1;
  _contadores.set(key, proximo);
  return proximo;
}

export function sincronizarContador(
  tenantId: string, modelo: ModeloFiscal, serie: string,
  ambiente: AmbienteFiscal, highWaterMark: number,
): void {
  const key = chaveContador(tenantId, modelo, serie, ambiente);
  const atual = _contadores.get(key) ?? 0;
  if (highWaterMark > atual) _contadores.set(key, highWaterMark);
}

// ── Verificar disponibilidade do serviço ────────────────────────────────────

export async function verificarServico(
  modelo: ModeloFiscal, ambiente: AmbienteFiscal, cert: CertificadoCarregado,
): Promise<{ online: boolean; xMotivo: string; dhRecbto: string }> {
  const url = getEndpoint(modelo === '65' ? 'nfce' : 'nfe', ambiente, 'statusServico');
  const tpAmb = TP_AMB[ambiente];
  const envelope = montarEnvelopeStatusServico(C_UF_MT, tpAmb);

  try {
    const { body } = await soapCall(url, envelope, cert, 15_000);
    const cStat = extrairCampo(body, 'cStat');
    const xMotivo = extrairCampo(body, 'xMotivo');
    const dhRecbto = extrairCampo(body, 'dhRecbto');
    return { online: cStat === '107', xMotivo, dhRecbto };
  } catch (err: any) {
    return { online: false, xMotivo: err.message, dhRecbto: '' };
  }
}

// ── Autorizar NFC-e ──────────────────────────────────────────────────────────

export interface AutorizacaoResult {
  status: FiscalDocStatus;
  cStat: string;
  xMotivo: string;
  protocolo: string;
  dhRecbto: string;
  xmlProcNfe?: string;
  chaveAcesso: string;
  qrCode: string;
}

export async function autorizarNFCe(
  intencao: IntencaoFiscal,
  cert: CertificadoCarregado,
  highWaterMark: number,
): Promise<AutorizacaoResult> {
  const tpAmb = TP_AMB[intencao.ambiente];
  const serie = intencao.ambiente === 'producao'
    ? intencao.emitente.serieNFCeProd
    : intencao.emitente.serieNFCeHom;

  // 1. Reservar número
  const numero = reservarNumero(intencao.tenantId, '65', serie, intencao.ambiente, highWaterMark);
  intencao.numero = numero;
  intencao.serie = serie;

  // 2. Gerar chave de acesso
  const cNF = pad(crypto.randomInt(1, 99999999), 8);
  const dhEmi = new Date();
  intencao.chaveAcesso = gerarChaveAcesso(C_UF_MT, dhEmi, intencao.emitente.cnpj, '65', serie, numero, intencao.tpEmis, cNF, tpAmb);

  // 3. Gerar XML
  const xmlBase = gerarXmlNFCe(intencao);

  // 4. Assinar
  const xmlAssinado = assinarXml(xmlBase, cert.privateKeyPem, cert.certificatePem);
  intencao.xmlAssinado = xmlAssinado;
  intencao.status = 'ASSINADO';

  // 5. Persistir XML assinado antes de enviar (ponto de recuperação)
  // Chamador deve persistir intencao.xmlAssinado aqui antes de continuar.

  // 6. Transmitir
  const url = getEndpoint('nfce', intencao.ambiente, 'autorizacao');
  const envelope = montarEnvelopeAutorizacao(xmlAssinado);
  intencao.status = 'ENVIANDO';

  let soapResp: Awaited<ReturnType<typeof soapCall>>;
  try {
    soapResp = await soapCall(url, envelope, cert, 30_000);
  } catch (err: any) {
    if (err.message === 'SOAP_TIMEOUT') {
      intencao.status = 'RESULTADO_DESCONHECIDO';
      return {
        status: 'RESULTADO_DESCONHECIDO', cStat: '', xMotivo: 'Timeout na transmissão — consulte pela chave.',
        protocolo: '', dhRecbto: '', chaveAcesso: intencao.chaveAcesso, qrCode: '',
      };
    }
    throw err;
  }

  // 7. Classificar retorno
  const cStat   = extrairCampo(soapResp.body, 'cStat');
  const xMotivo = extrairCampo(soapResp.body, 'xMotivo');
  const nProt   = extrairCampo(soapResp.body, 'nProt');
  const dhRecbto = extrairCampo(soapResp.body, 'dhRecbto');

  let status: FiscalDocStatus;
  if (cStat === '100') {
    status = 'AUTORIZADO';
  } else if (cStat === '110' || cStat === '301' || cStat === '302') {
    status = 'REJEITADO';
  } else if (cStat === '') {
    status = 'RETORNO_NAO_CLASSIFICADO';
  } else if (parseInt(cStat) >= 150 && parseInt(cStat) <= 199) {
    status = 'AUTORIZADO_COM_ALERTA';
  } else {
    status = 'RETORNO_NAO_CLASSIFICADO';
  }

  intencao.status = status;
  intencao.cStat = cStat;
  intencao.xMotivo = xMotivo;
  intencao.protocolo = nProt;
  intencao.dhRecbto = dhRecbto;

  // 8. Montar procNFe na autorização
  let xmlProcNfe: string | undefined;
  if (status === 'AUTORIZADO' || status === 'AUTORIZADO_COM_ALERTA') {
    const retProc = soapResp.body.match(/<retNFeProc[\s\S]*?<\/retNFeProc>/)?.[0] ?? '';
    xmlProcNfe = xmlAssinado.replace(/<\/NFe>/, `</NFe>${retProc}`);
    intencao.xmlProcNfe = xmlProcNfe;
  }

  // 9. Gerar QR Code
  const cscId = intencao.ambiente === 'producao' ? intencao.emitente.cscProdId : intencao.emitente.cscHomId;
  const csc   = intencao.ambiente === 'producao' ? intencao.emitente.cscProd   : intencao.emitente.cscHom;
  const urlQrBase = intencao.ambiente === 'producao'
    ? 'https://nfce.sefaz.mt.gov.br/nfceweb/consultarNFCe.jsf'
    : 'https://homologacao.sefaz.mt.gov.br/nfceweb/consultarNFCe.jsf';
  const digestVal = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] ?? '';
  const total = intencao.items.reduce((s, i) => s + i.valorTotal, 0);
  const qrCode = csc
    ? gerarQRCode(intencao.chaveAcesso, tpAmb, dhEmi, total, digestVal, csc, urlQrBase)
    : '';

  return { status, cStat, xMotivo, protocolo: nProt, dhRecbto, xmlProcNfe, chaveAcesso: intencao.chaveAcesso, qrCode };
}

// ── Consultar por chave de acesso ───────────────────────────────────────────

export async function consultarNFCe(
  chaveAcesso: string, ambiente: AmbienteFiscal, cert: CertificadoCarregado,
): Promise<{ cStat: string; xMotivo: string; protocolo: string }> {
  const url = getEndpoint('nfce', ambiente, 'consultaProtocolo');
  const tpAmb = TP_AMB[ambiente];
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>` +
    `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsulta4">` +
    `<consSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">` +
    `<tpAmb>${tpAmb}</tpAmb><xServ>CONSULTAR</xServ><chNFe>${chaveAcesso}</chNFe>` +
    `</consSitNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;

  const { body } = await soapCall(url, envelope, cert, 15_000);
  return {
    cStat: extrairCampo(body, 'cStat'),
    xMotivo: extrairCampo(body, 'xMotivo'),
    protocolo: extrairCampo(body, 'nProt'),
  };
}

// ── Cancelar NFC-e ──────────────────────────────────────────────────────────

export async function cancelarNFCe(
  chaveAcesso: string, protocolo: string, motivo: string,
  ambiente: AmbienteFiscal, cert: CertificadoCarregado,
): Promise<{ cStat: string; xMotivo: string }> {
  const url = getEndpoint('nfce', ambiente, 'cancelamento');
  const tpAmb = TP_AMB[ambiente];
  const dhEvento = new Date().toISOString().replace('Z', '-04:00');
  const envelope = montarEnvelopeCancelamento(chaveAcesso, protocolo, motivo, tpAmb, dhEvento);

  const { body } = await soapCall(url, envelope, cert, 15_000);
  const cStat   = extrairCampo(body, 'cStat');
  const xMotivo = extrairCampo(body, 'xMotivo');

  if (cStat !== '135' && cStat !== '155') {
    throw new Error(`Cancelamento rejeitado: ${cStat} — ${xMotivo}`);
  }
  return { cStat, xMotivo };
}

// helper
function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}

export { T_PAG };
