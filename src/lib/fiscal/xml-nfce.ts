// Geração e assinatura de XML NFC-e modelo 65 — layout 4.00
// Referência: MOC 7.0, XSD nfe_v4.00.xsd, NT 2025.001 (QR Code)
// Roda somente no servidor Node.js.

import forge from 'node-forge';
import crypto from 'node:crypto';
import type { IntencaoFiscal, ItemNota, PagamentoNota } from './types.js';
import { C_UF_MT, TP_AMB, VERSAO_NFE } from './endpoints.js';

// ── Helpers de formatação ────────────────────────────────────────────────────

function dec(v: number, digits: number): string {
  return v.toFixed(digits);
}

function pad(v: string | number, len: number, char = '0'): string {
  return String(v).padStart(len, char);
}

/** Soma de verificação (módulo 11) da chave de acesso */
function digitoChave(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  for (let i = chave43.length - 1, p = 0; i >= 0; i--, p = (p + 1) % 8) {
    soma += parseInt(chave43[i]) * pesos[p];
  }
  const r = soma % 11;
  return r < 2 ? '0' : String(11 - r);
}

export function gerarChaveAcesso(
  cUF: string, dhEmi: Date, cnpj: string,
  mod: '65', serie: string, nNF: number,
  tpEmis: string, cNF: string, tpAmb: string,
): string {
  const aamm = `${dhEmi.getFullYear()}${pad(dhEmi.getMonth() + 1, 2)}`;
  const cnpjL = cnpj.replace(/\D/g, '');
  const base43 =
    pad(cUF, 2) + aamm + pad(cnpjL, 14) + mod +
    pad(serie, 3) + pad(nNF, 9) + pad(tpEmis, 1) + pad(cNF, 8);
  const cDV = digitoChave(base43);
  return base43 + cDV;
}

// ── Geração do XML NFC-e ─────────────────────────────────────────────────────

function xmlItem(item: ItemNota, idx: number, crt: string): string {
  const nItem = pad(idx + 1, 3);
  const isSimples = crt === '1' || crt === '2';

  const impostoICMS = isSimples
    ? `<ICMS><ICMSSN${item.csosn?.startsWith('9') ? '900' : '102'}><orig>${item.origem}</orig><CSOSN>${item.csosn ?? '102'}</CSOSN></ICMSSN${item.csosn?.startsWith('9') ? '900' : '102'}></ICMS>`
    : `<ICMS><ICMS00><orig>${item.origem}</orig><CST>${item.cst ?? '00'}</CST><modBC>3</modBC><vBC>${dec(item.valorTotal, 2)}</vBC><pICMS>12.00</pICMS><vICMS>${dec(item.valorTotal * 0.12, 2)}</vICMS></ICMS00></ICMS>`;

  const pis = item.piscofins.cst === '07' || item.piscofins.cst === '08' || item.piscofins.cst === '09'
    ? `<PIS><PISNTrib><CST>${item.piscofins.cst}</CST></PISNTrib></PIS><COFINS><COFINSNTrib><CST>${item.piscofins.cst}</CST></COFINSNTrib></COFINS>`
    : `<PIS><PISAliq><CST>${item.piscofins.cst}</CST><vBC>${dec(item.valorTotal, 2)}</vBC><pPIS>${dec(item.piscofins.pPIS ?? 0, 4)}</pPIS><vPIS>${dec(item.piscofins.vPIS ?? 0, 2)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>${item.piscofins.cst}</CST><vBC>${dec(item.valorTotal, 2)}</vBC><pCOFINS>${dec(item.piscofins.pCOFINS ?? 0, 4)}</pCOFINS><vCOFINS>${dec(item.piscofins.vCOFINS ?? 0, 2)}</vCOFINS></COFINSAliq></COFINS>`;

  return `<det nItem="${nItem}">` +
    `<prod>` +
    `<cProd>${item.codigo}</cProd>` +
    `<cEAN>${item.gtin ?? 'SEM GTIN'}</cEAN>` +
    `<xProd>${item.descricao.substring(0, 120)}</xProd>` +
    `<NCM>${item.ncm}</NCM>` +
    (item.cest ? `<CEST>${item.cest}</CEST>` : '') +
    `<CFOP>${item.cfop}</CFOP>` +
    `<uCom>${item.unidade}</uCom>` +
    `<qCom>${dec(item.quantidade, 4)}</qCom>` +
    `<vUnCom>${dec(item.valorUnitario, 10)}</vUnCom>` +
    `<vProd>${dec(item.valorTotal, 2)}</vProd>` +
    `<cEANTrib>${item.gtin ?? 'SEM GTIN'}</cEANTrib>` +
    `<uTrib>${item.unidade}</uTrib>` +
    `<qTrib>${dec(item.quantidade, 4)}</qTrib>` +
    `<vUnTrib>${dec(item.valorUnitario, 10)}</vUnTrib>` +
    `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto><vTotTrib>0.00</vTotTrib>${impostoICMS}${pis}</imposto>` +
    `</det>`;
}

function xmlPagamentos(pags: PagamentoNota[], total: number, troco = 0): string {
  const detPag = pags.map(p =>
    `<detPag>` +
    (p.tpIntegra ? `<tpIntegra>${p.tpIntegra}</tpIntegra>` : '') +
    `<tPag>${p.tPag}</tPag>` +
    `<vPag>${dec(p.vPag, 2)}</vPag>` +
    (p.cAut ? `<card><tpIntegra>${p.tpIntegra ?? '2'}</tpIntegra><CNPJ>${p.CNPJReceb ?? ''}</CNPJ><tBand>99</tBand><cAut>${p.cAut}</cAut></card>` : '') +
    `</detPag>`
  ).join('');
  return `<pag>${detPag}<vTroco>${dec(troco, 2)}</vTroco></pag>`;
}

export function gerarXmlNFCe(intencao: IntencaoFiscal): string {
  const { emitente: emit, items, pagamentos } = intencao;
  if (!intencao.numero) throw new Error('Número da nota não reservado.');
  if (!intencao.chaveAcesso) throw new Error('Chave de acesso não gerada.');

  const tpAmb = TP_AMB[intencao.ambiente];
  const dhEmi = new Date().toISOString().replace('Z', '-04:00'); // MT = UTC-4
  const total = items.reduce((s, i) => s + i.valorTotal, 0);
  const troco = intencao.troco ?? 0;

  const infNFe =
    `<infNFe Id="NFe${intencao.chaveAcesso}" versao="${VERSAO_NFE}">` +
    `<ide>` +
    `<cUF>${C_UF_MT}</cUF>` +
    `<cNF>${intencao.chaveAcesso.substring(35, 43)}</cNF>` +
    `<natOp>VENDA DE MERCADORIA</natOp>` +
    `<mod>65</mod>` +
    `<serie>${intencao.serie}</serie>` +
    `<nNF>${intencao.numero}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<tpNF>1</tpNF>` +
    `<idDest>1</idDest>` +
    `<cMunFG>${emit.codigoMunicipio}</cMunFG>` +
    `<tpImp>4</tpImp>` +
    `<tpEmis>${intencao.tpEmis}</tpEmis>` +
    `<cDV>${intencao.chaveAcesso.slice(-1)}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>1</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>1</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>1.0.0</verProc>` +
    `</ide>` +
    `<emit>` +
    `<CNPJ>${emit.cnpj.replace(/\D/g, '')}</CNPJ>` +
    `<xNome>${emit.razaoSocial.substring(0, 60)}</xNome>` +
    (emit.nomeFantasia ? `<xFant>${emit.nomeFantasia.substring(0, 60)}</xFant>` : '') +
    `<enderEmit>` +
    `<xLgr>${emit.logradouro.substring(0, 60)}</xLgr>` +
    `<nro>${emit.numero}</nro>` +
    `<xBairro>${emit.bairro.substring(0, 60)}</xBairro>` +
    `<cMun>${emit.codigoMunicipio}</cMun>` +
    `<xMun>${emit.municipio.substring(0, 60)}</xMun>` +
    `<UF>${emit.uf}</UF>` +
    `<CEP>${emit.cep.replace(/\D/g, '')}</CEP>` +
    `<cPais>1058</cPais><xPais>Brasil</xPais>` +
    (emit.telefone ? `<fone>${emit.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit>` +
    `<IE>${emit.ie.replace(/\D/g, '')}</IE>` +
    `<CRT>${emit.crt}</CRT>` +
    `</emit>` +
    // Destinatário opcional (NFC-e)
    (intencao.cpfConsumidor
      ? `<dest><CPF>${intencao.cpfConsumidor.replace(/\D/g, '')}</CPF></dest>`
      : intencao.cnpjConsumidor
        ? `<dest><CNPJ>${intencao.cnpjConsumidor.replace(/\D/g, '')}</CNPJ></dest>`
        : '') +
    items.map((item, idx) => xmlItem(item, idx, emit.crt)).join('') +
    `<total><ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>0.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${dec(total, 2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro><vNF>${dec(total, 2)}</vNF><vTotTrib>0.00</vTotTrib>` +
    `</ICMSTot></total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    xmlPagamentos(pagamentos, total, troco) +
    (intencao.observacoes ? `<infAdic><infCpl>${intencao.observacoes.substring(0, 2000)}</infCpl></infAdic>` : '') +
    `</infNFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="${VERSAO_NFE}" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe></nfeProc>`;
}

// ── Assinatura XMLDSig ───────────────────────────────────────────────────────

export function assinarXml(xmlSemAssinatura: string, privateKeyPem: string, certificatePem: string): string {
  // Extrai o XML da NFe sem o wrapper nfeProc para assinar
  const nfeMatch = xmlSemAssinatura.match(/<NFe[^>]*>([\s\S]*?)<\/NFe>/);
  if (!nfeMatch) throw new Error('NFe element não encontrado no XML.');

  const infNFeMatch = xmlSemAssinatura.match(/Id="(NFe[^"]+)"/);
  if (!infNFeMatch) throw new Error('Id infNFe não encontrado.');
  const refId = infNFeMatch[1];

  // Canonicalização C14N simples (exclusiva sem comentários) — suficiente para NF-e
  const infNFeXml = xmlSemAssinatura.match(/<infNFe[\s\S]*?<\/infNFe>/)?.[0] ?? '';
  const digestValue = crypto
    .createHash('sha1')
    .update(Buffer.from(infNFeXml, 'utf8'))
    .digest('base64');

  const signedInfo =
    `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    `<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>` +
    `<Reference URI="#${refId}">` +
    `<Transforms>` +
    `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
    `<Transform Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>` +
    `</Transforms>` +
    `<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>` +
    `<DigestValue>${digestValue}</DigestValue>` +
    `</Reference>` +
    `</SignedInfo>`;

  const signatureValue = crypto
    .createSign('RSA-SHA1')
    .update(Buffer.from(signedInfo, 'utf8'))
    .sign(privateKeyPem, 'base64');

  const certBody = certificatePem
    .replace(/-----BEGIN CERTIFICATE-----/, '')
    .replace(/-----END CERTIFICATE-----/, '')
    .replace(/\s/g, '');

  const signatureXml =
    `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
    signedInfo +
    `<SignatureValue>${signatureValue}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certBody}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature>`;

  return xmlSemAssinatura.replace('</infNFe>', `</infNFe>${signatureXml}`);
}

// ── QR Code NFC-e ────────────────────────────────────────────────────────────

export function gerarQRCode(
  chaveAcesso: string,
  tpAmb: '1' | '2',
  dhEmi: Date,
  vNF: number,
  dIgest: string,   // digestValue da assinatura
  cscId: string,    // ID CSC do portal SEFAZ (ex: "000001")
  csc: string,      // valor CSC completo
  urlBase: string,
): string {
  const valor = dec(vNF, 2);
  const dIgestEnc = encodeURIComponent(dIgest);
  const params = `chNFe=${chaveAcesso}&nVersao=100&tpAmb=${tpAmb}&cDest=&dhEmi=${Math.floor(dhEmi.getTime() / 1000)}&vNF=${valor}&vICMS=0.00&digVal=${dIgestEnc}&cIdToken=${cscId}`;
  const hash = crypto.createHash('sha1').update(params + csc).digest('hex').toUpperCase();
  return `${urlBase}?${params}&cHashQRCode=${hash}`;
}

/** Monta a seção <infNFeSupl> obrigatória para NFC-e (fora da área assinada) */
export function montarInfoNFeSupl(qrCode: string, urlConsulta: string): string {
  return `<infNFeSupl><qrCode><![CDATA[${qrCode}]]></qrCode><urlChave>${urlConsulta}</urlChave></infNFeSupl>`;
}
