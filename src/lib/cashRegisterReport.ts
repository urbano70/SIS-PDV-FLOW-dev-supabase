export type CashRegisterReportType = 'open' | 'close';
export type CashReportPaperWidth = '80mm' | '50mm';

export interface CashReportPaymentRow {
  name: string;
  computed: number | null;
  entered: number | null;
  difference: number | null;
}

export interface CashReportValueRow {
  name: string;
  quantity: number;
  total: number;
}

export interface CashReportCardRow {
  brand: string;
  total: number;
}

export interface CashReportVoucherRow {
  name: string;
  date: string | null;
  total: number;
}

export interface CashReportMovementRow {
  type: string;
  amount: number;
  timestamp: string | null;
  note?: string;
}

export interface CashRegisterReportData {
  methodTotals?: Record<string, number>;
  enteredTotals?: Record<string, number>;
  productTotals?: Record<string, { qty: number; total: number }>;
  categoryTotals?: Record<string, { qty: number; total: number }>;
  categoryNames?: Record<string, string>;
  totalPaid?: number;
  totalGross?: number;
  totalDiscount?: number;
  totalNet?: number;
  totalCash?: number;
  cardTotals?: Record<string, number>;
  cardUnknownTotal?: number;
  vouchers?: CashReportVoucherRow[];
  totalVouchers?: number;
  cashMovements?: CashReportMovementRow[];
  openingFund?: number;
  closingFund?: number;
  userName?: string | null;
  orderCount?: number;
  paymentInventoryComplete?: boolean;
  cardInventoryComplete?: boolean;
  categoriesInventoryComplete?: boolean;
  productsInventoryComplete?: boolean;
}

export interface CashRegisterReportInput {
  type?: CashRegisterReportType;
  cashRegisterName?: string | null;
  shiftStartedAt?: string | null;
  createdAt?: string | null;
  userName?: string | null;
  reportData?: CashRegisterReportData | null;
}

export interface CashReportModel {
  type: CashRegisterReportType;
  width: number;
  cashRegisterName: string | null;
  shiftStartedAt: string | null;
  createdAt: string | null;
  userName: string | null;
  openingFund: number | null;
  closingFund: number | null;
  payments: CashReportPaymentRow[];
  products: CashReportValueRow[];
  categories: CashReportValueRow[];
  cards: CashReportCardRow[];
  vouchers: CashReportVoucherRow[];
  cashMovements: CashReportMovementRow[];
  totalGross: number | null;
  totalDiscount: number | null;
  totalNet: number | null;
  totalPaid: number | null;
  totalCash: number | null;
  totalCards: number | null;
  totalVouchers: number | null;
  availability: {
    payments: boolean;
    products: boolean;
    categories: boolean;
    cards: boolean;
    vouchers: boolean;
    cashMovements: boolean;
  };
}

export interface CashReportLine {
  text: string;
  bold?: boolean;
  double?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface CashReportDocument {
  model: CashReportModel;
  lines: CashReportLine[];
  text: string;
}

const KNOWN_PAYMENT_METHODS = [
  'Dinheiro',
  'Cheque',
  'Cartão',
  'Fiado',
  'PIX',
  'Bônus',
  'Cashback',
  'iFood',
  'Devolução',
];

const asFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const cleanText = (value: unknown): string | null => {
  const text = String(value ?? '').trim();
  return text ? text : null;
};

const normalizeKey = (value: string): string => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const paymentBucket = (name: string): string => {
  const key = normalizeKey(name);
  if (key.includes('cart') || key.includes('credito') || key.includes('debito')) return 'cartao';
  if (key.includes('dinheiro') || key === 'cash' || key.includes('avista')) return 'dinheiro';
  if (key.includes('cheque')) return 'cheque';
  if (key.includes('fiado') || key.includes('crediario')) return 'fiado';
  if (key === 'pix') return 'pix';
  if (key.includes('bonus')) return 'bonus';
  if (key.includes('cashback')) return 'cashback';
  if (key.includes('ifood') || key.includes('food')) return 'ifood';
  if (key.includes('devol')) return 'devolucao';
  return key;
};

const paymentDisplayName = (name: string): string => {
  const bucket = paymentBucket(name);
  const display: Record<string, string> = {
    dinheiro: 'Dinheiro', cheque: 'Cheque', cartao: 'Cartão', fiado: 'Fiado', pix: 'PIX',
    bonus: 'Bônus', cashback: 'Cashback', ifood: 'iFood', devolucao: 'Devolução',
  };
  return display[bucket] || cleanText(name) || 'Outros';
};

const isCashPayment = (name: string): boolean => paymentBucket(name) === 'dinheiro';
const isCardPayment = (name: string): boolean => paymentBucket(name) === 'cartao';

const optionalAmount = (...values: unknown[]): number | null => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      const number = asFiniteNumber(value);
      if (number !== null) return number;
    }
  }
  return null;
};

const normalizeTotals = (value: unknown): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const [name, raw] of Object.entries(asRecord(value))) {
    const amount = asFiniteNumber(raw);
    if (amount !== null) result[name] = amount;
  }
  return result;
};

const normalizeStringMap = (value: unknown): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [name, raw] of Object.entries(asRecord(value))) {
    const text = cleanText(raw);
    if (text) result[name] = text;
  }
  return result;
};

const normalizeValueTotals = (value: unknown): Record<string, { qty: number; total: number }> => {
  const result: Record<string, { qty: number; total: number }> = {};
  for (const [name, raw] of Object.entries(asRecord(value))) {
    const row = asRecord(raw);
    const total = asFiniteNumber(row.total);
    if (total === null) continue;
    result[name] = { qty: asFiniteNumber(row.qty) ?? 0, total };
  }
  return result;
};

const formatAmount = (value: number | null, currency = false): string => {
  if (value === null || !Number.isFinite(value)) return 'N/D';
  const amount = value.toFixed(2).replace('.', ',');
  return currency ? `R$ ${amount}` : amount;
};

const formatQuantity = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(3).replace('.', ',');

const formatDateTime = (value: string | null): string => {
  if (!value) return 'N/D';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'N/D';
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).replace(',', '');
};

const padLeft = (value: string, width: number): string => value.length >= width ? value.slice(-width) : value.padStart(width);
const padRight = (value: string, width: number): string => value.length >= width ? value.slice(0, width) : value.padEnd(width);

const wrapText = (value: string, width: number): string[] => {
  const text = value.trim() || 'N/D';
  if (text.length <= width) return [text];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      for (let offset = 0; offset < word.length; offset += width) lines.push(word.slice(offset, offset + width));
      continue;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['N/D'];
};

const row2 = (label: string, value: string, width: number): string[] => {
  const valueWidth = Math.min(Math.max(8, value.length), Math.floor(width * 0.55));
  const labelWidth = Math.max(1, width - valueWidth - 1);
  const labels = wrapText(label, labelWidth);
  const values = wrapText(value, valueWidth);
  const rowCount = Math.max(labels.length, values.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const left = labels[index] || '';
    const right = values[index] || '';
    return `${padRight(left, labelWidth)} ${padLeft(right, valueWidth)}`;
  });
};

const row3 = (name: string, quantity: string, total: string, width: number): string[] => {
  const totalWidth = Math.max(10, total.length + 1);
  const quantityWidth = Math.max(7, quantity.length + 1);
  const nameWidth = Math.max(1, width - quantityWidth - totalWidth);
  const names = wrapText(name, nameWidth);
  return names.map((part, index) => index === 0
    ? `${padRight(part, nameWidth)}${padLeft(quantity, quantityWidth)}${padLeft(total, totalWidth)}`
    : part);
};

const row4 = (name: string, computed: string, entered: string, difference: string, width: number): string => {
  const c2 = Math.max(8, computed.length + 1);
  const c3 = Math.max(8, entered.length + 1);
  const c4 = Math.max(8, difference.length + 1);
  const c1 = Math.max(1, width - c2 - c3 - c4);
  return `${padRight(name, c1)}${padLeft(computed, c2)}${padLeft(entered, c3)}${padLeft(difference, c4)}`;
};

const divider = (width: number, character = '-'): CashReportLine => ({ text: character.repeat(width) });
const section = (title: string, width: number): CashReportLine => {
  const inner = ` ${title} `;
  const left = Math.max(0, Math.floor((width - inner.length) / 2));
  return { text: `${'='.repeat(left)}${inner}${'='.repeat(Math.max(0, width - left - inner.length))}`, bold: true, align: 'center' };
};

const toRows = (
  totals: Record<string, { qty: number; total: number }>,
  categoryNames: Record<string, string>,
): CashReportValueRow[] => Object.entries(totals)
  .map(([name, row]) => ({ name: categoryNames[name] || name, quantity: row.qty, total: row.total }))
  .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'pt-BR'));

export interface CashReportOrderItem {
  name?: string;
  type?: string;
  price?: number;
  quantity?: number;
  discount?: number;
  discountType?: 'percentage' | 'value' | string;
  removed?: boolean;
}

export interface CashReportOrder {
  timestamp?: string;
  status?: string;
  items?: CashReportOrderItem[];
  discount?: number;
  discountType?: 'percentage' | 'value' | string;
  paymentLog?: Array<Record<string, any>>;
  partialPayments?: Array<Record<string, any>>;
}

export interface CashReportSummaryOptions {
  shiftStartedAt?: string | null;
  cashRegisterName?: string | null;
  categoryNames?: Record<string, string>;
}

export function getCashReportPayments(order: CashReportOrder): Array<Record<string, any>> {
  if (Array.isArray(order.paymentLog) && order.paymentLog.length > 0) return order.paymentLog;
  if (Array.isArray(order.partialPayments) && order.partialPayments.length > 0) return order.partialPayments;
  return [];
}

export function getCashReportItemNet(item: CashReportOrderItem): number {
  const gross = asFiniteNumber(item.price) ?? 0;
  const discount = asFiniteNumber(item.discount) ?? 0;
  if (!discount) return gross;
  if (item.discountType === 'percentage') return Math.max(0, gross * (1 - discount / 100));
  return Math.max(0, gross - discount);
}

export function summarizeCashRegisterOrders(
  orders: CashReportOrder[],
  options: CashReportSummaryOptions = {},
): CashRegisterReportData {
  const shiftMs = options.shiftStartedAt ? Date.parse(options.shiftStartedAt) : Number.NaN;
  const registerName = cleanText(options.cashRegisterName);
  const ordersInShift = orders.filter(order => {
    if (!Number.isFinite(shiftMs)) return true;
    const timestamp = order.timestamp ? Date.parse(order.timestamp) : Number.NaN;
    return !Number.isFinite(timestamp) || timestamp >= shiftMs;
  });
  const finishedOrders = ordersInShift.filter(order => order.status === 'finalizada');
  const allPayments = finishedOrders.flatMap(getCashReportPayments);
  const hasAttributedPayments = allPayments.some(payment => cleanText(payment.cashRegister) !== null);
  const filterByRegister = Boolean(registerName && hasAttributedPayments);
  const selectedOrders = filterByRegister
    ? finishedOrders.filter(order => getCashReportPayments(order).some(payment => String(payment.cashRegister ?? '') === registerName))
    : finishedOrders;
  const payments = selectedOrders.flatMap(getCashReportPayments)
    .filter(payment => !filterByRegister || String(payment.cashRegister ?? '') === registerName);
  const methodTotals: Record<string, number> = {};
  const enteredTotals: Record<string, number> = {};
  const cardTotals: Record<string, number> = {};
  let cardUnknownTotal = 0;
  let totalCash = 0;
  for (const payment of payments) {
    const method = cleanText(payment.method) || 'Outros';
    const amount = asFiniteNumber(payment.amount) ?? 0;
    methodTotals[method] = (methodTotals[method] || 0) + amount;
    if (isCashPayment(method)) totalCash += amount;
    if (isCardPayment(method)) {
      const brand = cleanText(payment.cardBrand ?? payment.brand ?? payment.bandeira);
      if (brand) cardTotals[brand] = (cardTotals[brand] || 0) + amount;
      else cardUnknownTotal += amount;
    }
    const entered = optionalAmount(payment.enteredAmount, payment.digitado, payment.countedAmount);
    if (entered !== null) enteredTotals[method] = (enteredTotals[method] || 0) + entered;
  }

  const productTotals: Record<string, { qty: number; total: number }> = {};
  const categoryTotals: Record<string, { qty: number; total: number }> = {};
  let totalGross = 0;
  let totalNet = 0;
  let totalDiscount = 0;
  for (const order of selectedOrders) {
    const orderItems: Array<{ name: string; type: string; quantity: number; gross: number; net: number }> = [];
    let orderGross = 0;
    for (const item of order.items || []) {
      if (item.removed) continue;
      const name = cleanText(item.name) || 'Item sem nome';
      const quantity = asFiniteNumber(item.quantity) ?? 1;
      const gross = asFiniteNumber(item.price) ?? 0;
      const net = getCashReportItemNet(item);
      orderGross += gross;
      const type = cleanText(item.type) || 'outros';
      orderItems.push({ name, type, quantity, gross, net });
    }
    const orderNet = orderItems.reduce((sum, item) => sum + item.net, 0);
    const orderDiscount = asFiniteNumber(order.discount) ?? 0;
    const discountValue = order.discountType === 'percentage'
      ? Math.max(0, orderNet * orderDiscount / 100)
      : Math.max(0, orderDiscount);
    const discountRatio = orderNet > 0 ? Math.min(1, discountValue / orderNet) : 0;
    for (const item of orderItems) {
      const net = Math.max(0, item.net * (1 - discountRatio));
      const currentProduct = productTotals[item.name] || { qty: 0, total: 0 };
      productTotals[item.name] = { qty: currentProduct.qty + item.quantity, total: currentProduct.total + net };
      const currentCategory = categoryTotals[item.type] || { qty: 0, total: 0 };
      categoryTotals[item.type] = { qty: currentCategory.qty + item.quantity, total: currentCategory.total + net };
    }
    totalGross += orderGross;
    totalDiscount += Math.max(0, orderGross - orderNet) + discountValue;
    totalNet += Math.max(0, orderNet - discountValue);
  }
  const totalPaid = payments.reduce((sum, payment) => sum + (asFiniteNumber(payment.amount) ?? 0), 0);
  return {
    methodTotals,
    enteredTotals,
    productTotals,
    categoryTotals,
    categoryNames: options.categoryNames,
    totalPaid,
    totalGross,
    totalDiscount,
    totalNet,
    totalCash,
    cardTotals,
    cardUnknownTotal,
    orderCount: selectedOrders.length,
    paymentInventoryComplete: true,
    cardInventoryComplete: true,
    categoriesInventoryComplete: true,
    productsInventoryComplete: true,
  };
}

export function normalizeCashRegisterReport(
  input: CashRegisterReportInput,
  paperWidth: CashReportPaperWidth = '80mm',
): CashReportModel {
  const data = asRecord(input.reportData);
  const width = paperWidth === '50mm' ? 32 : 48;
  const methodTotals = normalizeTotals(data.methodTotals);
  const enteredTotals = normalizeTotals(data.enteredTotals ?? data.digitadoTotals);
  const paymentNames = new Map<string, string>();
  Object.keys(methodTotals).forEach(name => paymentNames.set(paymentBucket(name), paymentDisplayName(name)));
  if (data.paymentInventoryComplete === true) {
    KNOWN_PAYMENT_METHODS.forEach(name => paymentNames.set(paymentBucket(name), name));
  }
  const payments: CashReportPaymentRow[] = [...paymentNames.entries()]
    .map(([bucket, name]) => {
      const computed = Object.entries(methodTotals)
        .filter(([method]) => paymentBucket(method) === bucket)
        .reduce((sum, [, amount]) => sum + amount, 0);
      const hasComputed = Object.keys(methodTotals).some(method => paymentBucket(method) === bucket) || data.paymentInventoryComplete === true;
      const entered = Object.entries(enteredTotals)
        .filter(([method]) => paymentBucket(method) === bucket)
        .reduce((sum, [, amount]) => sum + amount, 0);
      const hasEntered = Object.keys(enteredTotals).some(method => paymentBucket(method) === bucket);
      return {
        name,
        computed: hasComputed ? computed : null,
        entered: hasEntered ? entered : null,
        difference: hasComputed && hasEntered ? computed - entered : null,
      };
    })
    .sort((a, b) => KNOWN_PAYMENT_METHODS.indexOf(a.name) - KNOWN_PAYMENT_METHODS.indexOf(b.name) || a.name.localeCompare(b.name, 'pt-BR'));
  if (payments.length === 0) payments.push({ name: 'N/D — não coletado', computed: null, entered: null, difference: null });

  const productTotals = normalizeValueTotals(data.productTotals);
  const categoryTotals = normalizeValueTotals(data.categoryTotals);
  const categoryNames = normalizeStringMap(data.categoryNames);
  const products = toRows(productTotals, {});
  const categories = toRows(categoryTotals, categoryNames);
  const productAvailable = Object.prototype.hasOwnProperty.call(data, 'productTotals');
  const categoryAvailable = Object.prototype.hasOwnProperty.call(data, 'categoryTotals');

  const rawCardTotals = normalizeTotals(data.cardTotals);
  const cards: CashReportCardRow[] = Object.entries(rawCardTotals)
    .map(([brand, total]) => ({ brand, total }))
    .sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand, 'pt-BR'));
  const cardUnknown = asFiniteNumber(data.cardUnknownTotal);
  if (cardUnknown !== null && cardUnknown > 0) cards.push({ brand: 'Bandeira não informada', total: cardUnknown });
  const knownCardTotal = cards.reduce((sum, row) => sum + row.total, 0);
  const methodCardTotal = Object.entries(methodTotals)
    .filter(([name]) => isCardPayment(name))
    .reduce((sum, [, amount]) => sum + amount, 0);
  if (cards.length === 0 && methodCardTotal > 0) cards.push({ brand: 'Bandeira não informada', total: methodCardTotal });
  const cardAvailable = Object.prototype.hasOwnProperty.call(data, 'cardTotals') || cardUnknown !== null || methodCardTotal > 0;

  const rawVouchers = Array.isArray(data.vouchers) ? data.vouchers : null;
  const vouchers: CashReportVoucherRow[] = (rawVouchers || []).flatMap(raw => {
    const row = asRecord(raw);
    const total = asFiniteNumber(row.total ?? row.amount);
    if (total === null) return [];
    return [{ name: cleanText(row.name) || 'Não informado', date: cleanText(row.date ?? row.timestamp), total }];
  });
  const voucherTotal = optionalAmount(data.totalVouchers, rawVouchers ? vouchers.reduce((sum, row) => sum + row.total, 0) : undefined);

  const rawMovements = Array.isArray(data.cashMovements) ? data.cashMovements : null;
  const cashMovements: CashReportMovementRow[] = (rawMovements || []).flatMap(raw => {
    const row = asRecord(raw);
    const amount = asFiniteNumber(row.amount);
    if (amount === null) return [];
    return [{ type: cleanText(row.type) || 'Movimentação', amount, timestamp: cleanText(row.timestamp), note: cleanText(row.note) || undefined }];
  });

  const totalGross = optionalAmount(data.totalGross, productAvailable ? products.reduce((sum, row) => sum + row.total, 0) : undefined);
  const totalDiscount = optionalAmount(data.totalDiscount);
  const totalNet = optionalAmount(data.totalNet);
  const totalPaid = optionalAmount(data.totalPaid);
  const hasPaymentTotals = Object.keys(methodTotals).length > 0 || data.paymentInventoryComplete === true;
  const totalCash = optionalAmount(data.totalCash, hasPaymentTotals && totalPaid !== null
    ? payments.reduce((sum, row) => row.name === 'Dinheiro' ? sum + (row.computed ?? 0) : sum, 0)
    : undefined);
  const totalCards = cardAvailable ? (knownCardTotal || methodCardTotal) : null;
  return {
    type: input.type || 'close',
    width,
    cashRegisterName: cleanText(input.cashRegisterName),
    shiftStartedAt: cleanText(input.shiftStartedAt),
    createdAt: cleanText(input.createdAt),
    userName: cleanText(input.userName) || cleanText(data.userName),
    openingFund: optionalAmount(data.openingFund, data.openingAmount),
    closingFund: optionalAmount(data.closingFund, data.closingAmount),
    payments,
    products,
    categories,
    cards,
    vouchers,
    cashMovements,
    totalGross,
    totalDiscount,
    totalNet,
    totalPaid,
    totalCash,
    totalCards,
    totalVouchers: voucherTotal,
    availability: {
      payments: Object.keys(methodTotals).length > 0 || data.paymentInventoryComplete === true,
      products: productAvailable,
      categories: categoryAvailable,
      cards: cardAvailable,
      vouchers: rawVouchers !== null || data.totalVouchers !== undefined,
      cashMovements: rawMovements !== null,
    },
  };
}

function buildCashReportLines(model: CashReportModel): CashReportLine[] {
  const lines: CashReportLine[] = [];
  const push = (text = '', options: Omit<CashReportLine, 'text'> = {}) => lines.push({ text, ...options });
  const pushLines = (texts: string[], options: Omit<CashReportLine, 'text'> = {}) => {
    texts.forEach(text => push(text, options));
  };
  push('RELATÓRIO DE CAIXA', { bold: true, double: true, align: 'center' });
  push('');
  pushLines(row2('Cx:', model.cashRegisterName || 'N/D', model.width));
  pushLines(row2('Abertura:', formatDateTime(model.shiftStartedAt), model.width));
  pushLines(row2('Fechamento:', formatDateTime(model.createdAt), model.width));
  pushLines(row2('Fundo de Caixa:', formatAmount(model.openingFund, true), model.width));
  if (model.closingFund !== null) pushLines(row2('Fundo no fechamento:', formatAmount(model.closingFund, true), model.width));
  lines.push(divider(model.width, '='));

  lines.push(section('MEIOS DE PAGAMENTO', model.width));
  push(row4('Meio', 'Computado', 'Digitado', 'Diferença', model.width), { bold: true });
  lines.push(divider(model.width));
  for (const row of model.payments) {
    push(row4(row.name, formatAmount(row.computed), formatAmount(row.entered), formatAmount(row.difference), model.width));
  }
  lines.push(divider(model.width));
  pushLines(row2('TOTAL RECEBIDO:', formatAmount(model.totalPaid, true), model.width), { bold: true });
  pushLines(row2('TOTAL A VISTA:', formatAmount(model.totalCash, true), model.width), { bold: true });

  lines.push(section('MOVIMENTAÇÕES', model.width));
  if (model.cashMovements.length === 0) push('N/D — movimentações não coletadas');
  for (const movement of model.cashMovements) {
    const suffix = movement.timestamp ? ` · ${formatDateTime(movement.timestamp)}` : '';
    pushLines(row2(`${movement.type}${suffix}:`, formatAmount(movement.amount, true), model.width));
    if (movement.note) pushLines(wrapText(`  ${movement.note}`, model.width));
  }

  lines.push(section('VENDAS', model.width));
  push(row3('Produto', 'Qtde', 'Total', model.width)[0], { bold: true });
  lines.push(divider(model.width));
  if (model.products.length === 0) {
    push(model.availability.products ? 'Nenhuma venda registrada.' : 'N/D — produtos não coletados');
  } else {
    for (const row of model.products) {
      row3(row.name, formatQuantity(row.quantity), formatAmount(row.total), model.width).forEach(text => push(text));
    }
  }
  lines.push(divider(model.width));
  pushLines(row2('TOTAL VENDIDO BRUTO:', formatAmount(model.totalGross, true), model.width), { bold: true });
  pushLines(row2('Descontos:', formatAmount(model.totalDiscount, true), model.width), { bold: true });
  pushLines(row2('TOTAL VENDIDO LÍQUIDO:', formatAmount(model.totalNet, true), model.width), { bold: true });

  lines.push(section('CARTÕES', model.width));
  if (model.cards.length === 0) {
    push(model.availability.cards ? 'Nenhum cartão registrado.' : 'N/D — bandeiras não coletadas');
  } else {
    for (const row of model.cards) pushLines(row2(row.brand + ':', formatAmount(row.total, true), model.width));
  }
  pushLines(row2('TOTAL CARTÕES:', formatAmount(model.totalCards, true), model.width), { bold: true });

  lines.push(section('CLASSES', model.width));
  push(row3('Classe', 'Qtde', 'Total', model.width)[0], { bold: true });
  lines.push(divider(model.width));
  if (model.categories.length === 0) {
    push(model.availability.categories ? 'Nenhuma classe registrada.' : 'N/D — classes não coletadas');
  } else {
    for (const row of model.categories) row3(row.name, formatQuantity(row.quantity), formatAmount(row.total), model.width).forEach(text => push(text));
  }
  lines.push(divider(model.width));
  const classTotal = model.totalNet ?? (model.categories.length > 0 ? model.categories.reduce((sum, row) => sum + row.total, 0) : null);
  pushLines(row2('TOTAL CLASSES:', formatAmount(classTotal, true), model.width), { bold: true });

  lines.push(section('VALES', model.width));
  push(row3('Nome', 'Data', 'Total', model.width)[0], { bold: true });
  lines.push(divider(model.width));
  if (model.vouchers.length === 0) {
    push(model.availability.vouchers ? 'Nenhum vale registrado.' : 'N/D — vales não coletados');
  } else {
    for (const row of model.vouchers) row3(row.name, row.date ? formatDateTime(row.date).slice(0, 10) : 'N/D', formatAmount(row.total), model.width).forEach(text => push(text));
  }
  lines.push(divider(model.width));
  pushLines(row2('TOTAL VALES:', formatAmount(model.totalVouchers, true), model.width), { bold: true });
  push('');
  pushLines(row2('Usuário:', model.userName || 'N/D — usuário não informado', model.width));
  return lines;
}

export function buildCashRegisterReportDocument(
  input: CashRegisterReportInput,
  paperWidth: CashReportPaperWidth = '80mm',
): CashReportDocument {
  const model = normalizeCashRegisterReport(input, paperWidth);
  const lines = buildCashReportLines(model);
  return { model, lines, text: lines.map(line => line.text).join('\n') };
}

const CP850: Record<number, number> = {
  0x00E7: 0x87, 0x00FC: 0x81, 0x00E9: 0x82, 0x00E2: 0x83, 0x00E4: 0x84, 0x00E0: 0x85,
  0x00EA: 0x88, 0x00EB: 0x89, 0x00E8: 0x8A, 0x00EF: 0x8B, 0x00EE: 0x8C, 0x00EC: 0x8D,
  0x00E1: 0xA0, 0x00ED: 0xA1, 0x00F3: 0xA2, 0x00FA: 0xA3, 0x00F1: 0xA4, 0x00F4: 0x93,
  0x00F6: 0x94, 0x00F2: 0x95, 0x00FB: 0x96, 0x00F9: 0x97, 0x00FF: 0x98, 0x00E3: 0xC6,
  0x00F5: 0xE4, 0x00C7: 0x80, 0x00C9: 0x90, 0x00C4: 0x8E, 0x00C5: 0x8F, 0x00D6: 0x99,
  0x00DC: 0x9A, 0x00D1: 0xA5, 0x00C1: 0xB5, 0x00C0: 0xB7, 0x00C2: 0xB6, 0x00C3: 0xC7,
  0x00D5: 0xE5, 0x00C8: 0xD4, 0x00CA: 0xD2, 0x00CD: 0xD6, 0x00D3: 0xE0, 0x00DA: 0xE9,
  0x00B0: 0xF8,
};

export function encodeCashReportText(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint < 128) bytes.push(codePoint);
    else bytes.push(CP850[codePoint] ?? 0x3F);
  }
  return new Uint8Array(bytes);
}

export function buildCashRegisterReportEscPos(
  input: CashRegisterReportInput,
  paperWidth: CashReportPaperWidth = '80mm',
): Uint8Array {
  const document = buildCashRegisterReportDocument(input, paperWidth);
  const bytes: number[] = [];
  const push = (...values: number[]) => bytes.push(...values);
  const text = (value: string) => { bytes.push(...encodeCashReportText(value)); };
  const lineFeed = () => push(0x0A);
  const alignment = (value: CashReportLine['align']) => push(0x1B, 0x61, value === 'center' ? 1 : value === 'right' ? 2 : 0);
  let previousBold = false;
  let previousDouble = false;
  push(0x1B, 0x40, 0x1B, 0x74, 0x02);
  if (paperWidth === '80mm') push(0x1D, 0x57, 0x4C, 0x02); // 588 dots / 73.6 mm printable area on MP-4200 TH
  for (const line of document.lines) {
    alignment(line.align || 'left');
    if (line.bold !== previousBold) { push(0x1B, 0x45, line.bold ? 1 : 0); previousBold = Boolean(line.bold); }
    if (line.double !== previousDouble) { push(0x1D, 0x21, line.double ? 0x11 : 0x00); previousDouble = Boolean(line.double); }
    text(line.text);
    lineFeed();
  }
  if (previousDouble) push(0x1D, 0x21, 0x00);
  if (previousBold) push(0x1B, 0x45, 0x00);
  push(0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x42, 0x00);
  return new Uint8Array(bytes);
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export function renderCashRegisterReportHtml(
  input: CashRegisterReportInput,
  paperWidth: CashReportPaperWidth = '80mm',
): string {
  const document = buildCashRegisterReportDocument(input, paperWidth);
  const lines = document.lines.map(line => {
    const classes = [line.bold ? 'bold' : '', line.double ? 'double' : '', line.align || 'left'].filter(Boolean).join(' ');
    return `<div class="line ${classes}">${escapeHtml(line.text) || '&nbsp;'}</div>`;
  }).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório de caixa</title><style>` +
    `@page{size:${paperWidth} auto;margin:0}` +
    `html,body{margin:0;padding:0;background:#fff}` +
    `.cash-report{width:${paperWidth === '80mm' ? '72mm' : '48mm'};padding:0 1mm;box-sizing:border-box;color:#000;font:10px/1.25 "Courier New",monospace}` +
    `.line{white-space:pre-wrap;overflow-wrap:anywhere;min-height:1.25em}` +
    `.line.bold{font-weight:700}.line.double{font-size:14px;line-height:1.4;font-weight:700}` +
    `.line.center{text-align:center}.line.right{text-align:right}` +
    `@media print{.cash-report{width:${paperWidth === '80mm' ? '72mm' : '48mm'};padding:0 1mm}}` +
    `</style></head><body><main class="cash-report">${lines}</main></body></html>`;
}
