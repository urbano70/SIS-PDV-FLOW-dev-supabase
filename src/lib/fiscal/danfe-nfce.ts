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
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  telefone?: string;

  // Identificação
  nroNota: number;
  serie: string;
  dhEmissao: string;    // "DD/MM/AAAA HH:MM:SS"

  // Status
  protocolo?: string;
  dhProtocolo?: string; // "DD/MM/AAAA HH:MM:SS"
  contingencia: boolean;

  // Mesa (opcional — preenchido quando disponível no pedido)
  mesa?: string;

  // Consumidor
  cpfConsumidor?: string;   // formatado "000.000.000-00"
  cnpjConsumidor?: string;  // formatado "00.000.000/0000-00"
  xNomeConsumidor?: string;

  // Itens
  itens: Array<{
    seq: number;
    codigo: string;
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
  '01': 'DINHEIRO',      '02': 'CHEQUE',
  '03': 'CARTAO CREDITO','04': 'CARTAO DEBITO',
  '05': 'CREDIARIO',     '10': 'VALE ALIMENTACAO',
  '11': 'VALE REFEICAO', '12': 'VALE PRESENTE',
  '13': 'VALE COMBUSTIVEL','15': 'BOLETO',
  '16': 'DEPOSITO',     '17': 'PIX',
  '18': 'TRANSFERENCIA', '90': 'SEM PAGAMENTO',
  '99': 'OUTROS',
};

function fmtCnpj(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

function fmtCpf(s: string): string {
  const n = s.replace(/\D/g, '');
  return n.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
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
  // tenta com e sem CDATA
  return xml.match(/<qrCode><!\[CDATA\[([\s\S]*?)\]\]><\/qrCode>/)?.[1]
    ?? xml.match(/<qrCode>([^<]+)<\/qrCode>/)?.[1]
    ?? '';
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

  const dhEmiIso = extrairDhEmi(intencao.xmlAssinado) || intencao.criadoEm;

  // mesa pode vir em campo extra (intencao como any para compatibilidade)
  const extra = intencao as any;
  const mesa: string | undefined = extra.mesa ?? extra.mesaId ?? extra.tableId ?? undefined;

  return {
    razaoSocial:    emit.razaoSocial,
    nomeFantasia:   emit.nomeFantasia,
    cnpjFormatado:  fmtCnpj(emit.cnpj),
    ie:             emit.ie,
    logradouro:     emit.logradouro,
    numero:         emit.numero,
    bairro:         emit.bairro,
    municipio:      emit.municipio,
    uf:             emit.uf,
    telefone:       emit.telefone,

    nroNota:  intencao.numero ?? 0,
    serie:    intencao.serie,
    dhEmissao: fmtDt(dhEmiIso),

    protocolo:    intencao.protocolo,
    dhProtocolo:  fmtDt(intencao.dhRecbto),
    contingencia: intencao.tpEmis !== '1',

    mesa,

    cpfConsumidor:   intencao.cpfConsumidor ? fmtCpf(intencao.cpfConsumidor) : undefined,
    cnpjConsumidor:  intencao.cnpjConsumidor ? fmtCnpj(intencao.cnpjConsumidor) : undefined,
    xNomeConsumidor: intencao.xNomeConsumidor,

    itens: intencao.items.map((item, idx) => ({
      seq:           idx + 1,
      codigo:        item.codigo,
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
      descricao: (p.xPag ?? TPAG[p.tPag] ?? `PGTO ${p.tPag}`).toUpperCase(),
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
