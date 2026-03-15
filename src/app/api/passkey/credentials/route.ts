/**
 * GET  /api/passkey/credentials — list registered passkeys (requires auth)
 * DELETE /api/passkey/credentials?id=<credential_id> — remove a passkey (requires auth)
 */
import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!await verifyAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data } = await supabase
    .from('passkey_credentials')
    .select('credential_id, name, device_type, backed_up, created_at, last_used_at')
    .order('created_at', { ascending: false });
  return NextResponse.json({ credentials: data ?? [] });
}

export async function DELETE(request: NextRequest) {
  if (!await verifyAuth()) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  await supabase.from('passkey_credentials').delete().eq('credential_id', id);
  return NextResponse.json({ success: true });
}
