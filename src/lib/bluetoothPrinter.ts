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

// CP850 mapping for Portuguese accented characters
// ESC/POS printers use CP850 (multilingual Latin), not UTF-8
const CP850: Record<string, number> = {
  'À':0xB7,'Á':0xB5,'Â':0xB6,'Ã':0xC7,'Ä':0x8E,'Å':0x8F,'Æ':0x92,'Ç':0x80,
  'È':0xD4,'É':0x90,'Ê':0xD2,'Ë':0xD3,'Ì':0xDE,'Í':0xD6,'Î':0xD7,'Ï':0xD8,
  'Ñ':0xA5,'Ò':0xE3,'Ó':0xE0,'Ô':0xE2,'Õ':0xE5,'Ö':0x99,'Ø':0x9D,'Ù':0xEB,
  'Ú':0xE9,'Û':0xEA,'Ü':0x9A,'ß':0xE1,'à':0x85,'á':0xA0,'â':0x83,'ã':0xC6,
  'ä':0x84,'å':0x86,'æ':0x91,'ç':0x87,'è':0x8A,'é':0x82,'ê':0x88,'ë':0x89,
  'ì':0x8D,'í':0xA1,'î':0x8C,'ï':0x8B,'ñ':0xA4,'ò':0x95,'ó':0xA2,'ô':0x93,
  'õ':0xE4,'ö':0x94,'ø':0x9B,'ù':0x97,'ú':0xA3,'û':0x96,'ü':0x81,'ÿ':0x98,
};

function encode(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) {
      bytes.push(ch.charCodeAt(0));
    } else {
      bytes.push(CP850[ch] ?? 0x3F); // '?' for unmapped chars
    }
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

const INIT      = new Uint8Array([ESC, 0x40, ESC, 0x74, 0x02]); // init + select CP850
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
