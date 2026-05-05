import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dzpxodwdmyqefhugranv.supabase.co';
const supabaseKey = 'sb_publishable_2Ah_SSCY__1aWQopIdIZlg_pI95HghJ';

export const supabase = createClient(supabaseUrl, supabaseKey);
