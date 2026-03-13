'use client';

import { useState, useEffect } from 'react';
import type { OverlayState } from '@/types/settings';
import StreamPanel from './StreamPanel';

export default function BottomRightPanel({
  settings,
}: {
  settings: OverlayState;
  refreshSettings?: () => Promise<void>;
  children?: React.ReactNode; // kept for page.tsx compatibility but no longer used
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Let StreamPanel decide internally whether it has anything to show
  return (
    <div className="bottom-right">
      <StreamPanel settings={settings} now={now} />
    </div>
  );
}
