import { createClient } from '@supabase/supabase-js';
import ws from 'ws';

// Usado apenas no servidor (Node). A service_role key bypassa RLS.
// NUNCA exponha esta key no browser.
export function createSupabaseAdmin() {
  const url     = process.env.SUPABASE_URL;
  const svcKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !svcKey) {
    throw new Error('[supabase] SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios');
  }

  return createClient(url, svcKey, {
    auth: { persistSession: false },
    realtime: { transport: ws as any },
  });
}
