/**
 * Web Bluetooth BLE thermal printer utility.
 * Supports most common BLE ESC/POS printers (Rongta, MUNBYN, Xprinter, etc.).
 * Classic Bluetooth (SPP) is not accessible from browsers — BLE only.
 */

// Known BLE service / characteristic UUIDs for thermal printers
const SERVICES = [
  {
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    characteristic: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  {
    service: '000018f0-0000-1000-8000-00805f9b34fb',
    characteristic: '00002af1-0000-1000-8000-00805f9b34fb',
  },
  {
    // Nordic UART (used by some printers)
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    characteristic: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  },
];

export interface BTPrinterDevice {
  name: string;
  deviceId: string;
}

let _device: BluetoothDevice | null = null;
let _char: BluetoothRemoteGATTCharacteristic | null = null;

export function isBTAvailable(): boolean {
  return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
}

export async function requestBTPrinter(): Promise<BTPrinterDevice> {
  if (!isBTAvailable()) throw new Error('Web Bluetooth não disponível neste dispositivo/browser.');

  const device = await (navigator as any).bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: SERVICES.map(s => s.service),
  });

  _device = device;
  _char = null;
  return { name: device.name || 'Impressora BT', deviceId: device.id };
}

export async function connectBTPrinter(device?: BluetoothDevice): Promise<void> {
  const d = device || _device;
  if (!d) throw new Error('Nenhum dispositivo selecionado.');
  _device = d;

  const server = await d.gatt!.connect();

  for (const { service, characteristic } of SERVICES) {
    try {
      const svc = await server.getPrimaryService(service);
      _char = await svc.getCharacteristic(characteristic);
      return;
    } catch {
      // try next
    }
  }
  throw new Error('Nenhum serviço de impressão reconhecido nesta impressora.');
}

export async function printBT(data: Uint8Array): Promise<void> {
  if (!_char) throw new Error('Impressora não conectada.');

  // BLE write is limited — chunk in 200-byte pieces
  const CHUNK = 200;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await _char.writeValueWithoutResponse(chunk);
    await new Promise(r => setTimeout(r, 20)); // small delay between chunks
  }
}

export function disconnectBT(): void {
  if (_device?.gatt?.connected) _device.gatt.disconnect();
  _char = null;
}

export function getConnectedDevice(): BluetoothDevice | null {
  return _device;
}

// ── ESC/POS builders ───────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS  = 0x1d;
const LF  = 0x0a;

// CP437 encoding — default code page for most cheap ESC/POS thermal printers.
// Bytes 0x80-0xFF in CP437 are pseudo-graphics, NOT Latin-1.
// Chars absent from CP437 fall back to their base ASCII letter.
const TO_CP437_BT = new Map<number, number>([
  [0x00C7,0x80],[0x00FC,0x81],[0x00E9,0x82],[0x00E2,0x83],
  [0x00E4,0x84],[0x00E0,0x85],[0x00E5,0x86],[0x00E7,0x87],
  [0x00EA,0x88],[0x00EB,0x89],[0x00E8,0x8A],[0x00EF,0x8B],
  [0x00EE,0x8C],[0x00EC,0x8D],[0x00C4,0x8E],[0x00C5,0x8F],
  [0x00C9,0x90],[0x00E6,0x91],[0x00C6,0x92],[0x00F4,0x93],
  [0x00F6,0x94],[0x00F2,0x95],[0x00FB,0x96],[0x00F9,0x97],
  [0x00FF,0x98],[0x00D6,0x99],[0x00DC,0x9A],[0x00E1,0xA0],
  [0x00ED,0xA1],[0x00F3,0xA2],[0x00FA,0xA3],[0x00F1,0xA4],[0x00D1,0xA5],
  // Chars absent in CP437 — strip accent for readability
  [0x00C0,0x41],[0x00C1,0x41],[0x00C2,0x41],[0x00C3,0x41],
  [0x00C8,0x45],[0x00CA,0x45],[0x00CB,0x45],
  [0x00CC,0x49],[0x00CD,0x49],[0x00CE,0x49],[0x00CF,0x49],
  [0x00D2,0x4F],[0x00D3,0x4F],[0x00D4,0x4F],[0x00D5,0x4F],
  [0x00D9,0x55],[0x00DA,0x55],[0x00DB,0x55],
  [0x00E3,0x61],[0x00F5,0x6F],
]);
function encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) bytes.push(cp);
    else if (TO_CP437_BT.has(cp)) bytes.push(TO_CP437_BT.get(cp)!);
    else bytes.push(0x3F);
  }
  return new Uint8Array(bytes);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) { out.set(arr, offset); offset += arr.length; }
  return out;
}

const INIT      = new Uint8Array([ESC, 0x40]); // init printer (Windows-1252 default)
const BOLD_ON   = new Uint8Array([ESC, 0x45, 0x01]);
const BOLD_OFF  = new Uint8Array([ESC, 0x45, 0x00]);
const CENTER    = new Uint8Array([ESC, 0x61, 0x01]);
const LEFT      = new Uint8Array([ESC, 0x61, 0x00]);
const CUT       = new Uint8Array([GS,  0x56, 0x42, 0x00]);
const NL        = new Uint8Array([LF]);
const DASHES    = encode('--------------------------------\n');

export interface TicketOrder {
  id: string | number;
  tableId?: number | string;
  isComanda?: boolean;
  waiterName?: string;
  observations?: string;
  items: { name: string; price: number; quantity?: number; obs?: string; removed?: boolean }[];
}

export function buildOrderTicket(order: TicketOrder, establishmentName: string): Uint8Array {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const label = order.isComanda ? `Comanda ${order.tableId}` : `Mesa ${order.tableId}`;
  const items = (order.items || []).filter(i => !i.removed);

  const parts: Uint8Array[] = [
    INIT,
    CENTER, BOLD_ON, encode(`${establishmentName.toUpperCase()}\n`), BOLD_OFF,
    CENTER, encode(`PEDIDO #${String(order.id).slice(-4)}\n`),
    DASHES,
    LEFT,
    encode(`${label}${order.waiterName ? `  |  ${order.waiterName}` : ''}\n`),
    encode(`${now}\n`),
    DASHES,
  ];

  for (const item of items) {
    const qty = item.quantity ?? 1;
    const line = `${qty}x ${item.name}\n`;
    parts.push(encode(line));
    if (item.obs) parts.push(encode(`   Obs: ${item.obs}\n`));
  }

  parts.push(DASHES);
  if (order.observations) parts.push(encode(`Obs: ${order.observations}\n`), DASHES);
  parts.push(NL, NL, CUT);

  return concat(...parts);
}

export function buildReceiptTicket(
  order: TicketOrder,
  printerConfig: any,
): Uint8Array {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const items = (order.items || []).filter(i => !i.removed);
  const total = items.reduce((acc, i) => acc + i.price, 0);
  const label = order.isComanda ? `Comanda ${order.tableId}` : `Mesa ${order.tableId}`;

  const parts: Uint8Array[] = [
    INIT,
    CENTER, BOLD_ON, encode(`${(printerConfig?.establishmentName || 'ESTABELECIMENTO').toUpperCase()}\n`), BOLD_OFF,
    CENTER, encode(`${printerConfig?.receiptHeader || ''}\n`),
    CENTER, encode(`${printerConfig?.address || ''}\n`),
    DASHES,
    CENTER, BOLD_ON, encode(`${(printerConfig?.receiptTitle || 'COMPROVANTE').toUpperCase()}\n`), BOLD_OFF,
    DASHES,
    LEFT,
    encode(`${label}  #${String(order.id).slice(-4)}\n`),
    order.waiterName ? encode(`Garçom: ${order.waiterName}\n`) : new Uint8Array(),
    encode(`${now}\n`),
    DASHES,
  ];

  for (const item of items) {
    const qty = item.quantity ?? 1;
    const price = `R$ ${item.price.toFixed(2).replace('.', ',')}`;
    const name = `${qty}x ${item.name}`;
    // right-align price at 32 chars, price in bold
    const spaces = Math.max(1, 32 - name.length - price.length);
    parts.push(encode(`${name}${' '.repeat(spaces)}`), BOLD_ON, encode(`${price}\n`), BOLD_OFF);
  }

  parts.push(DASHES);
  const totalStr = `R$ ${total.toFixed(2).replace('.', ',')}`;
  const totalLine = `TOTAL:${' '.repeat(32 - 6 - totalStr.length)}${totalStr}\n`;
  parts.push(BOLD_ON, encode(totalLine), BOLD_OFF);
  parts.push(DASHES);
  if (printerConfig?.receiptFooter) parts.push(CENTER, encode(`${printerConfig.receiptFooter}\n`));
  parts.push(NL, NL, CUT);

  return concat(...parts);
}
