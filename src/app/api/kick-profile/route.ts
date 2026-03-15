import { NextResponse } from 'next/server';
import { getChannelProfile } from '@/lib/kick-api';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

export const CREATOR_BIO_KEY = 'creator_bio_override';

/** GET /api/kick-profile — public endpoint, returns cached Kick profile + admin bio override. */
export async function GET() {
  try {
    const [profile, bioOverride] = await Promise.all([
      getChannelProfile('tazo'),
      kv.get<string>(CREATOR_BIO_KEY),
    ]);
    // Admin-set bio takes precedence over whatever Kick has in the bio field
    const merged = { ...profile, bio: bioOverride ?? profile.bio };
    return NextResponse.json(merged, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=600' },
    });
  } catch {
    return NextResponse.json({ username: null, bio: null, profilePic: null, instagram: null, twitter: null, youtube: null, discord: null, tiktok: null, facebook: null });
  }
}
