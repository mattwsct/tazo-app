import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getCreatorId } from '@/lib/creator-id';

export const dynamic = 'force-dynamic';

type ApiKeys = {
  rtirl_pull_key?: string;
  pulsoid_token?: string;
  locationiq_key?: string;
  openweather_key?: string;
};

function mask(value: string | undefined | null): string | null {
  if (!value || value.length < 6) return value ? '••••••' : null;
  return value.slice(0, 4) + '••••••' + value.slice(-4);
}

function configuredFromEnv(): ApiKeys {
  return {
    rtirl_pull_key: process.env.NEXT_PUBLIC_RTIRL_PULL_KEY || undefined,
    pulsoid_token: process.env.NEXT_PUBLIC_PULSOID_TOKEN || undefined,
    locationiq_key: process.env.NEXT_PUBLIC_LOCATIONIQ_KEY || undefined,
    openweather_key: process.env.NEXT_PUBLIC_OPENWEATHERMAP_KEY || undefined,
  };
}

/** GET /api/admin/api-keys — return masked key status */
export async function GET(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // DB values take precedence; env vars are fallback for Tazo's own deployment
  let dbKeys: ApiKeys = {};
  if (isSupabaseConfigured()) {
    const creatorId = await getCreatorId();
    if (creatorId) {
      const { data } = await supabase.from('creator_settings')
        .select('api_keys')
        .eq('creator_id', creatorId)
        .single();
      if (data?.api_keys) dbKeys = data.api_keys as ApiKeys;
    }
  }

  const envKeys = configuredFromEnv();

  const merged: ApiKeys = {
    rtirl_pull_key: dbKeys.rtirl_pull_key || envKeys.rtirl_pull_key,
    pulsoid_token: dbKeys.pulsoid_token || envKeys.pulsoid_token,
    locationiq_key: dbKeys.locationiq_key || envKeys.locationiq_key,
    openweather_key: dbKeys.openweather_key || envKeys.openweather_key,
  };

  return NextResponse.json({
    rtirl_pull_key: {
      configured: Boolean(merged.rtirl_pull_key),
      masked: mask(merged.rtirl_pull_key),
      source: dbKeys.rtirl_pull_key ? 'db' : merged.rtirl_pull_key ? 'env' : null,
    },
    pulsoid_token: {
      configured: Boolean(merged.pulsoid_token),
      masked: mask(merged.pulsoid_token),
      source: dbKeys.pulsoid_token ? 'db' : merged.pulsoid_token ? 'env' : null,
    },
    locationiq_key: {
      configured: Boolean(merged.locationiq_key),
      masked: mask(merged.locationiq_key),
      source: dbKeys.locationiq_key ? 'db' : merged.locationiq_key ? 'env' : null,
    },
    openweather_key: {
      configured: Boolean(merged.openweather_key),
      masked: mask(merged.openweather_key),
      source: dbKeys.openweather_key ? 'db' : merged.openweather_key ? 'env' : null,
    },
  });
}

/** POST /api/admin/api-keys — save key values (empty string = clear) */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as Partial<ApiKeys>;

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: 'Supabase not configured — add API keys to Vercel environment variables instead.' },
      { status: 503 }
    );
  }

  const creatorId = await getCreatorId();
  if (!creatorId) {
    return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
  }

  // Fetch existing keys so we only overwrite what was submitted
  const { data: existing } = await supabase.from('creator_settings')
    .select('api_keys')
    .eq('creator_id', creatorId)
    .single();

  const current: ApiKeys = (existing?.api_keys as ApiKeys) ?? {};

  const updated: ApiKeys = {
    rtirl_pull_key: 'rtirl_pull_key' in body
      ? (body.rtirl_pull_key?.trim() || undefined)
      : current.rtirl_pull_key,
    pulsoid_token: 'pulsoid_token' in body
      ? (body.pulsoid_token?.trim() || undefined)
      : current.pulsoid_token,
    locationiq_key: 'locationiq_key' in body
      ? (body.locationiq_key?.trim() || undefined)
      : current.locationiq_key,
    openweather_key: 'openweather_key' in body
      ? (body.openweather_key?.trim() || undefined)
      : current.openweather_key,
  };

  await supabase.from('creator_settings')
    .update({ api_keys: updated })
    .eq('creator_id', creatorId);

  return NextResponse.json({ success: true });
}
