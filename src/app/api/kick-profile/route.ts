import { NextResponse } from 'next/server';
import { getChannelProfile } from '@/lib/kick-api';

export const dynamic = 'force-dynamic';

/** GET /api/kick-profile — public endpoint, returns cached Kick profile image + social links. */
export async function GET() {
  try {
    const profile = await getChannelProfile('tazo');
    return NextResponse.json(profile, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch {
    return NextResponse.json({ profilePic: null, instagram: null, twitter: null, youtube: null, discord: null, tiktok: null, facebook: null });
  }
}
