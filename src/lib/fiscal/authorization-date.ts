const AUTHORIZED_STATUSES = new Set(['AUTORIZADO', 'AUTORIZADO_COM_ALERTA']);

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  return text || null;
}

/**
 * Retorna a data SEFAZ para preencher autorizado_em somente quando a
 * autorização foi confirmada e a coluna ainda não possui uma data.
 *
 * Retornos sem dhRecbto não recebem now artificial: a exportação mensal usa
 * seus fallbacks históricos (dh_recbto/created_at) até que exista uma data
 * fiscal confiável.
 */
export function authorizationDateFromResult(
  result: { status?: unknown; dhRecbto?: unknown },
  existingAuthorizedAt?: unknown,
): string | undefined {
  if (nonEmptyText(existingAuthorizedAt)) return undefined;
  if (!AUTHORIZED_STATUSES.has(nonEmptyText(result.status) || '')) return undefined;

  const rawDate = nonEmptyText(result.dhRecbto);
  if (!rawDate) return undefined;
  const parsed = new Date(rawDate);
  return Number.isNaN(parsed.getTime()) ? undefined : rawDate;
}
