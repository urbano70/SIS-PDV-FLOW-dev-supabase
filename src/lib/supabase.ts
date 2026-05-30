/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = (import.meta as any).env.VITE_SUPABASE_URL  as string
  || 'https://iagflqaopurjnnzkunph.supabase.co';

const supabaseAnon = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZ2ZscWFvcHVyam5uemt1bnBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAwMDk1MjcsImV4cCI6MjA5NTU4NTUyN30.A6OxNQ3gRUMzr-KLicnm83mG3SrT7U4J8CP6EjMZRmo';

// Client para uso no browser (anon key, respeita RLS)
export const supabase = createClient(supabaseUrl, supabaseAnon);
