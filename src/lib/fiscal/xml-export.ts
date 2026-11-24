import { strToU8, zipSync } from 'fflate';

export const FISCAL_EXPORT_STATUSES = [
  'AUTORIZADO',
  'AUTORIZADO_COM_ALERTA',
  'CANCELADO',
  'EPEC_AUTORIZADO',
  'CONTINGENCIA_PENDENTE_TRANSMISSAO',
] as const;

/** Keep the raw ZIP below Resend's 40 MB post-base64 attachment limit. */
export const FISCAL_EXPORT_MAX_ZIP_BYTES = 28 * 1024 * 1024;
export const FISCAL_EXPORT_MAX_RECORDS = 10_000;

export interface FiscalExportNote {
  id?: string | number | null;
  tenant_id?: string | null;
  chave_acesso?: string | null;
  modelo?: string | null;
  ambiente?: string | null;
  status?: string | null;
  xml_assinado?: string | null;
  xml_proc_nfe?: string | null;
  autorizado_em?: string | null;
  dh_recbto?: string | null;
  created_at?: string | null;
}

export interface FiscalExportEvent {
  id?: string | number | null;
  tenant_id?: string | null;
  fiscal_note_id?: string | number | null;
  chave_acesso?: string | null;
  tp_evento?: string | null;
  status?: string | null;
  protocolo?: string | null;
  dh_evento?: string | null;
  xml_evento?: string | null;
  created_at?: string | null;
}

export interface FiscalMonth {
  year: number;
  month: number;
  start: Date;
  end: Date;
}

export interface FiscalExportSelection {
  notes: FiscalExportNote[];
  events: FiscalExportEvent[];
}

export interface FiscalExportMissing {
  kind: 'document' | 'event';
  reference: string;
  reason: 'xml_unavailable' | 'event_without_xml';
}

export interface FiscalExportZip {
  bytes: Uint8Array;
  notesIncluded: number;
  eventsIncluded: number;
  missing: FiscalExportMissing[];
}

export interface FiscalXmlEmailRequest {
  year: number;
  month: number;
  recipient: string;
}

const EMAIL_RE = /^[^\s@<>(),;:\\"']+@[^\s@<>(),;:\"']+\.[^\s@<>(),;:\"']+$/;
const FISCAL_UTC_OFFSET_HOURS = 4; // Mato Grosso: UTC−4; Date stores instants in UTC.

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const result = String(value).trim();
  return result ? result : null;
}

function parseDate(value: unknown): Date | null {
  const text = nonEmpty(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function fiscalMonthWindow(year: number, month: number): FiscalMonth {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Ano fiscal inválido.');
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês fiscal inválido.');
  return {
    year,
    month,
    start: new Date(Date.UTC(year, month - 1, 1, FISCAL_UTC_OFFSET_HOURS)),
    end: new Date(Date.UTC(year, month, 1, FISCAL_UTC_OFFSET_HOURS)),
  };
}

function inMonth(value: unknown, window: FiscalMonth): boolean {
  const date = parseDate(value);
  return Boolean(date && date >= window.start && date < window.end);
}

function noteTimestamp(note: FiscalExportNote): string | null {
  // New rows use autorizado_em; old rows fall back to the persisted SEFAZ receipt
  // and finally created_at so historical data remains exportable.
  return note.autorizado_em || note.dh_recbto || note.created_at || null;
}

function eventTimestamp(event: FiscalExportEvent): string | null {
  return event.dh_evento || event.created_at || null;
}

function noteReference(note: FiscalExportNote): string {
  return nonEmpty(note.id) || nonEmpty(note.chave_acesso) || 'nota-sem-identificador';
}

function eventBelongsToNote(event: FiscalExportEvent, note: FiscalExportNote): boolean {
  const eventNoteId = nonEmpty(event.fiscal_note_id);
  const eventKey = nonEmpty(event.chave_acesso);
  return (Boolean(eventNoteId && eventNoteId === nonEmpty(note.id))
    || Boolean(eventKey && eventKey === nonEmpty(note.chave_acesso)));
}

/**
 * Selects a monthly accounting package without dropping a prior-month note that
 * was cancelled in the requested month. Events are selected by their own date.
 */
export function selectMonthlyFiscalExport(
  notes: FiscalExportNote[],
  events: FiscalExportEvent[],
  year: number,
  month: number,
): FiscalExportSelection {
  const window = fiscalMonthWindow(year, month);
  const monthlyEvents = events.filter((event) => inMonth(eventTimestamp(event), window));
  const selectedNotes = notes.filter((note) => {
    if (!FISCAL_EXPORT_STATUSES.includes(String(note.status || '') as typeof FISCAL_EXPORT_STATUSES[number])) return false;
    return inMonth(noteTimestamp(note), window)
      || monthlyEvents.some((event) => eventBelongsToNote(event, note));
  });
  const selectedNoteSet = new Set(selectedNotes.map(noteReference));
  return {
    notes: selectedNotes,
    events: monthlyEvents.filter((event) => notes.some((note) => selectedNoteSet.has(noteReference(note)) && eventBelongsToNote(event, note))),
  };
}

function safeToken(value: unknown, fallback: string): string {
  const text = nonEmpty(value) || fallback;
  const safe = text.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return (safe || fallback).slice(0, 120);
}

function accessKey(note: FiscalExportNote): string {
  const key = nonEmpty(note.chave_acesso);
  return key && /^\d{44}$/.test(key) ? key : safeToken(note.id, 'nota-sem-chave');
}

function noteXml(note: FiscalExportNote): { xml: string | null; suffix: 'procNFe' | 'NFe' } {
  const processed = nonEmpty(note.xml_proc_nfe);
  if (processed) return { xml: processed, suffix: 'procNFe' };
  return { xml: nonEmpty(note.xml_assinado), suffix: 'NFe' };
}

/** Build a deterministic ZIP from server-selected fiscal rows only. */
export function buildFiscalXmlZip(selection: FiscalExportSelection): FiscalExportZip {
  const files: Record<string, Uint8Array> = {};
  const missing: FiscalExportMissing[] = [];
  const selectedNotes = selection.notes.filter((note) => FISCAL_EXPORT_STATUSES.includes(String(note.status || '') as typeof FISCAL_EXPORT_STATUSES[number]));

  for (const note of selectedNotes) {
    const reference = accessKey(note);
    const document = noteXml(note);
    if (!document.xml) {
      missing.push({ kind: 'document', reference, reason: 'xml_unavailable' });
      continue;
    }
    const environment = safeToken(note.ambiente, 'ambiente');
    const model = safeToken(note.modelo, 'fiscal');
    files[`documentos/${environment}-${model}-${reference}-${document.suffix}.xml`] = strToU8(document.xml);
  }

  for (const event of selection.events) {
    const reference = accessKey({ chave_acesso: event.chave_acesso, id: event.fiscal_note_id });
    const xml = nonEmpty(event.xml_evento);
    const eventType = safeToken(event.tp_evento, 'evento');
    if (!xml) {
      missing.push({ kind: 'event', reference: `${reference}-${eventType}`, reason: 'event_without_xml' });
      continue;
    }
    files[`eventos/${reference}-${eventType}-${safeToken(event.id, 'registro')}.xml`] = strToU8(xml);
  }

  if (Object.keys(files).length === 0) throw new Error('Nenhum XML disponível para o período selecionado.');
  if (missing.length > 0) {
    files['manifesto-ausencias.json'] = strToU8(JSON.stringify({
      aviso: 'Registros sem XML armazenado não foram fabricados; confira-os com o contador.',
      ausencias: missing,
    }, null, 2));
  }
  const bytes = zipSync(files, { level: 6 });
  if (bytes.byteLength > FISCAL_EXPORT_MAX_ZIP_BYTES) {
    throw new Error('O ZIP excede o limite seguro para anexo. Reduza o período ou faça o download em partes.');
  }
  return {
    bytes,
    notesIncluded: selectedNotes.filter((note) => Boolean(noteXml(note).xml)).length,
    eventsIncluded: selection.events.filter((event) => Boolean(nonEmpty(event.xml_evento))).length,
    missing,
  };
}

export function validateFiscalXmlEmailRequest(input: unknown): FiscalXmlEmailRequest {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const year = Number(body.year);
  const month = Number(body.month);
  const recipient = String(body.recipient || '').trim().toLowerCase();
  fiscalMonthWindow(year, month);
  if (recipient.length > 254 || !EMAIL_RE.test(recipient)) throw new Error('Informe um e-mail de contador válido.');
  return { year, month, recipient };
}

export function fiscalExportZipName(year: number, month: number): string {
  fiscalMonthWindow(year, month);
  return `xmls-${String(month).padStart(2, '0')}-${year}.zip`;
}
