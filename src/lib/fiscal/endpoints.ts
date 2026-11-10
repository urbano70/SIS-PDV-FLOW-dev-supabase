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

// Versão do layout NF-e/NFC-e usada na geração do XML
export const VERSAO_NFE = '4.00';

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
