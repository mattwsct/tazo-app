import { Metadata } from 'next';

// Cache headers are set via next.config.ts headers() function
// This layout ensures the overlay page structure is correct
export const metadata: Metadata = {
  title: 'IRL Stream Overlay',
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

