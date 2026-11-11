// Endpoints SEFAZ-MT verificados — NFC-e modelo 65 e NF-e modelo 55
// Fonte: Portaria 177/2021-SEFAZ-MT e Portal Nacional NF-e
// Confirmar versões antes de cada deploy em produção.

export const SEFAZ_MT = {
  nfce: {
    homologacao: {
      autorizacao:   'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
      statusServico: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4',
      consultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
      cancelamento:  'https://homologacao.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4',
      inutilizacao:  'https://homologacao.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4',
    },
    producao: {
      autorizacao:   'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeAutorizacao4',
      statusServico: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeStatusServico4',
      consultaProtocolo: 'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeConsulta4',
      cancelamento:  'https://nfce.sefaz.mt.gov.br/nfcews/services/RecepcaoEvento4',
      inutilizacao:  'https://nfce.sefaz.mt.gov.br/nfcews/services/NfeInutilizacao4',
    },
  },
  nfe: {
    // Portal Nacional NF-e — MT autorizador próprio
    homologacao: {
      autorizacao:   'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
      statusServico: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
      consultaProtocolo: 'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
      cancelamento:  'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4',
      inutilizacao:  'https://homologacao.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    },
    producao: {
      autorizacao:   'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeAutorizacao4',
      statusServico: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeStatusServico4',
      consultaProtocolo: 'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeConsulta4',
      cancelamento:  'https://nfe.sefaz.mt.gov.br/nfews/v2/services/RecepcaoEvento4',
      inutilizacao:  'https://nfe.sefaz.mt.gov.br/nfews/v2/services/NfeInutilizacao4',
    },
  },
} as const;

export type ModeloKey = 'nfce' | 'nfe';
export type AmbienteKey = 'homologacao' | 'producao';
export type ServicoKey = keyof typeof SEFAZ_MT.nfce.homologacao;

export function getEndpoint(modelo: ModeloKey, ambiente: AmbienteKey, servico: ServicoKey): string {
  return SEFAZ_MT[modelo][ambiente][servico];
}

// ── SVC-RS — contingência NF-e para MT (tpEmis='7' e EPEC tpEmis='4') ────────
// tpEmis='7': NF-e transmitida ao SVC-RS para autorização imediata
// tpEmis='4' (EPEC): evento 110140 ao SVC-RS; NF-e re-transmitida ao SEFAZ-MT depois
// Fonte: Portal Nacional NF-e / NT 2015.001 / NT 2024.001 / MOC NF-e 7.0
export const SVC_RS = {
  homologacao: {
    autorizacao:       'https://hom.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    statusServico:     'https://hom.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    consultaProtocolo: 'https://hom.svrs.rs.gov.br/ws/NfeConsulta/NFeConsulta4.asmx',
    recepcaoEvento:    'https://hom.svrs.rs.gov.br/ws/NfeRecepcaoEvento/NfeRecepcaoEvento4.asmx',
  },
  producao: {
    autorizacao:       'https://nfe.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    statusServico:     'https://nfe.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    consultaProtocolo: 'https://nfe.svrs.rs.gov.br/ws/NfeConsulta/NFeConsulta4.asmx',
    recepcaoEvento:    'https://nfe.svrs.rs.gov.br/ws/NfeRecepcaoEvento/NfeRecepcaoEvento4.asmx',
  },
} as const;

export type SvcRsServicoKey = keyof typeof SVC_RS.homologacao;

export function getSvcRsEndpoint(ambiente: AmbienteKey, servico: SvcRsServicoKey = 'recepcaoEvento'): string {
  return SVC_RS[ambiente][servico];
}

// cOrgao no infEvento do evento EPEC (SVC-RS)
export const C_ORGAO_SVC_RS = '91';

// Versão do layout NF-e/NFC-e usada na geração do XML
export const VERSAO_NFE = '4.00';

// URL de consulta NFC-e embutida no QR Code — deve ser validada em homologação
// antes de ativar produção (confirmar verAplic e URL aceita pelo autorizador MT).
// Fonte: SEFAZ-MT portal NFC-e [levantamento-fiscal-sefaz-mt §Web Services]
export const URL_QR_CONSULTA: Record<AmbienteKey, string> = {
  homologacao: 'https://homologacao.sefaz.mt.gov.br/nfceweb/consultarNFCe.jsf',
  producao:    'https://www.sefaz.mt.gov.br/nfce/consultanfce',
};

// cUF — código da UF Mato Grosso
export const C_UF_MT = '51';

// tpAmb — código de ambiente no XML
export const TP_AMB: Record<AmbienteKey, '1' | '2'> = { producao: '1', homologacao: '2' };

// Tabela de pagamento SEFAZ (tPag)
export const T_PAG: Record<string, string> = {
  dinheiro:  '01',
  cheque:    '02',
  credito:   '03',
  debito:    '04',
  crediario: '05',
  vale_alimentacao: '10',
  vale_refeicao:    '11',
  vale_presente:    '12',
  vale_combustivel: '13',
  boleto:    '15',
  deposito:  '16',
  pix:       '17',
  transferencia: '18',
  sem_pagamento: '90',
  outros:    '99',
};
