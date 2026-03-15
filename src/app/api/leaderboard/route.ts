/**
 * GET /api/leaderboard?creator=tazo&limit=100
 * Public leaderboard endpoint — reads from KV (fast).
 * Currently only supports creator=tazo (single-tenant).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCreditsLeaderboard } from '@/utils/gambling-storage';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const creator = searchParams.get('creator') ?? 'tazo';
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') ?? '100', 10)));

  // Currently only tazo's KV data is available — other creators are a no-op stub
  if (creator !== 'tazo') {
    return NextResponse.json({ entries: [], total: 0, creator });
  }

  const raw = await getCreditsLeaderboard(limit);
  const entries = raw.map((e, i) => ({ rank: i + 1, username: e.username, credits: e.credits }));

  return NextResponse.json(
    { entries, total: entries.length, creator },
    {
      headers: {
        // Cache 30s — leaderboard doesn't need to be real-time
        'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
      },
    }
  );
}
