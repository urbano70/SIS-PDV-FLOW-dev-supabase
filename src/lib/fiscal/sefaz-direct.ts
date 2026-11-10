// SefazMtDirect — adaptador de domínio para emissão fiscal direta na SEFAZ-MT
// Substitui completamente a DotCompany. Sem API intermediária, sem fallback remoto.
// Roda somente no servidor Node.js.

import crypto from 'node:crypto';
import type { IntencaoFiscal, FiscalDocStatus, AmbienteFiscal, ModeloFiscal } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { getEndpoint, C_UF_MT, TP_AMB, T_PAG } from './endpoints.js';
import {
  gerarChaveAcesso, gerarXmlNFCe, assinarXml, gerarQRCode, montarInfoNFeSupl,
} from './xml-nfce.js';
import {
  montarEnvelopeAutorizacao, montarEnvelopeStatusServico,
  montarEnvelopeCancelamento, soapCall, extrairCampo,
} from './sefaz-soap.js';

// ── Controle de numeração por série (banco de dados — seguro para múltiplos containers) ───
// Usa a tabela fiscal_series com UPDATE atômico. Fallback em memória quando db=null (dev sem banco).

/** Reserva o próximo número via UPDATE atômico no banco (multi-container safe). */
export async function reservarNumero(
  tenantId: string, modelo: ModeloFiscal, serie: string,
  ambiente: AmbienteFiscal, _highWaterMark: number,
  db: any | null,
): Promise<number> {
  if (db) {
    const id = `${tenantId}:${modelo}:${serie}:${ambiente}`;
    // Upsert + incremento atômico via RPC (evita race condition entre containers)
    const { data, error } = await db.rpc('fiscal_series_next', {
      p_id: id, p_tenant_id: tenantId, p_modelo: modelo, p_serie: serie, p_ambiente: ambiente,
    });
    if (error) throw new Error(`Erro ao reservar número fiscal: ${error.message}`);
    return data as number;
  }
  // fallback em memória (desenvolvimento sem banco)
  _memContadores.set(`${tenantId}:${modelo}:${serie}:${ambiente}`,
    (_memContadores.get(`${tenantId}:${modelo}:${serie}:${ambiente}`) ?? 0) + 1);
  return _memContadores.get(`${tenantId}:${modelo}:${serie}:${ambiente}`)!;
}

const _memContadores = new Map<string, number>();

export async function sincronizarContador(
  _tenantId: string, _modelo: ModeloFiscal, _serie: string,
  _ambiente: AmbienteFiscal, _highWaterMark: number,
  _db: any | null,
): Promise<void> {
  // Sincronização não necessária com contadores em banco — a tabela já é a fonte de verdade.
}

// ── Verificar disponibilidade do serviço ────────────────────────────────────

export async function verificarServico(
  modelo: ModeloFiscal, ambiente: AmbienteFiscal, cert: CertificadoCarregado,
): Promise<{ online: boolean; xMotivo: string; dhRecbto: string }> {
  const url = getEndpoint(modelo === '65' ? 'nfce' : 'nfe', ambiente, 'statusServico');
  const tpAmb = TP_AMB[ambiente];
  const envelope = montarEnvelopeStatusServico(C_UF_MT, tpAmb);

  try {
    const resp = await soapCall(url, envelope, cert, 15_000);
    const cStat   = extrairCampo(resp.body, 'cStat');
    const xMotivo = extrairCampo(resp.body, 'xMotivo');
    const dhRecbto = extrairCampo(resp.body, 'dhRecbto');
    if (!cStat) {
      const snippet = resp.body.replace(/\s+/g, ' ').trim().slice(0, 400) || '(vazio)';
      return { online: false, xMotivo: `HTTP ${resp.status} — resposta inesperada: ${snippet}`, dhRecbto: '' };
    }
    return { online: cStat === '107', xMotivo, dhRecbto };
  } catch (err: any) {
    const msg = err?.message || err?.code || String(err) || 'erro desconhecido';
    return { online: false, xMotivo: `${msg} [url: ${url}]`, dhRecbto: '' };
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
  db: any | null = null,
): Promise<AutorizacaoResult> {
  const tpAmb = TP_AMB[intencao.ambiente];
  const serie = intencao.ambiente === 'producao'
    ? intencao.emitente.serieNFCeProd
    : intencao.emitente.serieNFCeHom;

  // 1. Reservar número (atômico no banco — seguro para múltiplos containers)
  const numero = await reservarNumero(intencao.tenantId, '65', serie, intencao.ambiente, highWaterMark, db);
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
  intencao.status = 'ASSINADO';

  // 5. Gerar QR Code e inserir <infNFeSupl> no XML antes de enviar (obrigatório NFC-e)
  const cscId    = intencao.ambiente === 'producao' ? intencao.emitente.cscProdId : intencao.emitente.cscHomId;
  const csc      = intencao.ambiente === 'producao' ? intencao.emitente.cscProd   : intencao.emitente.cscHom;
  const urlQrBase = intencao.ambiente === 'producao'
    ? 'https://nfce.sefaz.mt.gov.br/nfceweb/consultarNFCe.jsf'
    : 'https://homologacao.sefaz.mt.gov.br/nfceweb/consultarNFCe.jsf';
  const urlConsulta = urlQrBase;
  const digestVal = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] ?? '';
  const total = intencao.items.reduce((s, i) => s + i.valorTotal, 0);
  const qrCodeGerado = (cscId && csc)
    ? gerarQRCode(intencao.chaveAcesso, tpAmb, dhEmi, total, digestVal, cscId, csc, urlQrBase)
    : '';
  const infoSupl = montarInfoNFeSupl(qrCodeGerado, urlConsulta);
  // Insere <infNFeSupl> logo após </infNFe> (antes de <Signature>), fora da área assinada
  const xmlComSupl = xmlAssinado.replace(/<Signature\s+xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/, `${infoSupl}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`);
  intencao.xmlAssinado = xmlComSupl;

  // 6. Transmitir
  const url = getEndpoint('nfce', intencao.ambiente, 'autorizacao');
  const envelope = montarEnvelopeAutorizacao(xmlComSupl);
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
  const cStatN = parseInt(cStat || '0');
  if (cStat === '100') {
    status = 'AUTORIZADO';
  } else if (cStatN >= 150 && cStatN <= 199) {
    status = 'AUTORIZADO_COM_ALERTA';
  } else if (cStat === '105') {
    status = 'RESULTADO_DESCONHECIDO'; // lote em processamento async
  } else if (cStat === '') {
    status = 'RETORNO_NAO_CLASSIFICADO';
  } else {
    // Qualquer outro cStat (2xx–9xx) é rejeição SEFAZ
    status = 'REJEITADO';
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
    xmlProcNfe = xmlComSupl.replace(/<\/NFe>/, `</NFe>${retProc}`);
    intencao.xmlProcNfe = xmlProcNfe;
  }

  return { status, cStat, xMotivo, protocolo: nProt, dhRecbto, xmlProcNfe, chaveAcesso: intencao.chaveAcesso, qrCode: qrCodeGerado };
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
