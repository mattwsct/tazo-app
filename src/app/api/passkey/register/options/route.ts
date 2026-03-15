/**
 * POST /api/passkey/register/options
 * Requires existing admin auth (password session) — you must already be logged in to register a passkey.
 * Returns PublicKeyCredentialCreationOptionsJSON for the browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { verifyAuth } from '@/lib/api-auth';
import { kv } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { getRpSettings, PASSKEY_CHALLENGE_KEY, PASSKEY_CHALLENGE_TTL } from '@/lib/passkey';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!await verifyAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { rpName, rpID } = getRpSettings();

  // Fetch existing credentials to exclude them (prevents re-registering same device)
  const { data: existing } = await supabase
    .from('passkey_credentials')
    .select('credential_id, transports');

  const excludeCredentials = (existing ?? []).map((c) => ({
    id: c.credential_id as string,
    transports: (c.transports ?? []) as AuthenticatorTransport[],
  }));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: 'tazo',
    userDisplayName: 'Tazo (Admin)',
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Store challenge in KV for verification step
  await kv.set(PASSKEY_CHALLENGE_KEY, options.challenge, { ex: PASSKEY_CHALLENGE_TTL });

  return NextResponse.json(options);
}
