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
        kickUsername: session.kickUsername,
        discordUsername: session.discordUsername,
        balance: 0,
        rank: null,
        message: 'Creator not found.',
      });
    }

    const creatorId = creator.id;
    // platform_id is stored as username.toLowerCase()
    const platformId = session.kickId ? session.kickId.toLowerCase() : null;

    let balance = 0;
    let rank: number | null = null;

    if (platformId) {
      // Get the viewer's balance — sum of all delta entries for this platform_id
      const { data: ledgerData } = await supabase
        .from('point_ledger')
        .select('delta')
        .eq('creator_id', creatorId)
        .eq('platform_id', platformId);

      if (ledgerData && ledgerData.length > 0) {
        balance = ledgerData.reduce((sum: number, row: { delta: number }) => sum + (row.delta ?? 0), 0);
      } else {
        // No ledger entries yet — balance is 0, return helpful message
        return NextResponse.json({
          authenticated: true,
          kickUsername: session.kickUsername,
          discordUsername: session.discordUsername,
          balance: 0,
          rank: null,
          message: 'No credit history yet. Earn credits by watching the stream!',
        });
      }

      // Compute rank efficiently: fetch all deltas for this creator, aggregate by platform_id,
      // then count how many viewers have a strictly higher balance than ours.
      const { data: allLedger } = await supabase
        .from('point_ledger')
        .select('platform_id, delta')
        .eq('creator_id', creatorId);

      if (allLedger) {
        // Aggregate balances by platform_id
        const balanceMap = new Map<string, number>();
        for (const row of allLedger as Array<{ platform_id: string; delta: number }>) {
          balanceMap.set(row.platform_id, (balanceMap.get(row.platform_id) ?? 0) + (row.delta ?? 0));
        }

        // Count viewers with a strictly higher balance
        let above = 0;
        for (const [pid, bal] of balanceMap) {
          if (pid !== platformId && bal > balance) above++;
        }
        rank = above + 1;
      }
    }

    return NextResponse.json({
      authenticated: true,
      kickUsername: session.kickUsername,
      discordUsername: session.discordUsername,
      balance,
      rank,
    });
  } catch (error) {
    console.error('[viewer/me] error:', error);
    return NextResponse.json({
      authenticated: true,
      kickUsername: session.kickUsername,
      discordUsername: session.discordUsername,
      balance: 0,
      rank: null,
    });
  }
}
