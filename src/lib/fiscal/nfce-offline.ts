// NFC-e contingência offline — tpEmis='9'
// NT 2016.001 / MOC NFC-e 7.0 — Contingência OFF-LINE do Emissor
// Roda somente no servidor Node.js.
//
// Diferença em relação à emissão normal (tpEmis='1'):
//   A NFC-e NÃO é transmitida ao SEFAZ — apenas gerada, assinada e armazenada.
//   Status = CONTINGENCIA_PENDENTE_TRANSMISSAO.
//   O DANFE é impresso imediatamente com QR Code e aviso "EM CONTINGÊNCIA".
//   Transmissão ao SEFAZ obrigatória em até 168h (7 dias) após emissão.
//
// Quando usar:
//   SEFAZ-MT NFC-e indisponível → emitir offline; transmitir quando voltar.
//   A reconciliação periódica detecta CONTINGENCIA_PENDENTE_TRANSMISSAO e transmite automaticamente.

import crypto from 'node:crypto';
import type { IntencaoFiscal, FiscalDocStatus } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { C_UF_MT, TP_AMB, URL_QR_CONSULTA } from './endpoints.js';
import {
  gerarChaveAcesso, gerarXmlNFCe, assinarXml,
  gerarQRCode, montarInfoNFeSupl, type OpcoesNFCe,
} from './xml-nfce.js';
import { reservarNumero } from './sefaz-direct.js';

export interface NfceOfflineResult {
  status: 'CONTINGENCIA_PENDENTE_TRANSMISSAO';
  chaveAcesso: string;
  qrCode: string;       // para o DANFE imediato
  xmlAssinado: string;  // armazenar — necessário para transmissão posterior
}

/**
 * Emite NFC-e modelo 65 em contingência offline (tpEmis='9').
 *
 * Gera, assina e retorna o XML sem transmitir ao SEFAZ.
 * O chamador deve persistir `xml_assinado` no banco — sem ele a
 * reconciliação não pode re-enviar.
 *
 * @param dhCont  ISO 8601 início da contingência ex: "2026-11-11T10:00:00-04:00"
 * @param xJust   Justificativa 15–256 chars
 */
export async function emitirNFCeOffline(
  intencao: IntencaoFiscal,
  cert: CertificadoCarregado,
  highWaterMark: number,
  dhCont: string,
  xJust: string,
  db: any | null = null,
  opts: OpcoesNFCe = {},
): Promise<NfceOfflineResult> {
  intencao.tpEmis = '9';
  const tpAmb = TP_AMB[intencao.ambiente];
  const serie = intencao.ambiente === 'producao'
    ? intencao.emitente.serieNFCeProd
    : intencao.emitente.serieNFCeHom;

  // 1. Reservar número
  const numero = await reservarNumero(intencao.tenantId, '65', serie, intencao.ambiente, highWaterMark, db);
  intencao.numero = numero;
  intencao.serie  = serie;

  // 2. Chave de acesso (tpEmis='9')
  const cNF = pad(crypto.randomInt(1, 99999999), 8);
  const dhEmi = new Date();
  intencao.chaveAcesso = gerarChaveAcesso(C_UF_MT, dhEmi, intencao.emitente.cnpj, '65', serie, numero, '9', cNF, tpAmb);

  // 3. Gerar XML (tpEmis='9', dhCont, xJust — obrigatórios na geração)
  const xmlBase = gerarXmlNFCe(intencao, { ...opts, dhCont, xJust });

  // 4. Assinar
  const xmlAssinado = assinarXml(xmlBase, cert.privateKeyPem, cert.certificatePem);
  intencao.status = 'ASSINADO';

  // 5. Gerar QR Code (SHA-1 com CSC) e inserir <infNFeSupl> — impresso no DANFE offline
  const cscId      = intencao.ambiente === 'producao' ? intencao.emitente.cscProdId : intencao.emitente.cscHomId;
  const csc        = intencao.ambiente === 'producao' ? intencao.emitente.cscProd   : intencao.emitente.cscHom;
  const urlQrBase  = URL_QR_CONSULTA[intencao.ambiente];
  const urlConsulta = urlQrBase;
  const digestVal  = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)?.[1] ?? '';
  const totalNota  = intencao.items.reduce((s, i) => s + i.valorTotal, 0);
  const qrCode = (cscId && csc)
    ? gerarQRCode(intencao.chaveAcesso, tpAmb, dhEmi, totalNota, digestVal, cscId, csc, urlQrBase, intencao.cpfConsumidor || undefined)
    : '';

  const infoSupl = montarInfoNFeSupl(qrCode, urlConsulta);
  const xmlFinal = xmlAssinado.replace(
    /<Signature\s+xmlns="http:\/\/www\.w3\.org\/2000\/09\/xmldsig#">/,
    `${infoSupl}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">`,
  );

  intencao.xmlAssinado = xmlFinal;
  intencao.status      = 'CONTINGENCIA_PENDENTE_TRANSMISSAO';

  return {
    status: 'CONTINGENCIA_PENDENTE_TRANSMISSAO',
    chaveAcesso: intencao.chaveAcesso,
    qrCode,
    xmlAssinado: xmlFinal,
  };
}

function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}
