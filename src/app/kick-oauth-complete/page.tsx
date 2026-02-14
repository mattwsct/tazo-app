'use client';

import { useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function KickOAuthComplete() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.opener) {
      window.opener.postMessage(
        { type: 'kick_oauth_complete', error: error ?? undefined },
        window.location.origin
      );
      window.close();
    } else {
      window.location.href = error ? `/?kick_oauth=error&error=${error}` : '/?kick_oauth=success';
    }
  }, [error]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '2rem',
      fontFamily: 'system-ui, sans-serif',
      background: '#0f172a',
      color: '#f1f5f9',
    }}>
      <p>{error ? 'Connection failed. Closing...' : 'Connection successful! Closing...'}</p>
    </div>
  );
}

export default function KickOAuthCompletePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0f172a' }} />}>
      <KickOAuthComplete />
    </Suspense>
  );
}
