import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { kv } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const CREATOR_BIO_KEY = 'creator_bio_override';

export async function GET(request: NextRequest) {
  if (!verifyRequestAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const bio = await kv.get<string>(CREATOR_BIO_KEY);
  return NextResponse.json({ bio: bio ?? null });
}

export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { bio } = await request.json() as { bio?: string };
  if (bio === null || bio === undefined || bio.trim() === '') {
    await kv.del(CREATOR_BIO_KEY);
  } else {
    await kv.set(CREATOR_BIO_KEY, bio.trim());
  }
  return NextResponse.json({ ok: true });
}
