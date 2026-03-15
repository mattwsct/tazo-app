/**
 * POST /api/passkey/authenticate/options
 * Public endpoint — returns authentication options for the login page.
 */
import { NextResponse } from 'next/server';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { kv } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { getRpSettings, PASSKEY_CHALLENGE_KEY, PASSKEY_CHALLENGE_TTL } from '@/lib/passkey';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { rpID } = getRpSettings();

  const { data: credentials } = await supabase
    .from('passkey_credentials')
    .select('credential_id, transports');

  const allowCredentials = (credentials ?? []).map((c) => ({
    id: c.credential_id as string,
    transports: (c.transports ?? []) as AuthenticatorTransport[],
  }));

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });

  await kv.set(PASSKEY_CHALLENGE_KEY, options.challenge, { ex: PASSKEY_CHALLENGE_TTL });

  return NextResponse.json(options);
}
