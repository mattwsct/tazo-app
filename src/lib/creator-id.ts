/**
 * Cached creator_id lookup by slug.
 * Module-level cache stays warm within a serverless function instance.
 * Safe to call on every request — Supabase is only hit on cold start.
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

const cache = new Map<string, string>();

export async function getCreatorId(slug = 'tazo'): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const cached = cache.get(slug);
  if (cached) return cached;
  const { data } = await supabase.from('creators').select('id').eq('slug', slug).single();
  if (data?.id) cache.set(slug, data.id);
  return data?.id ?? null;
}

/** Ensure a creator_settings row exists for this creator (upserts with defaults). */
export async function ensureCreatorSettings(creatorId: string): Promise<void> {
  await supabase
    .from('creator_settings')
    .upsert({ creator_id: creatorId }, { onConflict: 'creator_id', ignoreDuplicates: true });
}
