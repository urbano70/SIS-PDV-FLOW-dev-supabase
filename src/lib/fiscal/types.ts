// Tipos fiscais internos — integração direta SEFAZ-MT
// Não expor ao browser. Usado somente pelo módulo server-side fiscal/.

// ── Estados de um documento fiscal ──────────────────────────────────────────
export type FiscalDocStatus =
  | 'RASCUNHO'
  | 'VALIDACAO_PENDENTE'
  | 'NUMERO_RESERVADO'
  | 'ASSINADO'
  | 'ENVIANDO'
  | 'PROCESSANDO'
  | 'AUTORIZADO'
  | 'AUTORIZADO_COM_ALERTA'
  | 'REJEITADO'
  | 'RESULTADO_DESCONHECIDO'
  | 'CONTINGENCIA_PENDENTE_TRANSMISSAO'
  | 'CANCELAMENTO_PENDENTE'
  | 'CANCELADO'
  | 'INUTILIZADO'
  | 'RETORNO_NAO_CLASSIFICADO';

export type AmbienteFiscal = 'homologacao' | 'producao';
export type ModeloFiscal = '55' | '65'; // NF-e | NFC-e
export type TipoEmissao = '1' | '9'; // normal | contingência offline

// ── Configuração do estabelecimento emitente ─────────────────────────────────
export interface EstabelecimentoFiscal {
  tenantId: string;
  cnpj: string;              // 14 dígitos, string pura
  ie: string;
  razaoSocial: string;
  nomeFantasia?: string;
  uf: string;                // MT
  codigoMunicipio: string;   // código IBGE 7 dígitos
  municipio: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cep: string;
  telefone?: string;
  crt: '1' | '2' | '3';     // Simples Nacional | SN Excesso | Regime Normal
  cnaePrincipal: string;
  cnaesSecundarios?: string[];

  // Séries e numeração por modelo/ambiente
  serieNFCeHom: string;
  serieNFCeProd: string;
  serieNFEHom: string;
  serieNFEProd: string;

  // CSC para NFC-e QR Code (separado por ambiente)
  cscHomId: string;
  cscHom: string;
  cscProdId: string;
  cscProd: string;

  ambiente: AmbienteFiscal;
}

// ── Referência ao certificado A1 (nunca o conteúdo) ─────────────────────────
export interface CertificadoRef {
  id: string;
  fingerprint: string;
  titular: string;
  cnpjTitular: string;
  emissora: string;
  serial: string;
  validadeInicio: string;
  validadeFim: string;
  estabelecimentosAutorizados: string[]; // CNPJs
  importadoEm: string;
  importadoPor: string;
}

// ── Item de nota fiscal ───────────────────────────────────────────────────────
export interface ItemNota {
  seq: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cest?: string;
  cfop: string;
  unidade: string;
  quantidade: number;         // Decimal — usar inteiro de centésimos ÷ 100 externamente
  valorUnitario: number;      // em reais, 10 casas decimais no XML
  valorTotal: number;         // em reais, 2 casas decimais
  origem: '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8';
  csosn?: string;             // Simples Nacional
  cst?: string;               // Regime Normal — ICMS
  piscofins: {
    cst: string;
    vBC?: number;
    pPIS?: number;
    vPIS?: number;
    pCOFINS?: number;
    vCOFINS?: number;
  };
  gtin?: string;              // '0' se não aplicável
}

// ── Pagamento ────────────────────────────────────────────────────────────────
export interface PagamentoNota {
  tPag: string;    // código tabela SEFAZ: '01' dinheiro, '03' cartão crédito, '04' débito, '17' pix...
  vPag: number;
  tpIntegra?: '1' | '2';  // 1=integrado, 2=não integrado
  cAut?: string;
  CNPJReceb?: string;
  idTermPag?: string;
  endToEndId?: string;    // Pix
  xPag?: string;          // descrição quando tPag='99'
}

// ── Intenção fiscal (snapshot imutável da operação) ──────────────────────────
export interface IntencaoFiscal {
  id: string;             // UUID gerado ao criar
  tenantId: string;
  orderId: string;
  modelo: ModeloFiscal;
  ambiente: AmbienteFiscal;
  serie: string;
  numero?: number;        // reservado transacionalmente
  chaveAcesso?: string;   // 44 dígitos
  status: FiscalDocStatus;
  tpEmis: TipoEmissao;

  emitente: EstabelecimentoFiscal;
  cpfConsumidor?: string;
  cnpjConsumidor?: string;
  xNomeConsumidor?: string;

  items: ItemNota[];
  pagamentos: PagamentoNota[];
  total: number;
  troco?: number;
  observacoes?: string;

  // Hashes e XMLs preservados
  hashPayload?: string;    // SHA-256 do snapshot comercial
  xmlAssinado?: string;
  xmlProcNfe?: string;     // procNFe = XML + protocolo

  // Resposta SEFAZ
  protocolo?: string;
  cStat?: string;
  xMotivo?: string;
  dhRecbto?: string;

  // Auditoria
  criadoEm: string;
  atualizadoEm: string;
  tentativas: TentativaTransmissao[];
}

export interface TentativaTransmissao {
  id: string;
  iniciadaEm: string;
  finalizadaEm?: string;
  resultado: 'SUCESSO' | 'FALHA' | 'TIMEOUT' | 'DESCONHECIDO';
  cStat?: string;
  xMotivo?: string;
  httpStatus?: number;
  rawResponse?: string;
}
