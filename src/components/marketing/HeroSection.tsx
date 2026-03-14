'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface LocationInfo {
  location: string | null;
  weather: string | null;
}

const CACHE_KEY = 'tazo_location_info_v2';
const CACHE_TTL = 5 * 60 * 1000;

function getCached(): LocationInfo | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < CACHE_TTL) return data;
    localStorage.removeItem(CACHE_KEY);
    return null;
  } catch {
    return null;
  }
}

function setCache(data: LocationInfo) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch {
    /* ignore */
  }
}

export default function HeroSection() {
  const [info, setInfo] = useState<LocationInfo | null>(null);
  const [isLive, setIsLive] = useState(false);

  // Fetch stream status
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/stream-status');
        if (res.ok) {
          const data = await res.json();
          setIsLive(data.kick || data.twitch);
        }
      } catch {
        /* fail silently */
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch location + weather
  useEffect(() => {
    let cancelled = false;
    const cached = getCached();

    if (cached) {
      // Defer setState to avoid synchronous call inside effect body
      Promise.resolve().then(() => { if (!cancelled) setInfo(cached); });
      return () => { cancelled = true; };
    }

    fetch('/api/chat/homepage')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const result: LocationInfo = {
          location: data.location ?? null,
          weather: data.weather
            ? `${data.weather.emoji} ${data.weather.tempC}°C/${data.weather.tempF}°F`
            : null,
        };
        setCache(result);
        setInfo(result);
      })
      .catch(() => null);

    return () => { cancelled = true; };
  }, []);

  const statusText = info?.location
    ? isLive ? `LIVE from ${info.location}` : `Last seen in ${info.location}`
    : isLive ? 'LIVE now' : 'Streaming IRL adventures';

  return (
    <section id="hero" className="relative min-h-[260px] py-10 overflow-hidden">
      <div className="absolute inset-0 hero-bg" />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
        <Link
          href="/"
          aria-label="Home"
          className="focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded-full"
        >
          <Image
            src="/assets/img/profile.jpg"
            alt="Tazo - IRL Streamer from Australia, based in Japan"
            width={112}
            height={112}
            priority
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover hero-glow"
          />
        </Link>
        <h1 className="text-4xl sm:text-5xl uppercase mt-3 drop-shadow-md tazo-name font-bebas text-white">
          Tazo
        </h1>
        <p className="text-zinc-300 text-sm sm:text-base">IRL Streamer from Australia, based in Japan</p>
        <p className="text-zinc-400 text-sm mt-1.5 max-w-md" aria-live="polite">
          {statusText}
          {info?.weather && <span className="ml-2">{info.weather}</span>}
        </p>
      </div>
    </section>
  );
}
