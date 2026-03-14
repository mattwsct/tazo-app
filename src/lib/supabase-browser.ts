import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? '';

// Lazy singleton — only created in browser, safe to import in client components
let _client: ReturnType<typeof createClient> | null = null;

export function getSupabaseBrowser() {
  if (!supabaseUrl || !supabaseKey) return null;
  if (!_client) _client = createClient(supabaseUrl, supabaseKey);
  return _client;
}
