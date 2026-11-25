export function encodeKdsBarcode(orderId: string | number, itemId: string): string {
  return `${orderId}|${itemId}`;
}

export function decodeKdsBarcode(barcode: string): { orderId: string; itemId: string } | null {
  const idx = barcode.indexOf('|');
  if (idx < 1) return null;
  return { orderId: barcode.slice(0, idx), itemId: barcode.slice(idx + 1) };
}

export function escPosCode128Bytes(data: string): number[] {
  const content = `{B${data}`;
  const bytes = Array.from(content, c => c.charCodeAt(0));
  return [
    0x1D, 0x68, 0x50,
    0x1D, 0x77, 0x02,
    0x1D, 0x48, 0x02,
    0x1D, 0x6B, 0x49,
    bytes.length,
    ...bytes,
  ];
}
