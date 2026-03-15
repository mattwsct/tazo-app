/**
 * POST /api/admin/discord-role-sync
 *
 * Scans viewer_profiles for subscribers whose subscription_expires_at has passed
 * and removes the Discord subscriber role from their linked Discord account.
 *
 * Call this periodically (e.g. once a day) or from the admin panel.
 * It's idempotent — safe to run multiple times.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { removeSubscriberRole, isDiscordRoleSyncConfigured } from '@/lib/discord-roles';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isDiscordRoleSyncConfigured()) {
    return NextResponse.json({ error: 'Discord role sync not configured. Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, and DISCORD_SUBSCRIBER_ROLE_ID.' }, { status: 503 });
  }

  try {
    const { supabase, isSupabaseConfigured } = await import('@/lib/supabase');
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
    }

    const { data: creator } = await supabase
      .from('creators').select('id').eq('slug', 'tazo').single();
    if (!creator) return NextResponse.json({ error: 'Creator not found' }, { status: 404 });

    // Find all kick subscribers whose subscription has lapsed
    const now = new Date().toISOString();
    const { data: lapsedKickProfiles } = await supabase
      .from('viewer_profiles')
      .select('platform_id, viewer_uuid')
      .eq('creator_id', creator.id)
      .eq('platform', 'kick')
      .eq('is_subscriber', true)
      .lt('subscription_expires_at', now);

    if (!lapsedKickProfiles?.length) {
      return NextResponse.json({ removed: 0, message: 'No lapsed subscribers found' });
    }

    const viewerUuids = lapsedKickProfiles.map((p) => p.viewer_uuid).filter(Boolean);
    let removed = 0;

    // For each lapsed subscriber, find linked Discord and remove role
    for (const profile of lapsedKickProfiles) {
      if (!profile.viewer_uuid) continue;
      const { data: discordProfile } = await supabase
        .from('viewer_profiles')
        .select('platform_id')
        .eq('creator_id', creator.id)
        .eq('platform', 'discord')
        .eq('viewer_uuid', profile.viewer_uuid)
        .single();
      if (discordProfile?.platform_id) {
        await removeSubscriberRole(discordProfile.platform_id);
        removed++;
      }
    }

    // Mark them as no longer subscribers in the DB
    if (viewerUuids.length > 0) {
      await supabase
        .from('viewer_profiles')
        .update({ is_subscriber: false })
        .eq('creator_id', creator.id)
        .eq('platform', 'kick')
        .in('viewer_uuid', viewerUuids);
    }

    return NextResponse.json({ removed, lapsed: lapsedKickProfiles.length });
  } catch (e) {
    console.error('[discord-role-sync] error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
