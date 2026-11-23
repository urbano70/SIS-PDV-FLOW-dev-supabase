import { withSupabase } from 'npm:@supabase/server@1'
import { strToU8, zipSync } from 'npm:fflate@0.8.2'

const MAX_ZIP_BYTES = 28 * 1024 * 1024
const FISCAL_UTC_OFFSET_HOURS = 4 // Mato Grosso: UTC−4
const PAGE_SIZE = 500
const MAX_RECORDS = 10_000
const EXPORT_STATUSES = new Set([
  'AUTORIZADO',
  'AUTORIZADO_COM_ALERTA',
  'CANCELADO',
  'EPEC_AUTORIZADO',
  'CONTINGENCIA_PENDENTE_TRANSMISSAO',
])
const EMAIL_RE = /^[^\s@<>(),;:\\"']+@[^\s@<>(),;:\"']+\.[^\s@<>(),;:\"']+$/

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const result = String(value).trim()
  return result || null
}

function monthWindow(year: number, month: number): { start: Date; end: Date } {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Ano fiscal inválido.')
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error('Mês fiscal inválido.')
  return { start: new Date(Date.UTC(year, month - 1, 1, FISCAL_UTC_OFFSET_HOURS)), end: new Date(Date.UTC(year, month, 1, FISCAL_UTC_OFFSET_HOURS)) }
}

function inWindow(value: unknown, window: { start: Date; end: Date }): boolean {
  const raw = text(value)
  if (!raw) return false
  const date = new Date(raw)
  return !Number.isNaN(date.getTime()) && date >= window.start && date < window.end
}

function safe(value: unknown, fallback: string): string {
  const normalized = (text(value) || fallback)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return (normalized || fallback).slice(0, 120)
}

function keyOf(row: { id?: unknown; chave_acesso?: unknown }): string {
  const key = text(row.chave_acesso)
  return key && /^\d{44}$/.test(key) ? key : safe(row.id, 'nota-sem-chave')
}

function rowDate(row: Record<string, unknown>): string | null {
  return text(row.autorizado_em) || text(row.dh_recbto) || text(row.created_at)
}

function eventDate(row: Record<string, unknown>): string | null {
  return text(row.dh_evento) || text(row.created_at)
}

async function readAll(supabase: any, table: string, columns: string, tenantId: string, orderColumn: string): Promise<any[]> {
  const rows: any[] = []
  for (let offset = 0; offset < MAX_RECORDS; offset += PAGE_SIZE) {
    const result = await supabase
      .from(table)
      .select(columns)
      .eq('tenant_id', tenantId)
      .order(orderColumn, { ascending: true })
      .range(offset, Math.min(offset + PAGE_SIZE - 1, MAX_RECORDS - 1))
    if (result.error) throw new Error(`Falha ao consultar ${table}.`)
    rows.push(...(result.data || []))
    if (!result.data || result.data.length < PAGE_SIZE) break
  }
  return rows
}

function bytesToBase64(bytes: Uint8Array): string {
  let result = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(result)
}

async function idempotencyKey(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return `fiscal-xml-${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function maskedEmail(email: string): string {
  const [local, domain] = email.split('@')
  return `${(local?.slice(0, 1) || '*')}***@${domain}`
}

const handler = async (request: Request, ctx: any): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405)

  // The tenant is the authenticated owner id. No tenant value from the browser is trusted.
  const tenantId = text(ctx.userClaims?.sub) || text(ctx.userClaims?.id)
  if (!tenantId) return json({ error: 'Tenant do usuário autenticado não encontrado.' }, 403)

  let body: Record<string, unknown>
  try { body = await request.json() as Record<string, unknown> } catch { return json({ error: 'JSON inválido.' }, 400) }
  const year = Number(body.year)
  const month = Number(body.month)
  const recipient = String(body.recipient || '').trim().toLowerCase()
  let window: { start: Date; end: Date }
  try { window = monthWindow(year, month) } catch (error: any) { return json({ error: error.message }, 400) }
  if (recipient.length > 254 || !EMAIL_RE.test(recipient)) return json({ error: 'Informe um e-mail de contador válido.' }, 400)

  let notes: any[]
  let events: any[]
  try {
    notes = await readAll(ctx.supabaseAdmin, 'fiscal_notes', 'id,chave_acesso,xml_assinado,xml_proc_nfe,modelo,ambiente,status,autorizado_em,dh_recbto,created_at', tenantId, 'created_at')
    events = await readAll(ctx.supabaseAdmin, 'fiscal_note_events', 'id,fiscal_note_id,chave_acesso,tp_evento,status,protocolo,dh_evento,xml_evento,created_at', tenantId, 'dh_evento')
  } catch (error: any) {
    return json({ error: 'A migração fiscal de eventos ainda não foi aplicada; nenhum e-mail foi enviado.' }, 503)
  }

  const monthlyEvents = events.filter((event) => inWindow(eventDate(event), window))
  const selectedNotes = notes.filter((note) => EXPORT_STATUSES.has(String(note.status || '')) && (
    inWindow(rowDate(note), window)
    || monthlyEvents.some((event) => String(event.fiscal_note_id || '') === String(note.id || '') || String(event.chave_acesso || '') === String(note.chave_acesso || ''))
  ))
  const selectedNoteIds = new Set(selectedNotes.map((note) => String(note.id || note.chave_acesso || '')))
  const selectedEvents = monthlyEvents.filter((event) => selectedNotes.some((note) => selectedNoteIds.has(String(note.id || note.chave_acesso || '')) && (
    String(event.fiscal_note_id || '') === String(note.id || '') || String(event.chave_acesso || '') === String(note.chave_acesso || '')
  )))

  const files: Record<string, Uint8Array> = {}
  const missing: Array<{ kind: string; reference: string }> = []
  for (const note of selectedNotes) {
    const document = text(note.xml_proc_nfe) || text(note.xml_assinado)
    const reference = keyOf(note)
    if (!document) {
      missing.push({ kind: 'document', reference })
      continue
    }
    const suffix = text(note.xml_proc_nfe) ? 'procNFe' : 'NFe'
    files[`documentos/${safe(note.ambiente, 'ambiente')}-${safe(note.modelo, 'fiscal')}-${reference}-${suffix}.xml`] = strToU8(document)
  }
  for (const event of selectedEvents) {
    const reference = `${keyOf(event)}-${safe(event.tp_evento, 'evento')}`
    const document = text(event.xml_evento)
    if (!document) {
      missing.push({ kind: 'event', reference })
      continue
    }
    files[`eventos/${reference}-${safe(event.id, 'registro')}.xml`] = strToU8(document)
  }
  if (Object.keys(files).length === 0) return json({ error: 'Nenhum XML disponível para o período selecionado.' }, 404)
  if (missing.length > 0) files['manifesto-ausencias.json'] = strToU8(JSON.stringify({ aviso: 'XML ausente não foi fabricado.', ausencias: missing }, null, 2))

  const zip = zipSync(files, { level: 6 })
  if (zip.byteLength > MAX_ZIP_BYTES) return json({ error: 'O ZIP excede o limite seguro para anexo; baixe-o ou reduza o período.' }, 413)

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM')
  if (!apiKey || !from) return json({ error: 'Envio não configurado: faltam RESEND_API_KEY e RESEND_FROM na Edge Function.' }, 503)

  const zipName = `xmls-${String(month).padStart(2, '0')}-${year}.zip`
  const providerResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Idempotency-Key': await idempotencyKey(`${tenantId}:${year}:${month}:${recipient}`),
    },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: `XMLs fiscais — ${String(month).padStart(2, '0')}/${year}`,
      text: `Exportação fiscal mensal do período ${String(month).padStart(2, '0')}/${year}. Registros sem XML são informados no manifesto do ZIP.`,
      attachments: [{ filename: zipName, content: bytesToBase64(zip) }],
    }),
  })
  if (!providerResponse.ok) return json({ error: 'O provedor de e-mail recusou o envio; nenhum documento foi exposto.' }, 502)
  const providerBody = await providerResponse.json().catch(() => ({}))
  return json({
    ok: true,
    recipient: maskedEmail(recipient),
    year,
    month,
    notes: selectedNotes.length,
    events: selectedEvents.length,
    missing: missing.length,
    providerMessageId: text(providerBody?.id) || null,
  })
}

export default { fetch: withSupabase({ auth: 'user' }, handler) }
