import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/overlay', '/app', '/admin'],
      },
    ],
    sitemap: 'https://tazo.wtf/sitemap.xml',
  };
}
