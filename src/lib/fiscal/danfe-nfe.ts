// Extração de dados para o DANFE NF-e (Documento Auxiliar da Nota Fiscal Eletrônica)
// Browser-safe: sem dependências Node.js.
// Fonte normativa: NT 2003.003 / MOC NF-e 7.0

import type { IntencaoFiscal, ItemNota } from './types.js';

const TPAG: Record<string, string> = {
  '01': 'Dinheiro',      '02': 'Cheque',
  '03': 'Cartão Crédito','04': 'Cartão Débito',
  '05': 'Crediário',     '10': 'Vale Alimentação',
  '11': 'Vale Refeição', '12': 'Vale Presente',
  '13': 'Vale Combustível','15': 'Boleto',
  '16': 'Depósito',     '17': 'PIX',
  '18': 'Transferência', '90': 'Sem Pagamento',
  '99': 'Outros',
};

export interface ICMSTotais {
  vBC: number; vICMS: number; vBCST: number; vST: number;
  vProd: number; vFrete: number; vSeg: number; vDesc: number;
  vIPI: number; vIPIDevol: number; vPIS: number; vCOFINS: number;
  vOutro: number; vNF: number; vTotTrib: number;
}

export interface ItemDanfeNFe {
  seq: number;
  codigo: string;
  descricao: string;
  ncm: string;
  cfop: string;
  unidade: string;
  quantidade: number;
  valorUnitario: number;
  valorTotal: number;
  origem: string;
  cstOuCsosn: string;
  isSimples: boolean;
  bcICMS: number;
  vICMS: number;
  pICMS: number;
}

export interface DadosDanfeNFe {
  // Emitente
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjFormatado: string;
  ie: string;
  enderecoCompleto: string;
  municipioUF: string;
  cepFormatado: string;
  fone?: string;

  // Identificação
  numero: number;
  serie: string;
  dhEmissao: string;
  dhSaida: string;
  tpNF: 'SAÍDA' | 'ENTRADA';
  natOp: string;
  finNFe: string;

  // Status
  protocolo?: string;
  dhProtocolo?: string;
  contingencia: boolean;

  // Destinatário
  xNomeDest?: string;
  cnpjDestFormatado?: string;
  cpfDestFormatado?: string;

  // Totais
  totais: ICMSTotais;

  // Itens
  itens: ItemDanfeNFe[];

  // Pagamentos
  pagamentos: Array<{ descricao: string; valor: number }>;
  totalPago: number;

  // Chave e consulta
  chaveAcesso: string;
  chaveAcessoFormatada: string;
  urlConsulta: string;

  ambiente: 'homologacao' | 'producao';
  observacoes?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtCnpj(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') || s;
}

function fmtCpf(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') || s;
}

function fmtCep(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{5})(\d{3})$/, '$1-$2') || s;
}

function fmtChave(s: string): string {
  return s.replace(/(.{4})(?=.)/g, '$1 ');
}

function fmtDt(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const pad = (v: number) => String(v).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return iso; }
}

function xmlTag(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`))?.[1]?.trim() ?? '';
}

function extrairNatOp(xml?: string): string {
  return xml ? (xmlTag(xml, 'natOp') || 'VENDA DE MERCADORIA') : 'VENDA DE MERCADORIA';
}

function extrairTpNF(xml?: string): 'SAÍDA' | 'ENTRADA' {
  return xmlTag(xml ?? '', 'tpNF') === '0' ? 'ENTRADA' : 'SAÍDA';
}

function extrairFinNFe(xml?: string): string {
  const fins: Record<string, string> = { '1': 'Normal', '2': 'Complementar', '3': 'Ajuste', '4': 'Devolução' };
  return fins[xmlTag(xml ?? '', 'finNFe')] ?? 'Normal';
}

function extrairDhSaida(xml?: string): string {
  if (!xml) return '';
  const raw = xmlTag(xml, 'dhSaiEnt');
  return raw ? fmtDt(raw) : '';
}

function extrairDhEmi(xml?: string): string {
  if (!xml) return '';
  return fmtDt(xmlTag(xml, 'dhEmi'));
}

function extrairUrlConsulta(xml?: string): string {
  if (!xml) return '';
  // NF-e consulta MT
  const uf = xmlTag(xml, 'UF');
  return `https://www.sefaz.mt.gov.br/nfe/consultanfce.aspx`;
}

function extrairICMSTot(xml?: string): ICMSTotais {
  if (!xml) return { vBC:0, vICMS:0, vBCST:0, vST:0, vProd:0, vFrete:0, vSeg:0, vDesc:0, vIPI:0, vIPIDevol:0, vPIS:0, vCOFINS:0, vOutro:0, vNF:0, vTotTrib:0 };
  const g = (tag: string) => parseFloat(xmlTag(xml, tag) || '0') || 0;
  return {
    vBC: g('vBC'), vICMS: g('vICMS'), vBCST: g('vBCST'), vST: g('vST'),
    vProd: g('vProd'), vFrete: g('vFrete'), vSeg: g('vSeg'), vDesc: g('vDesc'),
    vIPI: g('vIPI'), vIPIDevol: g('vIPIDevol'), vPIS: g('vPIS'), vCOFINS: g('vCOFINS'),
    vOutro: g('vOutro'), vNF: g('vNF'), vTotTrib: g('vTotTrib'),
  };
}

function icmsDoItem(item: ItemNota, crt: string): { isSimples: boolean; cstOuCsosn: string; bc: number; vICMS: number; pICMS: number } {
  const isSimples = crt === '1' || crt === '2';
  if (isSimples) {
    return { isSimples: true, cstOuCsosn: item.csosn ?? '102', bc: 0, vICMS: 0, pICMS: 0 };
  }
  const bc = item.valorTotal;
  const p = 12;
  return { isSimples: false, cstOuCsosn: item.cst ?? '00', bc, vICMS: bc * (p / 100), pICMS: p };
}

// ── Extração principal ────────────────────────────────────────────────────────

export function extrairDadosDanfeNFe(intencao: IntencaoFiscal): DadosDanfeNFe {
  const { emitente: emit } = intencao;
  const xml = intencao.xmlAssinado;

  const totais = extrairICMSTot(xml);
  // Fallback: totalNota comes from IntencaoFiscal when XML not available
  if (!totais.vNF && intencao.total) {
    totais.vNF = intencao.total;
    totais.vProd = intencao.items.reduce((s, i) => s + i.valorTotal, 0);
  }

  const totalPago = intencao.pagamentos.reduce((s, p) => s + p.vPag, 0);

  return {
    razaoSocial:    emit.razaoSocial,
    nomeFantasia:   emit.nomeFantasia,
    cnpjFormatado:  fmtCnpj(emit.cnpj),
    ie:             emit.ie,
    enderecoCompleto: `${emit.logradouro}, ${emit.numero}${emit.bairro ? ' - ' + emit.bairro : ''}`,
    municipioUF:    `${emit.municipio} - ${emit.uf}`,
    cepFormatado:   fmtCep(emit.cep),
    fone:           emit.telefone,

    numero:   intencao.numero ?? 0,
    serie:    intencao.serie,
    dhEmissao: extrairDhEmi(xml) || fmtDt(intencao.criadoEm),
    dhSaida:   extrairDhSaida(xml),
    tpNF:     extrairTpNF(xml),
    natOp:    extrairNatOp(xml),
    finNFe:   extrairFinNFe(xml),

    protocolo:    intencao.protocolo,
    dhProtocolo:  fmtDt(intencao.dhRecbto),
    contingencia: intencao.tpEmis !== '1',

    xNomeDest:        intencao.xNomeConsumidor,
    cnpjDestFormatado: intencao.cnpjConsumidor ? fmtCnpj(intencao.cnpjConsumidor) : undefined,
    cpfDestFormatado:  intencao.cpfConsumidor  ? fmtCpf(intencao.cpfConsumidor)   : undefined,

    totais,

    itens: intencao.items.map((item, idx) => {
      const icms = icmsDoItem(item, emit.crt);
      return {
        seq:          idx + 1,
        codigo:       item.codigo,
        descricao:    item.descricao,
        ncm:          item.ncm,
        cfop:         item.cfop,
        unidade:      item.unidade,
        quantidade:   item.quantidade,
        valorUnitario: item.valorUnitario,
        valorTotal:   item.valorTotal,
        origem:       item.origem,
        cstOuCsosn:  icms.cstOuCsosn,
        isSimples:    icms.isSimples,
        bcICMS:       icms.bc,
        vICMS:        icms.vICMS,
        pICMS:        icms.pICMS,
      };
    }),

    pagamentos: intencao.pagamentos.map(p => ({
      descricao: p.xPag ?? TPAG[p.tPag] ?? `Pgto ${p.tPag}`,
      valor: p.vPag,
    })),
    totalPago,

    chaveAcesso:          intencao.chaveAcesso ?? '',
    chaveAcessoFormatada: fmtChave(intencao.chaveAcesso ?? ''),
    urlConsulta:          extrairUrlConsulta(xml),

    ambiente:    intencao.ambiente,
    observacoes: intencao.observacoes,
  };
}
