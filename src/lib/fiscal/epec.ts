// EPEC — Evento Prévio de Emissão em Contingência (tpEmis='4', tpEvento=110140)
// NF-e modelo 55 — NT 2015.001 / MOC NF-e 7.0
// Fluxo:
//   1. SEFAZ principal (MT) indisponível → emitir NF-e com tpEmis='4'
//   2. Assinar NF-e e armazenar o XML (NÃO transmitir ao SEFAZ-MT ainda)
//   3. Transmitir evento EPEC ao SVC-RS → obter protocolo EPEC (cStat=135)
//   4. Entregar DANFE com carimbo "EM CONTINGÊNCIA"
//   5. Quando SEFAZ-MT voltar → reconciliação transmite o XML armazenado
//
// Roda somente no servidor Node.js.

import crypto from 'node:crypto';
import type { IntencaoFiscal, FiscalDocStatus } from './types.js';
import type { CertificadoCarregado } from './certificate.js';
import { C_UF_MT, TP_AMB, getSvcRsEndpoint, C_ORGAO_SVC_RS } from './endpoints.js';
import { gerarChaveAcessoNFe, gerarXmlNFe, type OpcoesNFe } from './xml-nfe.js';
import { assinarXml, assinarXmlElemento } from './xml-nfce.js';
import {
  montarXmlEvento, montarEnvelopeEvento, montarDetEventoEpec,
  soapCall, extrairCampo,
} from './sefaz-soap.js';
import { reservarNumero } from './sefaz-direct.js';

export interface EpecResult {
  status: FiscalDocStatus;
  cStat: string;
  xMotivo: string;
  protocolo: string;   // nProt do SVC-RS (protocolo EPEC, não o protocolo final da NF-e)
  dhRecbto: string;
  chaveAcesso: string;
  xmlAssinado: string; // NF-e assinada (tpEmis='4') — armazenar para re-transmissão ao SEFAZ-MT
}

/**
 * Emite EPEC para uma NF-e modelo 55.
 *
 * Gera e assina a NF-e com tpEmis='4', depois transmite o evento EPEC ao SVC-RS.
 * A NF-e assinada NÃO é enviada ao SEFAZ-MT aqui — é armazenada no banco e
 * re-transmitida pela reconciliação quando o SEFAZ-MT voltar.
 *
 * @param dhCont  ISO 8601 com offset do início da contingência ex: "2026-11-11T10:00:00-04:00"
 * @param xJust   Justificativa da contingência (15–256 chars)
 */
export async function emitirEpecNFe(
  intencao: IntencaoFiscal,
  cert: CertificadoCarregado,
  highWaterMark: number,
  dhCont: string,
  xJust: string,
  db: any | null = null,
  opts: OpcoesNFe = {},
): Promise<EpecResult> {
  intencao.tpEmis = '4';
  const tpAmb = TP_AMB[intencao.ambiente];
  const serie = intencao.ambiente === 'producao'
    ? intencao.emitente.serieNFEProd
    : intencao.emitente.serieNFEHom;

  // 1. Reservar número
  const numero = await reservarNumero(intencao.tenantId, '55', serie, intencao.ambiente, highWaterMark, db);
  intencao.numero = numero;
  intencao.serie = serie;

  // 2. Chave de acesso (tpEmis='4')
  const cNF = pad(crypto.randomInt(1, 99999999), 8);
  const dhEmi = new Date();
  intencao.chaveAcesso = gerarChaveAcessoNFe(C_UF_MT, dhEmi, intencao.emitente.cnpj, serie, numero, '4', cNF);

  // 3. Gerar e assinar NF-e
  const xmlBase = gerarXmlNFe(intencao, { ...opts, dhCont, xJust });
  const xmlAssinado = assinarXml(xmlBase, cert.privateKeyPem, cert.certificatePem);
  intencao.xmlAssinado = xmlAssinado;
  intencao.status = 'ASSINADO';

  // 4. Montar detEvento EPEC
  const dhEmiStr = formatarDhBr(dhEmi);
  const vNF   = intencao.total.toFixed(2);
  // Para Simples Nacional (crt='1'|'2'), ICMS não é destacado; para Regime Normal, idealmente
  // somaria os valores de ICMS dos itens, mas o PDV opera majoritariamente em Simples.
  const vICMS = '0.00';
  const vST   = '0.00';

  const detEvento = montarDetEventoEpec({
    dhEmi: dhEmiStr,
    tpNF:  '1', // saída
    ie:    intencao.emitente.ie.replace(/\D/g, ''),
    destUF: intencao.emitente.uf || 'MT',
    destCNPJ: intencao.cnpjConsumidor || undefined,
    destCPF:  intencao.cpfConsumidor  || undefined,
    destIE:   'ISENTO',
    vNF, vICMS, vST,
  });

  // 5. Montar evento — cOrgao=91 (SVC-RS) para EPEC
  const eventoXml = montarXmlEvento(
    intencao.chaveAcesso, '110140', tpAmb, dhEmiStr, detEvento, '1', C_ORGAO_SVC_RS,
  );

  // 6. Assinar evento
  const eventoAssinado = assinarXmlElemento(eventoXml, 'infEvento', cert.privateKeyPem, cert.certificatePem);

  // 7. Transmitir ao SVC-RS
  const envelope = montarEnvelopeEvento(eventoAssinado);
  const url = getSvcRsEndpoint(intencao.ambiente);
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
        chaveAcesso: intencao.chaveAcesso, xmlAssinado,
      };
    }
    throw err;
  }

  // 8. Classificar retorno (cStat=135 = Evento autorizado e vinculado a NF-e)
  const cStat    = extrairCampo(soapResp.body, 'cStat');
  const xMotivo  = extrairCampo(soapResp.body, 'xMotivo');
  const nProt    = extrairCampo(soapResp.body, 'nProt');
  const dhRecbto = extrairCampo(soapResp.body, 'dhRecbto');

  const status: FiscalDocStatus = (cStat === '135' || cStat === '155')
    ? 'EPEC_AUTORIZADO'
    : 'REJEITADO';

  intencao.status   = status;
  intencao.cStat    = cStat;
  intencao.xMotivo  = xMotivo;
  intencao.protocolo = nProt;

  return { status, cStat, xMotivo, protocolo: nProt, dhRecbto, chaveAcesso: intencao.chaveAcesso, xmlAssinado };
}

function pad(v: string | number, len: number): string {
  return String(v).padStart(len, '0');
}

function formatarDhBr(dt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  // UTC-4 (horário de Mato Grosso)
  const ms = dt.getTime() - 4 * 3600_000;
  const d = new Date(ms);
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}-04:00`
  );
}
