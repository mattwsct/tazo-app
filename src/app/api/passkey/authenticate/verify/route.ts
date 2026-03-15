/**
 * POST /api/passkey/authenticate/verify
 * Verifies the authentication response and issues the same session cookie as /api/login.
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { AuthenticationResponseJSON } from '@simplewebauthn/server';
import { kv } from '@/lib/kv';
import { supabase } from '@/lib/supabase';
import { getRpSettings, PASSKEY_CHALLENGE_KEY } from '@/lib/passkey';
import { generateSessionToken } from '@/lib/api-auth';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const body = await request.json() as AuthenticationResponseJSON;
  const { rpID, origin } = getRpSettings();

  const expectedChallenge = await kv.get<string>(PASSKEY_CHALLENGE_KEY);
  if (!expectedChallenge) {
    return NextResponse.json({ error: 'Challenge expired — try again' }, { status: 400 });
  }

  // Look up the credential
  const { data: cred } = await supabase
    .from('passkey_credentials')
    .select('*')
    .eq('credential_id', body.id)
    .single();

  if (!cred) {
    return NextResponse.json({ error: 'Unknown credential' }, { status: 401 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: cred.credential_id as string,
        publicKey: isoBase64URL.toBuffer(cred.public_key as string),
        counter: Number(cred.counter),
        transports: (cred.transports ?? []) as AuthenticatorTransport[],
      },
      requireUserVerification: false,
    });
  } catch (e) {
    return NextResponse.json({ error: `Verification failed: ${e}` }, { status: 401 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: 'Not verified' }, { status: 401 });
  }

  // Update counter and last_used_at to prevent replay attacks
  await supabase
    .from('passkey_credentials')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_used_at: new Date().toISOString(),
    })
    .eq('credential_id', body.id);

  await kv.del(PASSKEY_CHALLENGE_KEY);

  // Issue the same session cookie as password login
  const token = generateSessionToken();
  const isDev = process.env.NODE_ENV === 'development';
  const maxAge = isDev ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;

  const response = NextResponse.json({ success: true });
  response.cookies.set('auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge,
  });
  return response;
}
