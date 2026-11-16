export interface PizzaKitchenItem {
  flavors?: string[];
  crust?: string | null;
}

/** Details used only by pizza production tickets, not customer receipts. */
export function getPizzaKitchenDetails(item: PizzaKitchenItem) {
  // Both order-entry screens serialize selected crusts with " / ".
  const crusts = (item.crust || '')
    .split(' / ')
    .map(name => name.trim())
    .filter(Boolean);

  const counts = new Map<string, number>();
  for (const flavor of item.flavors || []) {
    counts.set(flavor, (counts.get(flavor) || 0) + 1);
  }
  const flavors = Array.from(counts, ([name, count]) => ({ name, count }));

  return { crusts, flavors };
}
