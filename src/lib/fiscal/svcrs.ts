// SVC-RS contingência tpEmis='7' — NF-e modelo 55
// NT 2024.001 / MOC NF-e 7.0 / Portal Nacional NF-e
// Roda somente no servidor Node.js.
//
// Diferença em relação ao EPEC (tpEmis='4'):
//   tpEmis='7' → a NF-e COMPLETA vai ao SVC-RS para autorização imediata.
//   O SVC-RS retorna nProt e cStat=100 → status=AUTORIZADO definitivo.
//   Não é necessário re-transmitir ao SEFAZ-MT depois.
//
// Quando usar:
//   SEFAZ-MT offline e SEFAZ indisponível por mais de 30min → tpEmis='7'.
//   Para curtas interrupções (<30min) prefira EPEC (tpEmis='4').

import crypto from 'node:crypto';
import type { IntencaoFiscal, FiscalDocStatus, AmbienteFiscal } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { C_UF_MT, TP_AMB, getSvcRsEndpoint, C_ORGAO_SVC_RS } from './endpoints.js';
import { gerarChaveAcessoNFe, gerarXmlNFe, type OpcoesNFe } from './xml-nfe.js';
import { assinarXml, assinarXmlElemento } from './xml-nfce.js';
import {
  montarEnvelopeAutorizacao, montarXmlEvento, montarEnvelopeEvento,
  detCancelamento, soapCall, extrairCampo,
} from './sefaz-soap.js';
import { reservarNumero } from './sefaz-direct.js';
import type { AutorizacaoResult } from './sefaz-direct.js';

/**
 * Autoriza uma NF-e modelo 55 via SVC-RS contingência (tpEmis='7').
 *
 * A NF-e é transmitida diretamente ao SVC-RS para autorização imediata.
 * Nenhuma re-transmissão posterior é necessária.
 *
 * @param dhCont  ISO 8601 início da contingência ex: "2026-11-11T10:00:00-04:00"
 * @param xJust   Justificativa 15–256 chars
 */
export async function emitirNFeSvcRs(
  intencao: IntencaoFiscal,
  cert: CertificadoCarregado,
  highWaterMark: number,
  dhCont: string,
  xJust: string,
  db: any | null = null,
  opts: OpcoesNFe = {},
): Promise<AutorizacaoResult> {
  intencao.tpEmis = '7';
  const tpAmb = TP_AMB[intencao.ambiente];
  const serie = intencao.ambiente === 'producao'
    ? intencao.emitente.serieNFEProd
    : intencao.emitente.serieNFEHom;

  // 1. Reservar número
  const numero = await reservarNumero(intencao.tenantId, '55', serie, intencao.ambiente, highWaterMark, db);
  intencao.numero = numero;
  intencao.serie  = serie;

  // 2. Chave de acesso (tpEmis='7')
  const cNF = pad(crypto.randomInt(1, 99999999), 8);
  const dhEmi = new Date();
  intencao.chaveAcesso = gerarChaveAcessoNFe(C_UF_MT, dhEmi, intencao.emitente.cnpj, serie, numero, '7', cNF);

  // 3. Gerar XML com tpEmis='7', dhCont, xJust — idêntico ao normal exceto esses campos
  const xmlBase = gerarXmlNFe(intencao, { ...opts, dhCont, xJust });

  // 4. Assinar
  const xmlAssinado = assinarXml(xmlBase, cert.privateKeyPem, cert.certificatePem);
  intencao.xmlAssinado = xmlAssinado;
  intencao.status = 'ASSINADO';

  // 5. Transmitir ao SVC-RS (autorizacao) — mesmo envelope do SEFAZ-MT
  const nfeStart = xmlAssinado.indexOf('<NFe');
  const nfeEnd   = xmlAssinado.lastIndexOf('</NFe>') + '</NFe>'.length;
  const xmlNFe   = (nfeStart >= 0 && nfeEnd > nfeStart) ? xmlAssinado.slice(nfeStart, nfeEnd) : xmlAssinado;

  const url      = getSvcRsEndpoint(intencao.ambiente, 'autorizacao');
  const envelope = montarEnvelopeAutorizacao(xmlNFe);
  intencao.status = 'ENVIANDO';

  let soapResp: Awaited<ReturnType<typeof soapCall>>;
  try {
    soapResp = await soapCall(url, envelope, cert, 30_000);
  } catch (err: any) {
    if (err.message === 'SOAP_TIMEOUT') {
      intencao.status = 'RESULTADO_DESCONHECIDO';
      return {
        status: 'RESULTADO_DESCONHECIDO',
        cStat: '', xMotivo: 'Timeout na transmissão ao SVC-RS.',
        protocolo: '', dhRecbto: '',
        chaveAcesso: intencao.chaveAcesso, qrCode: '',
      };
    }
    throw err;
  }

  // 6. Classificar retorno — mesma lógica de autorizarNFe
  const cStat    = extrairCampo(soapResp.body, 'cStat');
  const xMotivo  = extrairCampo(soapResp.body, 'xMotivo');
  const nProt    = extrairCampo(soapResp.body, 'nProt');
  const dhRecbto = extrairCampo(soapResp.body, 'dhRecbto');
  const cStatN   = parseInt(cStat || '0');

  let status: FiscalDocStatus;
  if (cStat === '100') {
    status = 'AUTORIZADO';
  } else if (cStat === '120' || (cStatN >= 150 && cStatN <= 199)) {
    status = 'AUTORIZADO_COM_ALERTA';
  } else if (cStat === '105') {
    status = 'PROCESSANDO';
  } else if (cStat === '') {
    status = 'RETORNO_NAO_CLASSIFICADO';
  } else {
    status = 'REJEITADO';
  }

  intencao.status    = status;
  intencao.cStat     = cStat;
  intencao.xMotivo   = xMotivo;
  intencao.protocolo = nProt;
  intencao.dhRecbto  = dhRecbto;

  let xmlProcNfe: string | undefined;
  if (status === 'AUTORIZADO' || status === 'AUTORIZADO_COM_ALERTA') {
    const retProc = soapResp.body.match(/<retNFeProc[\s\S]*?<\/retNFeProc>/)?.[0] ?? '';
    xmlProcNfe = xmlAssinado.replace(/<\/NFe>/, `</NFe>${retProc}`);
    intencao.xmlProcNfe = xmlProcNfe;
  }

  return { status, cStat, xMotivo, protocolo: nProt, dhRecbto, xmlProcNfe, chaveAcesso: intencao.chaveAcesso, qrCode: '' };
}

// ── Cancelar NF-e autorizada via SVC-RS (prazo: conforme NT SVC-RS) ──────────

export async function cancelarNFeSvcRs(
  chaveAcesso: string, protocolo: string, motivo: string,
  ambiente: AmbienteFiscal, cert: CertificadoCarregado,
): Promise<{ cStat: string; xMotivo: string }> {
  const url = getSvcRsEndpoint(ambiente, 'recepcaoEvento');
  const tpAmb = TP_AMB[ambiente];
  const dhEvento = new Date().toISOString().replace('Z', '-04:00');
  const eventoXml = montarXmlEvento(chaveAcesso, '110111', tpAmb, dhEvento, detCancelamento(protocolo, motivo), '1', C_ORGAO_SVC_RS);
  const eventoAssinado = assinarXmlElemento(eventoXml, 'infEvento', cert.privateKeyPem, cert.certificatePem);
  const envelope = montarEnvelopeEvento(eventoAssinado);

  const { body } = await soapCall(url, envelope, cert, 15_000);
  const cStat   = extrairCampo(body, 'cStat');
  const xMotivo = extrairCampo(body, 'xMotivo');

  if (cStat !== '135' && cStat !== '155') {
    throw new Error(`Cancelamento NF-e SVC-RS rejeitado: ${cStat} — ${xMotivo}`);
  }
  return { cStat, xMotivo };
}

function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}
