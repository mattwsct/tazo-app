import type { Metadata, Viewport } from 'next';
import { Bebas_Neue, Inter } from 'next/font/google';
import Script from 'next/script';
import '@/styles/marketing.css';
import ParticleCanvas from '@/components/marketing/ParticleCanvas';

const GA_ID = 'G-X906823W60';

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-bebas-neue',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Tazo — IRL Streamer',
  description: 'Tazo is an IRL streamer from Australia, based in Japan. Watch live on Kick and Twitch.',
  metadataBase: new URL('https://tazo.wtf'),
  openGraph: {
    title: 'Tazo — IRL Streamer',
    description: 'Watch Tazo live on Kick and Twitch. IRL streaming from Japan and beyond.',
    url: 'https://tazo.wtf',
    siteName: 'Tazo',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tazo — IRL Streamer',
    description: 'Watch Tazo live on Kick and Twitch. IRL streaming from Japan and beyond.',
  },
};

export const viewport: Viewport = {
  themeColor: '#18181b',
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${bebasNeue.variable} ${inter.variable} min-h-screen flex flex-col text-white font-sans bg-gradient-to-b from-zinc-950 via-zinc-900 to-zinc-950`}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-zinc-800 focus:text-white focus:rounded"
      >
        Skip to main content
      </a>
      <ParticleCanvas />
      <main id="main-content" className="flex-1 relative z-10">
        {children}
      </main>
      <footer className="mt-16 py-8 text-center text-sm text-zinc-500 relative z-10" role="contentinfo">
        <div className="max-w-screen-md mx-auto px-4">
          © {new Date().getFullYear()} Tazo
          <span className="mx-2 opacity-30">·</span>
          <a href="/login" className="hover:text-zinc-300 transition-colors">Admin</a>
        </div>
      </footer>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">{`
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        gtag('config', '${GA_ID}');
      `}</Script>
    </div>
  );
}
