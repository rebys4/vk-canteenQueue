import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL!;
const anon = import.meta.env.VITE_SUPABASE_ANON || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anon) {
  // Подсказка при неправильных env
  // eslint-disable-next-line no-console
  console.error('Supabase env missing', { url, anon });
  throw new Error('VITE_SUPABASE_URL или VITE_SUPABASE_ANON(_KEY) не заданы');
}

export const supabase = createClient(url, anon as string);
