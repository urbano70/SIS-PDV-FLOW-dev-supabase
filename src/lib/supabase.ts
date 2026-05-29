/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = (import.meta as any).env.VITE_SUPABASE_URL  as string;
const supabaseAnon = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnon) {
  throw new Error('VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórios');
}

// Client para uso no browser (anon key, respeita RLS)
export const supabase = createClient(supabaseUrl, supabaseAnon);
