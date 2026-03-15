import { NextRequest, NextResponse } from 'next/server';
import { getViewerSession } from '@/lib/viewer-auth';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = getViewerSession(request);

  if (!session || (!session.kickId && !session.discordId)) {
    return NextResponse.json({ authenticated: false });
  }

  // If Supabase is not configured, return a helpful response
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      authenticated: true,
      viewerUuid: session.viewerUuid,
      kickUsername: session.kickUsername,
      discordUsername: session.discordUsername,
      balance: 0,
      rank: null,
      message: 'Leaderboard data not yet available.',
    });
  }

  try {
    // Get the tazo creator_id
    const { data: creator } = await supabase
      .from('creators')
      .select('id')
      .eq('slug', 'tazo')
      .single();

    if (!creator) {
      return NextResponse.json({
        authenticated: true,
        viewerUuid: session.viewerUuid,
        kickUsername: session.kickUsername,
        discordUsername: session.discordUsername,
        balance: 0,
        rank: null,
        message: 'Creator not found.',
      });
    }

    const creatorId = creator.id;

    // Get all platform_ids linked to this viewer via viewerUuid
    let platformIds: string[] = [];

    if (session.viewerUuid) {
      const { data: profiles } = await supabase
        .from('viewer_profiles')
        .select('platform_id, platform, username')
        .eq('viewer_uuid', session.viewerUuid)
        .eq('creator_id', creatorId);

      platformIds = profiles?.map((p: { platform_id: string }) => p.platform_id) ?? [];
    }

    // Also include direct IDs from token as fallback
    if (session.kickId && !platformIds.includes(session.kickId)) platformIds.push(session.kickId);
    if (session.kickId && !platformIds.includes(session.kickId.toLowerCase())) platformIds.push(session.kickId.toLowerCase());
    if (session.kickUsername && !platformIds.includes(session.kickUsername.toLowerCase())) platformIds.push(session.kickUsername.toLowerCase());
    if (session.discordId && !platformIds.includes(session.discordId)) platformIds.push(session.discordId);

    let balance = 0;
    let rank: number | null = null;

    if (platformIds.length > 0) {
      // viewer_balances uses kick platform_id (username, lowercase) — collect kick-specific ids
      const kickIds = platformIds.filter((id) => {
        // numeric IDs are Kick user IDs; strings are usernames
        return id !== session.discordId;
      });

      if (kickIds.length > 0) {
        // Sum balance across all linked kick platform_ids (handles merged accounts)
        const { data: rows } = await supabase
          .from('viewer_balances')
          .select('balance')
          .eq('creator_id', creatorId)
          .eq('platform', 'kick')
          .in('platform_id', kickIds);

        if (rows && rows.length > 0) {
          balance = (rows as Array<{ balance: number }>).reduce((sum, row) => sum + (row.balance ?? 0), 0);
        }

        // Rank: count how many distinct viewers have a strictly higher balance
        const { data: allRows } = await supabase
          .from('viewer_balances')
          .select('platform_id, balance')
          .eq('creator_id', creatorId)
          .eq('platform', 'kick')
          .gt('balance', 0);

        if (allRows) {
          let above = 0;
          for (const row of allRows as Array<{ platform_id: string; balance: number }>) {
            if (!kickIds.includes(row.platform_id) && row.balance > balance) above++;
          }
          rank = above + 1;
        }
      }
    }

    return NextResponse.json({
      authenticated: true,
      viewerUuid: session.viewerUuid,
      kickUsername: session.kickUsername,
      discordUsername: session.discordUsername,
      balance,
      rank,
    });
  } catch (error) {
    console.error('[viewer/me] error:', error);
    return NextResponse.json({
      authenticated: true,
      viewerUuid: session.viewerUuid,
      kickUsername: session.kickUsername,
      discordUsername: session.discordUsername,
      balance: 0,
      rank: null,
    });
  }
}
