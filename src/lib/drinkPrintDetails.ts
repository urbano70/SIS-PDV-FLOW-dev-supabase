export interface DrinkPrintItem {
  observations?: string;
  obs?: string;
}

export interface DrinkProductionDetails {
  /** Each selected serving, followed by the optional with-order marker. */
  lines: string[];
  /** Non-drink observations that must remain in the ordinary observation block. */
  remainingObservation: string;
}

const SERVING_RE = /^(\d+)\s+copos?(?:\s*\(([^)]*)\))?$/i;
const WITH_ORDER_RE = /^junto\s+com\s+pedido$/i;

function normalizeOption(value: string): 'Gelo' | 'Limão' | null {
  const normalized = value.trim().toLocaleLowerCase('pt-BR');
  if (normalized === 'gelo') return 'Gelo';
  if (normalized === 'limão' || normalized === 'limao') return 'Limão';
  return null;
}

/**
 * The order-entry flow stores drink selections in item.observations as:
 * "2 copos (Gelo+Limão) · 1 copo (Gelo) · Junto com pedido".
 * Keep the parser deliberately strict so ordinary observations are not
 * accidentally turned into production options.
 */
export function getDrinkProductionDetails(item: DrinkPrintItem): DrinkProductionDetails {
  const raw = typeof item.observations === 'string' && item.observations.trim()
    ? item.observations
    : typeof item.obs === 'string' ? item.obs : '';
  if (!raw.trim()) return { lines: [], remainingObservation: '' };

  const servings: string[] = [];
  const remaining: string[] = [];
  let withOrder = false;

  // The middle-dot is the current separator; whitespace-wrapped pipes and
  // line breaks cover older imported orders without changing normal prose.
  const segments = raw.split(/\s*·\s*|\s+\|\s+|\r?\n/).map(part => part.trim()).filter(Boolean);
  for (const segment of segments) {
    if (WITH_ORDER_RE.test(segment)) {
      withOrder = true;
      continue;
    }

    const match = segment.match(SERVING_RE);
    if (!match) {
      remaining.push(segment);
      continue;
    }

    const cups = Number(match[1]);
    // A zero serving can be produced by an unfinished quantity dialog. It is
    // not a selected option and must never be printed.
    if (!Number.isFinite(cups) || cups <= 0) continue;

    const optionText = match[2]?.trim();
    const optionValues = optionText ? optionText.split('+').map(normalizeOption) : [];
    // Do not consume a serving-looking ordinary observation containing an
    // unknown option. Only the actual Gelo/Limão serialization is formatted.
    if (optionValues.some(option => option === null)) {
      remaining.push(segment);
      continue;
    }

    const options = optionValues.filter((option): option is 'Gelo' | 'Limão' => option !== null);
    const label = `${cups} ${cups === 1 ? 'copo' : 'copos'}${options.length ? ` (${options.join('+')})` : ''}`;
    servings.push(label);
  }

  if (withOrder) servings.push('Junto com pedido');
  return {
    lines: servings,
    remainingObservation: remaining.join(' · '),
  };
}
