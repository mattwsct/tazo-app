'use client';

import { useEffect, useState } from 'react';

type Platform = 'kick' | 'twitch';

interface StreamStatus {
  kick: boolean;
  twitch: boolean;
}

const KICK_EMBED = 'https://player.kick.com/tazo';
const TWITCH_EMBED = () => {
  const parent = typeof window !== 'undefined' ? window.location.hostname : 'tazo.wtf';
  return `https://player.twitch.tv/?channel=tazo&parent=${parent}&muted=true`;
};

export default function StreamEmbed() {
  const [status, setStatus] = useState<StreamStatus>({ kick: false, twitch: false });
  const [activePlatform, setActivePlatform] = useState<Platform>('kick');
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/stream-status');
        if (res.ok) {
          const data: StreamStatus = await res.json();
          setStatus(data);
          setActivePlatform(data.kick ? 'kick' : 'twitch');
        }
      } catch {
        // fail silently — no stream shown
      } finally {
        setChecked(true);
      }
    };

    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, []);

  const isLive = status.kick || status.twitch;
  const bothLive = status.kick && status.twitch;

  if (!checked || !isLive) return null;

  const embedSrc = activePlatform === 'kick' ? KICK_EMBED : TWITCH_EMBED();

  return (
    <div className="max-w-screen-md mx-auto mb-10 relative" role="region" aria-label="Live stream">
      <div className="flex items-center justify-center gap-2 mb-3">
        {bothLive ? (
          <div className="flex gap-2 flex-wrap justify-center">
            <button
              type="button"
              onClick={() => setActivePlatform('kick')}
              aria-pressed={activePlatform === 'kick'}
              aria-label="Watch on Kick"
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                activePlatform === 'kick'
                  ? 'bg-emerald-500/90 text-white'
                  : 'bg-zinc-600/80 text-zinc-300 hover:bg-zinc-500'
              }`}
            >
              Kick
            </button>
            <button
              type="button"
              onClick={() => setActivePlatform('twitch')}
              aria-pressed={activePlatform === 'twitch'}
              aria-label="Watch on Twitch"
              className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all duration-200 ${
                activePlatform === 'twitch'
                  ? 'bg-purple-500/90 text-white'
                  : 'bg-zinc-600/80 text-zinc-300 hover:bg-zinc-500'
              }`}
            >
              Twitch
            </button>
          </div>
        ) : (
          <div className="text-sm font-bold uppercase tracking-widest text-white">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 align-middle mr-2 animate-pulse" aria-hidden="true" />
            <span aria-live="polite">Live Now</span>
          </div>
        )}
      </div>

      <div className="relative">
        {/* Glow behind */}
        <div
          className={`absolute -inset-2 blur-2xl opacity-20 ${activePlatform === 'kick' ? 'bg-green-500' : 'bg-purple-500'} animate-pulse rounded-xl z-0 pointer-events-none`}
          aria-hidden="true"
        />
        <div className="relative z-10 rounded-xl overflow-hidden bg-zinc-900">
          <div className="relative aspect-video">
            <iframe
              src={embedSrc}
              className="w-full h-full absolute inset-0 rounded-xl"
              allowFullScreen
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              loading="lazy"
              title={`Live stream on ${activePlatform}`}
              frameBorder="0"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
