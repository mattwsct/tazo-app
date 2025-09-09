import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Enable bundle analysis in development
  ...(process.env.ANALYZE === 'true' && {
    webpack: (config, { isServer }) => {
      if (!isServer) {
        config.resolve.fallback = {
          ...config.resolve.fallback,
          fs: false,
        };
      }
      return config;
    },
  }),
  
  // Disable image optimization to prevent Vercel transformations
  images: {
    unoptimized: true, // Disable Next.js image optimization
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  
  // Performance optimizations
  experimental: {
    // Temporarily disabled due to build hanging
    // optimizePackageImports: ['@vercel/kv', 'mapbox-gl', 'leaflet'],
  },
  
  // Compression
  compress: true,
  
  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
      {
        source: '/overlay',
        headers: [
          // Allow embedding the overlay (e.g., OBS) via CSP frame-ancestors
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors *; default-src 'self' blob: data: https:; img-src 'self' https: data:; script-src 'self' https://cdn.jsdelivr.net https://*.firebaseio.com https://www.googletagmanager.com 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:; style-src 'self' 'unsafe-inline' https:; worker-src 'self' blob:;",
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=()'
          }
        ],
      },
    ];
  },
  

};

export default nextConfig;
