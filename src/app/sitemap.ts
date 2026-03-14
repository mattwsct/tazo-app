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
    {
      url: `${base}/commands`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    },
    {
      url: `${base}/dashboard`,
      lastModified: new Date(),
      changeFrequency: 'monthly' as const,
      priority: 0.5,
    },
    ...redirectPages,
  ];
}
