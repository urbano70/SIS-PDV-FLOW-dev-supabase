// Extração de dados para o DANFE NFC-e (Documento Auxiliar da NFC-e)
// Browser-safe: sem dependências de Node.js.
// Fonte normativa: NT 2016.001 / MOC NFC-e 7.0

import type { IntencaoFiscal } from './types.js';

export interface DadosDanfe {
  // Emitente
  razaoSocial: string;
  nomeFantasia?: string;
  cnpjFormatado: string;
  ie: string;
  enderecoCompleto: string;

  // Identificação
  numero: number;
  serie: string;
  dhEmissao: string;    // "DD/MM/AAAA HH:MM:SS"

  // Status
  protocolo?: string;
  dhProtocolo?: string; // "DD/MM/AAAA HH:MM:SS"
  contingencia: boolean;

  // Consumidor
  cpfConsumidor?: string;   // formatado "000.000.000-00"
  cnpjConsumidor?: string;  // formatado "00.000.000/0000-00"
  xNomeConsumidor?: string;

  // Itens
  itens: Array<{
    seq: number;
    descricao: string;
    unidade: string;
    quantidade: number;
    valorUnitario: number;
    valorTotal: number;
  }>;

  // Totais
  totalProdutos: number;
  desconto: number;
  totalNota: number;

  // Pagamentos
  pagamentos: Array<{ descricao: string; valor: number }>;
  troco: number;

  // Chave e QR
  chaveAcesso: string;
  chaveAcessoFormatada: string; // "CCCC CCCC CCCC..." grupos de 4
  qrCodeUrl: string;
  urlConsulta: string;

  ambiente: 'homologacao' | 'producao';
  observacoes?: string;
}

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

function fmtCnpj(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function fmtCpf(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

function fmtCep(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{5})(\d{3})$/, '$1-$2');
}

function fmtChave(s: string): string {
  return s.replace(/(.{4})(?=.)/g, '$1 ');
}

function fmtDt(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const [Y, M, D] = [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(v => String(v).padStart(2, '0'));
    const [h, m, sec] = [d.getHours(), d.getMinutes(), d.getSeconds()].map(v => String(v).padStart(2, '0'));
    return `${D}/${M}/${Y} ${h}:${m}:${sec}`;
  } catch { return iso; }
}

function extrairQrCode(xml?: string): string {
  if (!xml) return '';
  return xml.match(/<qrCode><!\[CDATA\[([\s\S]*?)\]\]><\/qrCode>/)?.[1] ?? '';
}

function extrairUrlConsulta(xml?: string): string {
  if (!xml) return '';
  return xml.match(/<urlChave>([^<]+)<\/urlChave>/)?.[1] ?? '';
}

function extrairDhEmi(xml?: string): string {
  if (!xml) return '';
  return xml.match(/<dhEmi>([^<]+)<\/dhEmi>/)?.[1] ?? '';
}

export function extrairDadosDanfe(intencao: IntencaoFiscal): DadosDanfe {
  const emit = intencao.emitente;
  const totalProdutos = intencao.items.reduce((s, i) => s + i.valorTotal, 0);
  const totalNota = intencao.total;
  const desconto = Math.max(0, +(totalProdutos - totalNota).toFixed(2));

  const endereco = [
    `${emit.logradouro}, ${emit.numero}`,
    emit.bairro,
    `${emit.municipio} - ${emit.uf}`,
    `CEP ${fmtCep(emit.cep)}`,
    emit.telefone ? `Fone: ${emit.telefone}` : '',
  ].filter(Boolean).join(' · ');

  const dhEmiIso = extrairDhEmi(intencao.xmlAssinado) || intencao.criadoEm;

  return {
    razaoSocial:    emit.razaoSocial,
    nomeFantasia:   emit.nomeFantasia,
    cnpjFormatado:  fmtCnpj(emit.cnpj),
    ie:             emit.ie,
    enderecoCompleto: endereco,

    numero:   intencao.numero ?? 0,
    serie:    intencao.serie,
    dhEmissao: fmtDt(dhEmiIso),

    protocolo:    intencao.protocolo,
    dhProtocolo:  fmtDt(intencao.dhRecbto),
    contingencia: intencao.tpEmis !== '1',

    cpfConsumidor:   intencao.cpfConsumidor ? fmtCpf(intencao.cpfConsumidor) : undefined,
    cnpjConsumidor:  intencao.cnpjConsumidor ? fmtCnpj(intencao.cnpjConsumidor) : undefined,
    xNomeConsumidor: intencao.xNomeConsumidor,

    itens: intencao.items.map((item, idx) => ({
      seq:           idx + 1,
      descricao:     item.descricao,
      unidade:       item.unidade,
      quantidade:    item.quantidade,
      valorUnitario: item.valorUnitario,
      valorTotal:    item.valorTotal,
    })),

    totalProdutos,
    desconto,
    totalNota,

    pagamentos: intencao.pagamentos.map(p => ({
      descricao: p.xPag ?? TPAG[p.tPag] ?? `Pgto ${p.tPag}`,
      valor:     p.vPag,
    })),
    troco: intencao.troco ?? 0,

    chaveAcesso:          intencao.chaveAcesso ?? '',
    chaveAcessoFormatada: fmtChave(intencao.chaveAcesso ?? ''),
    qrCodeUrl:   extrairQrCode(intencao.xmlAssinado),
    urlConsulta: extrairUrlConsulta(intencao.xmlAssinado),
    ambiente:    intencao.ambiente,
    observacoes: intencao.observacoes,
  };
}
