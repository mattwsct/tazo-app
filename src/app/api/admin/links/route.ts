import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import { supabase } from '@/lib/supabase';
import { LINKS, type LinkItem } from '@/data/links';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data: creator } = await supabase
      .from('creators')
      .select('id')
      .eq('slug', 'tazo')
      .single();

    if (!creator) {
      return NextResponse.json({ links: LINKS });
    }

    const { data: settings } = await supabase
      .from('creator_settings')
      .select('links')
      .eq('creator_id', creator.id)
      .single();

    const links = (settings as { links?: LinkItem[] } | null)?.links ?? LINKS;
    return NextResponse.json({ links });
  } catch (error) {
    console.error('[admin/links GET] error:', error);
    return NextResponse.json({ links: LINKS });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as { links?: LinkItem[] };
    const links = body.links;

    if (!Array.isArray(links)) {
      return NextResponse.json({ error: 'Invalid links data' }, { status: 400 });
    }

    const { data: creator } = await supabase
      .from('creators')
      .select('id')
      .eq('slug', 'tazo')
      .single();

    if (!creator) {
      return NextResponse.json({ error: 'Creator not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('creator_settings')
      .upsert({ creator_id: creator.id, links }, { onConflict: 'creator_id' });

    if (error) {
      console.error('[admin/links POST] supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[admin/links POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
