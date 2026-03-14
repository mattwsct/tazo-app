import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@/lib/kv';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { verifyRequestAuth } from '@/lib/api-auth';

/**
 * One-time migration: copies persistent data from Upstash KV → Supabase.
 * Safe to run multiple times (upserts). Requires admin auth.
 *
 * POST /api/admin/migrate
 */
export async function POST(request: NextRequest) {
  const ok = verifyRequestAuth(request);
  if (!ok) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'Supabase not configured — set SUPABASE_URL and SUPABASE_SECRET_DEFAULT_KEY' }, { status: 503 });
  }

  const results: Record<string, string> = {};

  // 1. Get the tazo creator ID
  const { data: creator, error: creatorError } = await supabase
    .from('creators')
    .select('id')
    .eq('slug', 'tazo')
    .single();

  if (creatorError || !creator) {
    return NextResponse.json({ error: 'Creator "tazo" not found in Supabase. Run the schema migration first.' }, { status: 404 });
  }

  const creatorId = creator.id;

  // 2. Migrate overlay_settings
  try {
    const overlaySettings = await kv.get('overlay_settings');
    if (overlaySettings) {
      const { error } = await supabase
        .from('creator_settings')
        .upsert({
          creator_id: creatorId,
          overlay: overlaySettings,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'creator_id' });
      results.overlay_settings = error ? `error: ${error.message}` : 'migrated';
    } else {
      results.overlay_settings = 'skipped (no data in KV)';
    }
  } catch (e) {
    results.overlay_settings = `error: ${e}`;
  }

  // 3. Migrate kick_messages
  try {
    const kickMessages = await kv.get('kick_messages');
    if (kickMessages) {
      const { error } = await supabase
        .from('creator_settings')
        .upsert({
          creator_id: creatorId,
          kick_messages: kickMessages,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'creator_id' });
      results.kick_messages = error ? `error: ${error.message}` : 'migrated';
    } else {
      results.kick_messages = 'skipped (no data in KV)';
    }
  } catch (e) {
    results.kick_messages = `error: ${e}`;
  }

  // 4. Migrate kick_poll_settings
  try {
    const pollConfig = await kv.get('kick_poll_settings');
    if (pollConfig) {
      const { error } = await supabase
        .from('creator_settings')
        .upsert({
          creator_id: creatorId,
          poll_config: pollConfig,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'creator_id' });
      results.poll_config = error ? `error: ${error.message}` : 'migrated';
    } else {
      results.poll_config = 'skipped (no data in KV)';
    }
  } catch (e) {
    results.poll_config = `error: ${e}`;
  }

  // 5. Migrate overlay_challenges → challenge_events table
  try {
    const challenges = await kv.get<Array<Record<string, unknown>>>('overlay_challenges');
    if (challenges && Array.isArray(challenges) && challenges.length > 0) {
      const rows = challenges.map((c) => ({
        creator_id: creatorId,
        description: String(c.description ?? ''),
        bounty_usd: c.bounty != null ? Number(c.bounty) : null,
        status: String(c.status ?? 'open'),
        buyer_name: c.buyer ? String(c.buyer) : null,
        target_steps: c.targetSteps != null ? Number(c.targetSteps) : null,
        target_distance_km: c.targetDistanceKm != null ? Number(c.targetDistanceKm) : null,
        expires_at: c.expiresAt ? new Date(Number(c.expiresAt)).toISOString() : null,
      }));

      const { error } = await supabase
        .from('challenge_events')
        .insert(rows);
      results.challenges = error ? `error: ${error.message}` : `migrated ${rows.length} challenges`;
    } else {
      results.challenges = 'skipped (no data in KV)';
    }
  } catch (e) {
    results.challenges = `error: ${e}`;
  }

  // 6. Migrate overlay_leaderboard → point_ledger (snapshot as single "admin" entries)
  try {
    const leaderboard = await kv.get<Record<string, number>>('overlay_leaderboard');
    if (leaderboard && typeof leaderboard === 'object') {
      const entries = Object.entries(leaderboard);
      if (entries.length > 0) {
        const rows = entries.map(([username, balance]) => ({
          creator_id: creatorId,
          platform_id: username,
          username,
          delta: Number(balance),
          reason: 'migration_snapshot',
          meta: { source: 'upstash_migration' },
        }));

        const { error } = await supabase
          .from('point_ledger')
          .insert(rows);
        results.leaderboard = error ? `error: ${error.message}` : `migrated ${rows.length} entries`;
      } else {
        results.leaderboard = 'skipped (empty leaderboard)';
      }
    } else {
      results.leaderboard = 'skipped (no data in KV)';
    }
  } catch (e) {
    results.leaderboard = `error: ${e}`;
  }

  // 7. Migrate Kick OAuth token → linked_identities
  try {
    // Try both possible KV key patterns
    const tokenData = await kv.get<Record<string, unknown>>('kick_oauth_token')
      ?? await kv.get<Record<string, unknown>>('kick_oauth_token:tazo');
    if (tokenData) {
      const { error } = await supabase
        .from('linked_identities')
        .upsert({
          creator_id: creatorId,
          provider: 'kick',
          access_token: String(tokenData.access_token ?? ''),
          refresh_token: tokenData.refresh_token ? String(tokenData.refresh_token) : null,
          expires_at: tokenData.expires_at ? new Date(Number(tokenData.expires_at)).toISOString() : null,
          scope: tokenData.scope ? String(tokenData.scope) : null,
          raw: tokenData,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'creator_id, provider' });
      results.kick_oauth = error ? `error: ${error.message}` : 'migrated';
    } else {
      results.kick_oauth = 'skipped (no token in KV — re-authorize Kick after migration)';
    }
  } catch (e) {
    results.kick_oauth = `error: ${e}`;
  }

  return NextResponse.json({
    message: 'Migration complete',
    creatorId,
    results,
  });
}
