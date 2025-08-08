import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_KEY!;

export const supaSrv = createClient(url, serviceKey, {
  auth: { persistSession: false }
});
