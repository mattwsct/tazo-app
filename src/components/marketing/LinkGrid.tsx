'use client';

import { useEffect, useState } from 'react';
import { LINKS, CATEGORY_ORDER, CATEGORY_NAMES, type LinkItem } from '@/data/links';

const SOCIAL_IDS = new Set(['twitter', 'x', 'instagram', 'youtube', 'tiktok']);

function LinkButton({ link }: { link: LinkItem }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel={SOCIAL_IDS.has(link.id) ? 'me noopener noreferrer' : 'noopener noreferrer'}
      aria-label={`Visit ${link.title}`}
      className={`link-button flex items-center gap-2 justify-center py-3 px-4 sm:px-5 rounded-xl font-semibold w-full sm:w-auto bg-gradient-to-r ${link.bg} transition hover:scale-[1.03] hover:ring-2 hover:ring-white/10`}
    >
      {link.icon && (
        <img
          src={`https://cdn.simpleicons.org/${link.icon}/fff`}
          alt=""
          aria-hidden="true"
          width={20}
          height={20}
          className="w-5 h-5"
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />
      )}
      <span>{link.button || link.title}</span>
    </a>
  );
}

export default function LinkGrid() {
  const [links, setLinks] = useState<LinkItem[]>(LINKS);

  useEffect(() => {
    fetch('/api/links')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { links?: LinkItem[] } | null) => {
        if (Array.isArray(d?.links) && d.links.length > 0) setLinks(d.links);
      })
      .catch(() => {});
  }, []);

  const homepageLinks = links.filter((l) => l.showOnHomepage);

  const byCategory = homepageLinks.reduce<Record<string, LinkItem[]>>((acc, link) => {
    const cat = link.category ?? 'other';
    (acc[cat] ??= []).push(link);
    return acc;
  }, {});

  return (
    <nav aria-label="Social links and resources" className="max-w-screen-md mx-auto px-4">
      {CATEGORY_ORDER.map((cat) => {
        const items = byCategory[cat];
        if (!items?.length) return null;
        return (
          <div key={cat} className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400 mb-3 px-1">
              {CATEGORY_NAMES[cat]}
            </h2>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              {items.map((link) => (
                <LinkButton key={link.id} link={link} />
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-10 pt-6 border-t border-zinc-700/50">
        <a
          href="mailto:info@tazo.wtf"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Email Tazo"
          className="link-button flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-semibold w-full sm:w-auto bg-zinc-700/50 hover:bg-zinc-600/50 text-zinc-200 transition"
        >
          Get in touch
        </a>
      </div>
    </nav>
  );
}
