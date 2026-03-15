'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import Link from 'next/link';

interface LeaderboardEntry {
  rank: number;
  username: string;
  credits: number;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  total: number;
  creator: string;
}

interface MeData {
  authenticated: boolean;
  kickUsername?: string;
  discordUsername?: string;
  balance?: number;
  rank?: number | null;
}

/** Derive creator slug from subdomain. Falls back to 'tazo' on the root domain or localhost. */
function getCreatorFromHost(): string {
  if (typeof window === 'undefined') return 'tazo';
  const parts = window.location.hostname.split('.');
  // alex.tazo.wtf → ['alex', 'tazo', 'wtf'] → 'alex'
  // tazo.wtf      → ['tazo', 'wtf']          → 'tazo' (fallback)
  // localhost     → ['localhost']             → 'tazo' (fallback)
  if (parts.length >= 3 && parts[0] !== 'www') return parts[0];
  return 'tazo';
}

function KickIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3H3v18h2v-7l2 2 5-5-5-5-2 2V3zm9 5l-2 2 5 4-5 4 2 2 7-6-7-6z" />
    </svg>
  );
}

const RANK_COLORS: Record<number, { text: string; bg: string; border: string; medal: string }> = {
  1: { text: 'text-yellow-400',  bg: 'bg-yellow-500/10',  border: 'border-yellow-500/30', medal: '🥇' },
  2: { text: 'text-zinc-300',    bg: 'bg-zinc-400/10',    border: 'border-zinc-400/30',   medal: '🥈' },
  3: { text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/30', medal: '🥉' },
};

function PodiumCard({ entry, creator }: { entry: LeaderboardEntry; creator: string }) {
  const style = RANK_COLORS[entry.rank];
  return (
    <div className={`relative rounded-2xl ${style.bg} border ${style.border} p-5 flex flex-col items-center text-center gap-2 flex-1`}>
      <span className="text-3xl">{style.medal}</span>
      <Link
        href={`/profile/${creator}/${entry.username}`}
        className={`font-bold text-base ${style.text} hover:underline truncate max-w-full`}
      >
        {entry.username}
      </Link>
      <p className="text-white font-bold text-xl">{entry.credits.toLocaleString()}</p>
      <p className="text-zinc-500 text-xs">credits</p>
    </div>
  );
}

function LeaderboardContent() {
  const [creator, setCreator] = useState('tazo');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [me, setMe] = useState<MeData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setCreator(getCreatorFromHost());
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const [lbRes, meRes] = await Promise.all([
      fetch(`/api/leaderboard?creator=${encodeURIComponent(creator)}&limit=100`),
      fetch('/api/viewer/me'),
    ]);
    const lb = await lbRes.json() as LeaderboardData;
    const meJson = await meRes.json() as MeData;
    setData(lb);
    setMe(meJson);
    setLoading(false);
  }, [creator]);

  useEffect(() => { load(); }, [load]);

  const myUsername = me?.authenticated ? (me.kickUsername ?? '') : '';
  const myRank = me?.authenticated ? (me.rank ?? null) : null;
  const myCredits = me?.authenticated ? (me.balance ?? 0) : 0;

  const myEntry = myUsername ? data?.entries.find((e) => e.username.toLowerCase() === myUsername.toLowerCase()) : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading leaderboard...</div>
      </div>
    );
  }

  if (!data || data.entries.length === 0) {
    return (
      <div className="min-h-screen bg-zinc-950">
        <Nav creator={creator} />
        <div className="max-w-3xl mx-auto px-4 py-20 text-center">
          <p className="text-zinc-500">No entries yet — start earning credits in chat!</p>
        </div>
      </div>
    );
  }

  const [first, second, third, ...rest] = data.entries;

  return (
    <div className="min-h-screen bg-zinc-950">
      <Nav creator={creator} />

      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/30 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-3xl mx-auto px-4 pt-12 pb-8 text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-4">
            <KickIcon size={12} />
            {creator}
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight mb-2">Leaderboard</h1>
          <p className="text-zinc-400 text-sm">{data.total} viewers ranked by credits</p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pb-16 space-y-6">
        {me?.authenticated && myRank && (
          <div className={`rounded-2xl p-4 border flex items-center gap-4 ${
            myEntry ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-white/5 border-white/10'
          }`}>
            <div className="text-2xl font-bold text-emerald-400 w-12 text-center">#{myRank}</div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-semibold truncate">{myUsername} <span className="text-xs text-zinc-500 font-normal">(you)</span></p>
              <p className="text-zinc-400 text-sm">{myCredits.toLocaleString()} credits</p>
            </div>
            <div className="text-xs text-zinc-500">Your rank</div>
          </div>
        )}

        {!me?.authenticated && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-4 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-zinc-400 text-sm">Connect your Kick account to see your rank</p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/viewer/kick-connect"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold transition-colors shrink-0"
            >
              <KickIcon size={14} />
              Connect Kick
            </a>
          </div>
        )}

        <div className="flex gap-3">
          {second && <PodiumCard entry={second} creator={creator} />}
          {first && <PodiumCard entry={first} creator={creator} />}
          {third && <PodiumCard entry={third} creator={creator} />}
        </div>

        {rest.length > 0 && (
          <div className="rounded-2xl bg-white/[0.03] border border-white/10 overflow-hidden">
            <div className="divide-y divide-white/5">
              {rest.map((entry) => {
                const isMe = myUsername && entry.username.toLowerCase() === myUsername.toLowerCase();
                return (
                  <div
                    key={entry.username}
                    className={`flex items-center gap-4 px-5 py-3.5 transition-colors ${
                      isMe ? 'bg-emerald-500/10' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <span className="text-zinc-500 text-sm w-8 text-right shrink-0">{entry.rank}</span>
                    <Link
                      href={`/profile/${creator}/${entry.username}`}
                      className={`flex-1 font-medium text-sm truncate transition-colors ${
                        isMe ? 'text-emerald-400 hover:text-emerald-300' : 'text-zinc-200 hover:text-white'
                      }`}
                    >
                      {entry.username}
                      {isMe && <span className="text-xs text-zinc-500 font-normal ml-1.5">(you)</span>}
                    </Link>
                    <span className={`text-sm font-semibold shrink-0 ${isMe ? 'text-emerald-400' : 'text-zinc-300'}`}>
                      {entry.credits.toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 p-5">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mb-3">How to earn credits</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[
              { label: 'Subscribe', value: '+100' },
              { label: 'Resub', value: '+100' },
              { label: 'Gift a sub', value: '+100' },
              { label: 'Channel rewards', value: 'Varies' },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-0.5 p-2.5 rounded-lg bg-white/[0.03] border border-white/5">
                <span className="text-zinc-400 text-xs">{item.label}</span>
                <span className="text-emerald-400 font-bold">{item.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-zinc-600">
            Use credits for <code className="text-zinc-500 font-mono">!deal</code> blackjack in chat
          </p>
        </div>
      </div>
    </div>
  );
}

function Nav({ creator }: { creator: string }) {
  return (
    <nav className="sticky top-0 z-10 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-lg tracking-tight hover:text-emerald-400 transition-colors">
          {creator}
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/commands" className="text-zinc-400 hover:text-white text-sm transition-colors">Commands</Link>
          <Link href="/me" className="text-zinc-400 hover:text-white text-sm transition-colors">My Stats</Link>
        </div>
      </div>
    </nav>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
      </div>
    }>
      <LeaderboardContent />
    </Suspense>
  );
}
