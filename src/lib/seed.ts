import { supabase } from './supabase';
import { MENU_CATEGORIES } from '../constants';

export const getLocalSeedData = () => ({
  tables: Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    status: 'free' as const,
    currentOrder: null,
    linkedTo: null,
  })),
  comandas: Array.from({ length: 50 }, (_, i) => ({
    id: i + 1,
    status: 'free' as const,
    currentOrder: null,
    linkedTo: null,
  })),
  menu: MENU_CATEGORIES,
  isCashRegisterOpen: false,
});

export const seedDatabase = async () => {
  const tables = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1, status: 'free', current_order: null, linked_to: null,
  }));
  const { error: tErr } = await supabase.from('tables').upsert(tables);
  if (tErr) throw new Error(`tables: ${tErr.message}`);

  const comandas = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, status: 'free', current_order: null, linked_to: null,
  }));
  const { error: cErr } = await supabase.from('comandas').upsert(comandas);
  if (cErr) throw new Error(`comandas: ${cErr.message}`);

  const menuRows = MENU_CATEGORIES.map((cat) => ({
    id: cat.name, name: cat.name, type: cat.type, items: cat.items,
  }));
  const { error: mErr } = await supabase.from('menu').upsert(menuRows);
  if (mErr) throw new Error(`menu: ${mErr.message}`);

  const { error: cfgErr } = await supabase.from('config').upsert({
    id: 'app', is_cash_register_open: false, daily_counter: 0, last_order_date: '',
  });
  if (cfgErr) throw new Error(`config: ${cfgErr.message}`);
};
