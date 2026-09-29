/**
 * Manages the user-facing reservation configuration stored in localStorage.
 * This config is sent to the backend with each generation request and
 * overrides the default hardcoded values in PDF_TEMPLATES.
 */

const STORAGE_KEY = 'reservationConfig_v1';

export interface ReservationFieldConfig {
  centerX: number;
  y: number;
  maxWidth: number;
  maxFontSize: number;
  minFontSize: number;
  color: string;
}

export interface ReservationConfig {
  field: ReservationFieldConfig;
  /** Whether a custom template was successfully uploaded */
  hasCustomTemplate: boolean;
}

export const DEFAULT_CONFIG: ReservationConfig = {
  field: {
    centerX: 297.6,
    y: 257,
    maxWidth: 280,
    maxFontSize: 52,
    minFontSize: 16,
    color: '#0a0a0a',
  },
  hasCustomTemplate: false,
};

export function loadReservationConfig(): ReservationConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as ReservationConfig;
    // Merge with defaults to handle missing keys from older versions
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      field: { ...DEFAULT_CONFIG.field, ...parsed.field },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveReservationConfig(config: ReservationConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage may be unavailable
  }
}

/** Uploads a PDF template file to the server. Returns true on success. */
export async function uploadTemplate(file: File): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  const base64 = btoa(binary);

  const res = await fetch('/api/reservas/upload-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pdfBase64: base64 }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao enviar o template.');
  }
}
