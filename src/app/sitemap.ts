import type { MetadataRoute } from 'next';
import { LINK_REDIRECT_MAP } from '@/data/links';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://tazo.wtf';

  const redirectPages = Object.keys(LINK_REDIRECT_MAP).map((slug) => ({
    url: `${base}/go/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'monthly' as const,
    priority: 0.3,
  }));

  return [
    {
      url: base,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    ...redirectPages,
  ];
}
