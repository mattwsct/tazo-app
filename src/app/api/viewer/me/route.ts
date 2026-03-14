import { NextRequest, NextResponse } from 'next/server';
import { getViewerSession } from '@/lib/viewer-auth';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = getViewerSession(request);

  if (!session || (!session.kickId && !session.discordId)) {
    return NextResponse.json({ authenticated: false });
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
      });
    }

    const creatorId = creator.id;
    const platformId = session.kickId;

    let balance = 0;
    let rank: number | null = null;

    if (platformId) {
      // Get the viewer's balance
      const { data: ledgerData } = await supabase
        .from('point_ledger')
        .select('delta')
        .eq('creator_id', creatorId)
        .eq('platform_id', platformId);

      if (ledgerData && ledgerData.length > 0) {
        balance = ledgerData.reduce((sum: number, row: { delta: number }) => sum + (row.delta ?? 0), 0);
      }

      // Get rank: count viewers with a higher balance
      // We need to compute balances for all viewers and count those above ours
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
