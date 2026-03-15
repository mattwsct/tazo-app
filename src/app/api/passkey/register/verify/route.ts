/**
 * POST /api/passkey/register/verify
 * Verifies the registration response and saves the credential.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import type { RegistrationResponseJSON } from '@simplewebauthn/types';
import { verifyAuth } from '@/lib/api-auth';
import { kv } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { getRpSettings, PASSKEY_CHALLENGE_KEY } from '@/lib/passkey';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!await verifyAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json() as { response: RegistrationResponseJSON; name?: string };
  const { rpID, origin } = getRpSettings();

  const expectedChallenge = await kv.get<string>(PASSKEY_CHALLENGE_KEY);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expired — try again' }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (e) {
    return NextResponse.json({ error: `Verification failed: ${e}` }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: 'Registration not verified' }, { status: 400 });
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  await supabase.from('passkey_credentials').insert({
    credential_id: credential.id,
    public_key: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    device_type: credentialDeviceType,
    backed_up: credentialBackedUp,
    transports: body.response.response.transports ?? [],
    name: body.name?.trim() || null,
  });

  // Consume challenge
  await kv.del(PASSKEY_CHALLENGE_KEY);

  return NextResponse.json({ verified: true });
}
