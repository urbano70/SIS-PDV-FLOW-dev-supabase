import React from 'react';
import { CheckCircle2, ChefHat, Clock, Flame, BellRing } from 'lucide-react';
import type { MenuCategory, PizzaItem } from '../types';
import { getKitchenStage, isKitchenTracked, isPlaygroundItem, KITCHEN_STAGE_LABELS } from '../lib/kitchenStatus';

interface Props {
  item: PizzaItem;
  enabled: boolean;
  menu?: MenuCategory[];
}

const colors = {
  waiting: 'bg-zinc-100 text-zinc-700',
  preparing: 'bg-amber-100 text-amber-800',
  oven: 'bg-orange-100 text-orange-800',
  ready: 'bg-green-100 text-green-800',
};
const icons = { waiting: Clock, preparing: ChefHat, oven: Flame, ready: BellRing };

export default function KitchenItemStatusBadge({ item, enabled, menu = [] }: Props) {
  if (item.removed || isPlaygroundItem(item)) return null;
  if (item.deliveredAt) {
    const date = new Date(item.deliveredAt);
    const validDate = !Number.isNaN(date.getTime());
    const time = validDate ? date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
    const dateLabel = validDate ? date.toLocaleString('pt-BR') : item.deliveredAt;
    return (
      <span className="inline-flex flex-wrap items-center gap-1 rounded-md bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-800"
        title={`Entregue${item.deliveredBy ? ` por ${item.deliveredBy}` : ''}${dateLabel ? ` em ${dateLabel}` : ''}`}>
        <CheckCircle2 size={12} aria-hidden="true" /> Entregue
        {item.deliveredBy && <span>· {item.deliveredBy}</span>}
        {time && <time dateTime={item.deliveredAt}>· {time}</time>}
      </span>
    );
  }
  if (!enabled || !isKitchenTracked(item, menu)) return null;
  const stage = getKitchenStage(item);
  const Icon = icons[stage];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${colors[stage]}`}>
      <Icon size={12} aria-hidden="true" /> {KITCHEN_STAGE_LABELS[stage]}
    </span>
  );
}
