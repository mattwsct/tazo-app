import { Metadata } from 'next';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const metadata: Metadata = {
  title: 'IRL Stream Overlay',
};

export default function OverlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.9)', color: '#fff', fontFamily: 'system-ui, sans-serif',
        }}>
          Overlay unavailable
        </div>
      }
      autoReload
      reloadDelay={5000}
    >
      {children}
    </ErrorBoundary>
  );
}

