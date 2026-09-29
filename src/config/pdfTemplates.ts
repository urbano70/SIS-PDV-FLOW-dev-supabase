// Centralized configuration for all PDF templates.
// To add a new template: add an entry to PDF_TEMPLATES with a unique key.
// To change name position: edit the `name` field coordinates.
// To change font/color/size: edit the corresponding field.

export interface PdfFieldConfig {
  /** X center of the text field (in PDF points, origin = bottom-left of page) */
  centerX: number;
  /** Y baseline of the text (in PDF points, origin = bottom-left of page) */
  y: number;
  /** Maximum width the text may occupy */
  maxWidth: number;
  /** Largest font size to try first */
  maxFontSize: number;
  /** Smallest font size before text is truncated */
  minFontSize: number;
  /** Font key — must match a registered font name (or 'HelveticaBold' for built-in) */
  font: string;
  /** Hex color string */
  color: string;
}

export interface PdfTemplateConfig {
  /** Path relative to the project root public/ folder */
  file: string;
  /** Zero-based page index where the text is drawn */
  page: number;
  fields: {
    name: PdfFieldConfig;
    // Future fields (date, time, table, etc.) can be added here
    [key: string]: PdfFieldConfig;
  };
}

export const PDF_TEMPLATES: Record<string, PdfTemplateConfig> = {
  reservaPrincipal: {
    file: 'templates/reserva.pdf',
    page: 0,
    fields: {
      name: {
        // ── CONFIGURE AQUI a posição do nome no PDF ──
        // centerX: ponto X central do texto (origem = canto inferior esquerdo)
        // y: distância do canto inferior esquerdo até a linha de base do texto
        // Para A4 (595 × 842 pt): centro horizontal = 297, centro vertical = 421
        centerX: 297,
        y: 395,
        maxWidth: 400,
        maxFontSize: 42,
        minFontSize: 18,
        font: 'HelveticaBold', // Use 'HelveticaBold' (built-in) or a TTF key
        color: '#1a1a1a',
      },
    },
  },
};

export type TemplateId = keyof typeof PDF_TEMPLATES;
