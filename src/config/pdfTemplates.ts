// Centralized configuration for all PDF templates.

export interface PdfFieldConfig {
  /** X center of the text field (PDF points, origin = bottom-left) */
  centerX: number;
  /** Y baseline of the text (PDF points, origin = bottom-left) */
  y: number;
  /** Maximum width the text may occupy */
  maxWidth: number;
  maxFontSize: number;
  minFontSize: number;
  /** 'HelveticaBold' | 'TimesRomanBoldItalic' | 'TimesRomanBold' | etc. */
  font: string;
  /** Hex color string */
  color: string;
}

/** A single draw operation for a value onto the page */
export interface PdfDrawOp {
  /** Which value key to use (e.g. 'name') */
  valueKey: string;
  centerX: number;
  y: number;
  maxWidth: number;
  maxFontSize: number;
  minFontSize: number;
  font: string;
  color: string;
  /** Rotation in degrees — 0 = normal, 180 = upside-down (tent cards) */
  rotateDeg?: number;
  /**
   * Rectangle to fill with a solid color BEFORE drawing text.
   * Use this to cover placeholder bars in the template.
   * All values in PDF points.
   */
  coverRect?: { x: number; y: number; width: number; height: number; fillColor: string };
}

export interface PdfTemplateConfig {
  /** Path relative to project public/ folder */
  file: string;
  page: number;
  /**
   * All draw operations in order.
   * The first operation with valueKey='name' is the one shown in the config panel.
   */
  draws: PdfDrawOp[];
  /** Kept for the config panel UI — mirrors the first 'name' draw */
  fields: { name: PdfFieldConfig; [key: string]: PdfFieldConfig };
}

// ── Exact coordinates extracted from the Reservado_1.pdf template ──────────
// Page size: 595.5 × 842.2 pt (A4)
// Black bar (bottom, front of card): x=146.8  y=220.8  w=301.7  h=88.5  → center (297.6, 265.1)
// Black bar (top,  back  of card):   x=146.8  y=549.0  w=301.7  h=88.5  → center (297.6, 593.2)

export const PDF_TEMPLATES: Record<string, PdfTemplateConfig> = {
  reservaPrincipal: {
    file: 'templates/reserva.pdf',
    page: 0,
    draws: [
      // ── Frente (parte inferior, texto normal) ──────────────────────────
      {
        valueKey: 'name',
        centerX: 297.6,
        y: 257,
        maxWidth: 280,
        maxFontSize: 52,
        minFontSize: 16,
        font: 'TimesRomanBoldItalic',
        color: '#ffffff',
        rotateDeg: 0,
      },
      // ── Verso (parte superior, texto invertido 180°) ───────────────────
      {
        valueKey: 'name',
        centerX: 297.6,
        y: 601,
        maxWidth: 280,
        maxFontSize: 52,
        minFontSize: 16,
        font: 'TimesRomanBoldItalic',
        color: '#ffffff',
        rotateDeg: 180,
      },
    ],
    // Config panel uses this for the user-adjustable fields
    fields: {
      name: {
        centerX: 297.6,
        y: 257,
        maxWidth: 280,
        maxFontSize: 52,
        minFontSize: 16,
        font: 'TimesRomanBoldItalic',
        color: '#ffffff',
      },
    },
  },
};

export type TemplateId = keyof typeof PDF_TEMPLATES;
