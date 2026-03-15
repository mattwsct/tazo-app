/**
 * GET /api/links — public endpoint, returns links for the homepage.
 * Returns DB-saved links if available, falls back to the static LINKS constant.
 */
import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { LINKS, type LinkItem } from '@/data/links';

export const dynamic = 'force-dynamic';

export async function GET() {
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
  } catch {
    return NextResponse.json({ links: LINKS });
  }
}
