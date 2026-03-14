import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Supabase new naming: SUPABASE_SECRET_DEFAULT_KEY (was SUPABASE_SERVICE_ROLE_KEY)
const supabaseServiceKey =
  process.env.SUPABASE_SECRET_DEFAULT_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[supabase] SUPABASE_URL or SUPABASE_SECRET_DEFAULT_KEY is not set. Supabase features will not work.');
  }
}

/**
 * Server-only Supabase client using the service role key.
 * Has full database access — never expose this to the browser.
 * Only import this in API routes and server components.
 */
export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseServiceKey ?? 'placeholder',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Check if Supabase is configured and reachable.
 * Use this before attempting DB operations in routes that have Upstash fallbacks.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseServiceKey);
}
