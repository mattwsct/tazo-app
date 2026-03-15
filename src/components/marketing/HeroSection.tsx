'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface LocationInfo {
  location: string | null;
  weather: string | null;
}

interface KickProfile {
  username: string | null;
  bio: string | null;
  profilePic: string | null;
  instagram: string | null;
  twitter: string | null;
  youtube: string | null;
  discord: string | null;
  tiktok: string | null;
  facebook: string | null;
}

const LOCATION_CACHE_KEY = 'tazo_location_info_v2';
const LOCATION_CACHE_TTL = 5 * 60 * 1000;
const PROFILE_CACHE_KEY = 'tazo_kick_profile_v1';
const PROFILE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getLocationCached(): LocationInfo | null {
  try {
    const raw = localStorage.getItem(LOCATION_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < LOCATION_CACHE_TTL) return data;
    localStorage.removeItem(LOCATION_CACHE_KEY);
    return null;
  } catch { return null; }
}

function setLocationCache(data: LocationInfo) {
  try { localStorage.setItem(LOCATION_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); } catch { /* ignore */ }
}

function getProfileCached(): KickProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const { data, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp < PROFILE_CACHE_TTL) return data;
    localStorage.removeItem(PROFILE_CACHE_KEY);
    return null;
  } catch { return null; }
}

function setProfileCache(data: KickProfile) {
  try { localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() })); } catch { /* ignore */ }
}

// Map Kick social handles to full URLs
function socialUrl(platform: keyof Omit<KickProfile, 'profilePic' | 'username' | 'bio'>, handle: string): string {
  if (handle.startsWith('http')) return handle;
  switch (platform) {
    case 'instagram': return `https://instagram.com/${handle}`;
    case 'twitter':   return `https://x.com/${handle}`;
    case 'youtube':   return `https://youtube.com/@${handle}`;
    case 'discord':   return `https://discord.gg/${handle}`;
    case 'tiktok':    return `https://tiktok.com/@${handle}`;
    case 'facebook':  return `https://facebook.com/${handle}`;
    default:          return handle;
  }
}

const SOCIAL_ICONS: Record<keyof Omit<KickProfile, 'profilePic' | 'username' | 'bio'>, { label: string; icon: string }> = {
  twitter:   { label: 'X / Twitter', icon: 'x' },
  instagram: { label: 'Instagram',   icon: 'instagram' },
  youtube:   { label: 'YouTube',     icon: 'youtube' },
  tiktok:    { label: 'TikTok',      icon: 'tiktok' },
  discord:   { label: 'Discord',     icon: 'discord' },
  facebook:  { label: 'Facebook',    icon: 'facebook' },
};

export default function HeroSection() {
  const [info, setInfo] = useState<LocationInfo | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [profile, setProfile] = useState<KickProfile | null>(null);
  const [imgSrc, setImgSrc] = useState<string | null>(null);

  // Fetch stream status
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/stream-status');
        if (res.ok) {
          const data = await res.json();
          setIsLive(data.kick || data.twitch);
        }
      } catch { /* fail silently */ }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, []);

  // Fetch location + weather
  useEffect(() => {
    let cancelled = false;
    const cached = getLocationCached();
    if (cached) {
      Promise.resolve().then(() => { if (!cancelled) setInfo(cached); });
      return () => { cancelled = true; };
    }
    fetch('/api/chat/homepage')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        const result: LocationInfo = {
          location: data.location ?? null,
          weather: data.weather ? `${data.weather.emoji} ${data.weather.tempC}°C/${data.weather.tempF}°F` : null,
        };
        setLocationCache(result);
        if (!cancelled) setInfo(result);
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, []);

  // Fetch Kick profile (image + socials), cached 1h in localStorage
  useEffect(() => {
    let cancelled = false;
    const cached = getProfileCached();
    if (cached) {
      if (cached.profilePic) setImgSrc(cached.profilePic);
      setProfile(cached);
      return () => { cancelled = true; };
    }
    fetch('/api/kick-profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: KickProfile | null) => {
        if (!data || cancelled) return;
        setProfileCache(data);
        setProfile(data);
        if (data.profilePic) setImgSrc(data.profilePic);
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, []);

  const statusText = info?.location
    ? isLive ? `LIVE from ${info.location}` : `Last seen in ${info.location}`
    : isLive ? 'LIVE now' : 'Streaming IRL adventures';

  const socials = profile
    ? (Object.keys(SOCIAL_ICONS) as (keyof Omit<KickProfile, 'profilePic' | 'username' | 'bio'>)[]).filter((k) => profile[k])
    : [];

  return (
    <section id="hero" className="relative min-h-[260px] py-10 overflow-hidden">
      <div className="absolute inset-0 hero-bg" />
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div className="relative z-10 flex flex-col items-center justify-center h-full text-center px-4">
        {imgSrc && (
          <Link
            href="/"
            aria-label="Home"
            className="focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-transparent rounded-full"
          >
            <Image
              src={imgSrc}
              alt={profile?.username ?? 'Creator profile'}
              width={112}
              height={112}
              priority
              unoptimized
              className="w-24 h-24 sm:w-28 sm:h-28 rounded-full object-cover hero-glow"
              onError={() => setImgSrc(null)}
            />
          </Link>
        )}
        {profile?.username && (
          <h1 className="text-4xl sm:text-5xl uppercase mt-3 drop-shadow-md tazo-name font-bebas text-white">
            {profile.username}
          </h1>
        )}
        {profile?.bio && (
          <p className="text-zinc-300 text-sm sm:text-base">{profile.bio}</p>
        )}
        <p className="text-zinc-400 text-sm mt-1.5 max-w-md" aria-live="polite">
          {statusText}
          {info?.weather && <span className="ml-2">{info.weather}</span>}
        </p>

        {socials.length > 0 && (
          <div className="flex items-center gap-3 mt-4">
            {socials.map((platform) => {
              const handle = profile![platform]!;
              const { label, icon } = SOCIAL_ICONS[platform];
              return (
                <a
                  key={platform}
                  href={socialUrl(platform, handle)}
                  target="_blank"
                  rel="me noopener noreferrer"
                  aria-label={label}
                >
                  <img
                    src={`https://cdn.simpleicons.org/${icon}/a1a1aa`}
                    alt={label}
                    width={20}
                    height={20}
                    className="w-5 h-5 opacity-70 hover:opacity-100 transition-opacity"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                </a>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
