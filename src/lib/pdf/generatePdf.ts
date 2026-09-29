/**
 * Client-side wrapper that calls the backend PDF generation API.
 * Returns a Blob URL for preview and a suggested filename for download.
 */

export interface GeneratePdfParams {
  name: string;
  templateId?: string;
}

export interface GeneratePdfResult {
  blobUrl: string;
  filename: string;
}

export async function generateReservationPdf(
  params: GeneratePdfParams,
): Promise<GeneratePdfResult> {
  const { name, templateId = 'reservaPrincipal' } = params;

  const response = await fetch('/api/reservas/gerar-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim(), templateId }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? 'Não foi possível gerar a reserva. Tente novamente.');
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  const rawName = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  return { blobUrl, filename: `reserva-${rawName}.pdf` };
}
