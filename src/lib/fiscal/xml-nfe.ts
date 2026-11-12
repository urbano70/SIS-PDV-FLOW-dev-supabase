// Geração de XML NF-e modelo 55 — layout 4.00
// Referência: MOC 7.0, Portaria 160/2021-SEFAZ-MT, NT 2025.001, NT 2025.002-RTC
// Roda somente no servidor Node.js.
// Assinatura e transmissão: reutiliza assinarXml() de xml-nfce.ts e soapCall() de sefaz-soap.ts.

import type { IntencaoFiscal, ItemNota, PagamentoNota } from './types.js';
import { C_UF_MT, TP_AMB, VERSAO_NFE } from './endpoints.js';
import { assinarXml } from './xml-nfce.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function dec(v: number, digits: number): string {
  return v.toFixed(digits);
}

function pad(v: string | number, len: number, char = '0'): string {
  return String(v).padStart(len, char);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function digitoChave(chave43: string): string {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9];
  let soma = 0;
  for (let i = chave43.length - 1, p = 0; i >= 0; i--, p = (p + 1) % 8) {
    soma += parseInt(chave43[i]) * pesos[p];
  }
  const r = soma % 11;
  return r < 2 ? '0' : String(11 - r);
}

export function gerarChaveAcessoNFe(
  cUF: string, dhEmi: Date, cnpj: string,
  serie: string, nNF: number,
  tpEmis: string, cNF: string,
): string {
  // 2 dígitos do ano (AA) conforme NT NF-e: base43 = 43 chars → chave = 44 chars
  const aamm = `${String(dhEmi.getFullYear()).slice(-2)}${pad(dhEmi.getMonth() + 1, 2)}`;
  const cnpjL = cnpj.replace(/\D/g, '');
  const base43 =
    pad(cUF, 2) + aamm + pad(cnpjL, 14) + '55' +
    pad(serie, 3) + pad(nNF, 9) + pad(tpEmis, 1) + pad(cNF, 8);
  return base43 + digitoChave(base43);
}

// ── Item ─────────────────────────────────────────────────────────────────────

function xmlItemNFe(item: ItemNota, idx: number, crt: string): string {
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
    `<cProd>${esc(item.codigo)}</cProd>` +
    `<cEAN>${item.gtin ?? 'SEM GTIN'}</cEAN>` +
    `<xProd>${esc(item.descricao.substring(0, 120))}</xProd>` +
    `<NCM>${item.ncm}</NCM>` +
    (item.cest ? `<CEST>${item.cest}</CEST>` : '') +
    `<CFOP>${item.cfop}</CFOP>` +
    `<uCom>${esc(item.unidade)}</uCom>` +
    `<qCom>${dec(item.quantidade, 4)}</qCom>` +
    `<vUnCom>${dec(item.valorUnitario, 10)}</vUnCom>` +
    `<vProd>${dec(item.valorTotal, 2)}</vProd>` +
    `<cEANTrib>${item.gtin ?? 'SEM GTIN'}</cEANTrib>` +
    `<uTrib>${esc(item.unidade)}</uTrib>` +
    `<qTrib>${dec(item.quantidade, 4)}</qTrib>` +
    `<vUnTrib>${dec(item.valorUnitario, 10)}</vUnTrib>` +
    `<indTot>1</indTot>` +
    `</prod>` +
    `<imposto><vTotTrib>0.00</vTotTrib>${impostoICMS}${pis}</imposto>` +
    `</det>`;
}

// ── Pagamento ─────────────────────────────────────────────────────────────────

function xmlPagamentosNFe(pags: PagamentoNota[]): string {
  const detPag = pags.map(p =>
    `<detPag>` +
    (p.tpIntegra ? `<tpIntegra>${p.tpIntegra}</tpIntegra>` : '') +
    `<tPag>${p.tPag}</tPag>` +
    `<vPag>${dec(p.vPag, 2)}</vPag>` +
    (p.cAut ? `<card><tpIntegra>${p.tpIntegra ?? '2'}</tpIntegra><CNPJ>${p.CNPJReceb ?? ''}</CNPJ><tBand>99</tBand><cAut>${p.cAut}</cAut></card>` : '') +
    `</detPag>`
  ).join('');
  return `<pag>${detPag}</pag>`;
}

// ── Destinatário ──────────────────────────────────────────────────────────────

function xmlDestinatario(intencao: IntencaoFiscal): string {
  const { cpfConsumidor, cnpjConsumidor, xNomeConsumidor } = intencao;
  if (!cpfConsumidor && !cnpjConsumidor) return '';

  const id = cnpjConsumidor
    ? `<CNPJ>${cnpjConsumidor.replace(/\D/g, '')}</CNPJ>`
    : `<CPF>${cpfConsumidor!.replace(/\D/g, '')}</CPF>`;

  const nome = xNomeConsumidor
    ? `<xNome>${esc(xNomeConsumidor.substring(0, 60))}</xNome>`
    : '';

  // indIEDest: 9 = não contribuinte (padrão NF-e consumidor final)
  return `<dest>${id}${nome}<indIEDest>9</indIEDest></dest>`;
}

// ── Geração do XML NF-e ───────────────────────────────────────────────────────

export interface OpcoesNFe {
  /** natureza da operação — ex: "VENDA DE MERCADORIA" */
  natOp?: string;
  /** indicador de destino: 1=interno, 2=interestadual, 3=exterior */
  idDest?: '1' | '2' | '3';
  /** indicador de presença: 1=presencial, 2=não presencial internet, 3=não presencial teleatendimento, 4=NFC-e entrega, 5=presencial fora estabelecimento, 9=outros */
  indPres?: '1' | '2' | '3' | '4' | '5' | '9';
  /** finalidade: 1=normal, 2=complementar, 3=ajuste, 4=devolução */
  finNFe?: '1' | '2' | '3' | '4';
  /** dhCont e xJust — obrigatórios quando tpEmis != '1' */
  dhCont?: string;
  xJust?: string;
}

export function gerarXmlNFe(intencao: IntencaoFiscal, opts: OpcoesNFe = {}): string {
  const { emitente: emit, items, pagamentos } = intencao;
  if (!intencao.numero) throw new Error('Número da nota não reservado.');
  if (!intencao.chaveAcesso) throw new Error('Chave de acesso não gerada.');

  const tpAmb = TP_AMB[intencao.ambiente];
  const dhEmi = new Date(new Date().getTime() - 4 * 60 * 60 * 1000).toISOString().replace('Z', '') + '-04:00';
  const total = items.reduce((s, i) => s + i.valorTotal, 0);

  const natOp  = opts.natOp  ?? 'VENDA DE MERCADORIA';
  const idDest = opts.idDest ?? '1';
  const indPres = opts.indPres ?? '1';
  const finNFe  = opts.finNFe  ?? '1';

  const contingenciaFields = (intencao.tpEmis !== '1' && opts.dhCont && opts.xJust)
    ? `<dhCont>${opts.dhCont}</dhCont><xJust>${esc(opts.xJust.substring(0, 256))}</xJust>`
    : '';

  const infNFe =
    `<infNFe Id="NFe${intencao.chaveAcesso}" versao="${VERSAO_NFE}">` +
    `<ide>` +
    `<cUF>${C_UF_MT}</cUF>` +
    `<cNF>${intencao.chaveAcesso.substring(35, 43)}</cNF>` +
    `<natOp>${esc(natOp)}</natOp>` +
    `<mod>55</mod>` +
    `<serie>${String(parseInt(intencao.serie, 10) || 1)}</serie>` +
    `<nNF>${intencao.numero}</nNF>` +
    `<dhEmi>${dhEmi}</dhEmi>` +
    `<dhSaiEnt>${dhEmi}</dhSaiEnt>` +
    `<tpNF>1</tpNF>` +
    `<idDest>${idDest}</idDest>` +
    `<cMunFG>${emit.codigoMunicipio}</cMunFG>` +
    `<tpImp>1</tpImp>` +
    `<tpEmis>${intencao.tpEmis}</tpEmis>` +
    `<cDV>${intencao.chaveAcesso.slice(-1)}</cDV>` +
    `<tpAmb>${tpAmb}</tpAmb>` +
    `<finNFe>${finNFe}</finNFe>` +
    `<indFinal>1</indFinal>` +
    `<indPres>${indPres}</indPres>` +
    `<procEmi>0</procEmi>` +
    `<verProc>1.0.0</verProc>` +
    contingenciaFields +
    `</ide>` +
    `<emit>` +
    `<CNPJ>${emit.cnpj.replace(/\D/g, '')}</CNPJ>` +
    `<xNome>${esc(emit.razaoSocial.substring(0, 60))}</xNome>` +
    (emit.nomeFantasia ? `<xFant>${esc(emit.nomeFantasia.substring(0, 60))}</xFant>` : '') +
    `<enderEmit>` +
    `<xLgr>${esc(emit.logradouro.substring(0, 60))}</xLgr>` +
    `<nro>${esc(emit.numero)}</nro>` +
    `<xBairro>${esc(emit.bairro.substring(0, 60))}</xBairro>` +
    `<cMun>${emit.codigoMunicipio}</cMun>` +
    `<xMun>${esc(emit.municipio.substring(0, 60))}</xMun>` +
    `<UF>${emit.uf}</UF>` +
    `<CEP>${emit.cep.replace(/\D/g, '')}</CEP>` +
    `<cPais>1058</cPais><xPais>Brasil</xPais>` +
    (emit.telefone ? `<fone>${emit.telefone.replace(/\D/g, '')}</fone>` : '') +
    `</enderEmit>` +
    `<IE>${emit.ie.replace(/\D/g, '')}</IE>` +
    `<CRT>${emit.crt}</CRT>` +
    `</emit>` +
    xmlDestinatario(intencao) +
    items.map((item, idx) => xmlItemNFe(item, idx, emit.crt)).join('') +
    `<total><ICMSTot>` +
    `<vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson>` +
    `<vFCPUFDest>0.00</vFCPUFDest><vICMSUFDest>0.00</vICMSUFDest><vICMSUFRemet>0.00</vICMSUFRemet>` +
    `<vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet>` +
    `<vProd>${dec(total, 2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc>` +
    `<vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS>` +
    `<vOutro>0.00</vOutro><vNF>${dec(total, 2)}</vNF><vTotTrib>0.00</vTotTrib>` +
    `</ICMSTot></total>` +
    `<transp><modFrete>9</modFrete></transp>` +
    xmlPagamentosNFe(pagamentos) +
    (intencao.observacoes ? `<infAdic><infCpl>${esc(intencao.observacoes.substring(0, 2000))}</infCpl></infAdic>` : '') +
    `</infNFe>`;

  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc versao="${VERSAO_NFE}" xmlns="http://www.portalfiscal.inf.br/nfe"><NFe xmlns="http://www.portalfiscal.inf.br/nfe">${infNFe}</NFe></nfeProc>`;
}

export { assinarXml };
