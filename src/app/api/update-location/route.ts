import { NextRequest, NextResponse } from 'next/server';
import { updatePersistentLocationIfNewer } from '@/utils/location-cache';
import { validateUpdateLocationPayload, MAX_PAYLOAD_BYTES_EXPORT } from '@/lib/location-payload-validator';
import { checkApiRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { success } = await checkApiRateLimit(request, 'update-location');
  if (!success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  try {
    if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_PAYLOAD_BYTES_EXPORT) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const body = JSON.parse(rawBody) as unknown;
    const data = validateUpdateLocationPayload(body);
    if (!data) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    const updated = await updatePersistentLocationIfNewer(data);
    return NextResponse.json({ ok: true, updated });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    console.warn('Failed to update persistent location:', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
