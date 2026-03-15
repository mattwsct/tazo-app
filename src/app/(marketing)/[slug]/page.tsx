import { redirect, notFound } from 'next/navigation';
import { LINK_REDIRECT_MAP } from '@/data/links';
import type { LinkItem } from '@/data/links';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Top-level slug redirects — e.g. tazo.wtf/kick, tazo.wtf/ig, tazo.wtf/tips
 * Checks static aliases first, then DB-stored link aliases for user-added links.
 * Specific routes (/app, /overlay, /login, /api/*) take precedence over this catch-all.
 */
export default async function SlugRedirectPage({ params }: Props) {
  const { slug } = await params;

  // 1. Check static alias map (fast path)
  if (LINK_REDIRECT_MAP[slug]) {
    redirect(LINK_REDIRECT_MAP[slug]);
  }

  // 2. Check DB-stored links for dynamic aliases
  try {
    const { data: creator } = await supabase
      .from('creators')
      .select('id')
      .eq('slug', 'tazo')
      .single();

    if (creator) {
      const { data: settings } = await supabase
        .from('creator_settings')
        .select('links')
        .eq('creator_id', creator.id)
        .single();

      const links = (settings as { links?: LinkItem[] } | null)?.links ?? [];
      for (const link of links) {
        if (link.id === slug || (link.aliases ?? []).includes(slug)) {
          redirect(link.url);
        }
      }
    }
  } catch {
    // DB unavailable — fall through to 404
  }

  notFound();
}
