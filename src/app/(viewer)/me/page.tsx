'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface ViewerData {
  authenticated: false;
}

interface AuthenticatedViewerData {
  authenticated: true;
  viewerUuid?: string;
  kickUsername?: string;
  discordUsername?: string;
  balance: number;
  rank: number | null;
}

type MeResponse = ViewerData | AuthenticatedViewerData;

function KickIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1.333 0h8v5.333H12V2.667h2.667V0h8v8H20v2.667h-2.667v2.666H20V16h2.667v8h-8v-2.667H12v-2.666H9.333V24h-8Z" />
    </svg>
  );
}

function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function NavBar({ showDisconnect, onDisconnect, disconnecting }: {
  showDisconnect?: boolean;
  onDisconnect?: () => void;
  disconnecting?: boolean;
}) {
  return (
    <nav className="sticky top-0 z-10 border-b border-white/5 bg-zinc-950/80 backdrop-blur-md">
      <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="text-white font-bold text-lg tracking-tight hover:text-emerald-400 transition-colors">
          Tazo
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/commands" className="text-zinc-400 hover:text-white text-sm transition-colors">
            Commands
          </Link>
          {showDisconnect && onDisconnect && (
            <button
              onClick={onDisconnect}
              disabled={disconnecting}
              className="text-zinc-500 hover:text-red-400 text-sm transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const fetchMe = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/viewer/me');
      const json = await res.json() as MeResponse;
      setData(json);
    } catch {
      setError('Failed to load your data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const oauthError = searchParams.get('error');

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await fetch('/api/viewer/logout', { method: 'POST' });
      await fetchMe();
    } catch {
      setError('Failed to disconnect. Please try again.');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <>
        <NavBar />
        <div className="flex items-center justify-center min-h-[80vh]">
          <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
        </div>
      </>
    );
  }

  const isAuth = data?.authenticated === true;
  const authData = isAuth ? (data as AuthenticatedViewerData) : null;

  if (isAuth && authData) {
    return (
      <>
        <NavBar showDisconnect onDisconnect={handleDisconnect} disconnecting={disconnecting} />

        <div className="max-w-4xl mx-auto px-4 py-10 space-y-8">
          {/* Error notice */}
          {(error || oauthError) && (
            <div className="p-4 rounded-xl bg-red-900/20 border border-red-800/40 text-red-300 text-sm">
              {error ?? `Connection failed: ${oauthError}. Please try again.`}
            </div>
          )}

          {/* Profile hero */}
          <div className="rounded-2xl bg-gradient-to-br from-white/5 to-white/[0.02] border border-white/10 backdrop-blur p-8">
            <h1 className="text-3xl font-bold text-white mb-4">
              Hey, {authData.kickUsername ?? authData.discordUsername ?? 'there'}! 👋
            </h1>
            <div className="flex flex-wrap gap-2">
              {authData.kickUsername && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-medium">
                  <CheckIcon />
                  <KickIcon size={14} />
                  {authData.kickUsername}
                </span>
              )}
              {authData.discordUsername && (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-sm font-medium">
                  <CheckIcon />
                  <DiscordIcon size={14} />
                  {authData.discordUsername}
                </span>
              )}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Credits card */}
            <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur p-6 space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Credits</p>
              <p className="text-5xl font-bold bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                {authData.balance.toLocaleString()}
              </p>
              <p className="text-zinc-500 text-sm">Your total credit balance</p>
            </div>

            {/* Rank card */}
            <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur p-6 space-y-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest">Leaderboard Rank</p>
              {authData.rank ? (
                <>
                  <p className="text-5xl font-bold text-white">
                    <span className="text-emerald-400">#{authData.rank}</span>
                  </p>
                  <p className="text-zinc-500 text-sm">Out of all viewers</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-zinc-600">—</p>
                  <p className="text-zinc-600 text-sm">Earn credits to rank up</p>
                </>
              )}
            </div>
          </div>

          {/* Actions row */}
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => router.push('/leaderboard/tazo')}
              className="flex-1 px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white text-sm font-medium transition-all text-center"
            >
              View Leaderboard
            </button>
            <Link
              href="/commands"
              className="flex-1 px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 text-white text-sm font-medium transition-all text-center"
            >
              Chat Commands
            </Link>
          </div>

          {/* Connect Discord prompt if not connected */}
          {!authData.discordUsername && (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/api/viewer/discord-connect"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 hover:border-indigo-500/50 text-indigo-300 text-sm font-medium transition-all"
            >
              <DiscordIcon size={16} />
              Also connect Discord to link your identity
            </a>
          )}

          {/* Connect Kick prompt if not connected */}
          {!authData.kickUsername && (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/api/viewer/kick-connect"
              className="flex items-center justify-center gap-2.5 w-full px-5 py-3.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 text-emerald-300 text-sm font-medium transition-all"
            >
              <KickIcon size={16} />
              Also connect Kick to track your credits
            </a>
          )}

          {/* Earn more credits */}
          <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur p-6">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-4">Earn More Credits</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { label: 'Subscribe', value: '+100 credits' },
                { label: 'Resub', value: '+100 credits' },
                { label: 'Gift a sub', value: '+100 credits' },
                { label: 'Channel rewards', value: 'Varies' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.03] border border-white/5">
                  <span className="text-zinc-300 text-sm">{item.label}</span>
                  <span className="text-emerald-400 text-sm font-semibold">{item.value}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-zinc-600">
              Use credits to play blackjack in chat with{' '}
              <code className="font-mono text-zinc-500">!deal [amount]</code>
            </p>
          </div>
        </div>
      </>
    );
  }

  // Not connected state
  return (
    <>
      <NavBar />

      {/* Hero area */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-950/30 via-transparent to-transparent pointer-events-none" />
        <div className="max-w-4xl mx-auto px-4 pt-16 pb-12 text-center relative">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Community Hub
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
            {"Tazo's Community Hub"}
          </h1>
          <p className="text-zinc-400 text-lg max-w-md mx-auto">
            Track your credits, see your rank, and connect your accounts.
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 pb-16 space-y-8">
        {/* Error notice */}
        {(error || oauthError) && (
          <div className="p-4 rounded-xl bg-red-900/20 border border-red-800/40 text-red-300 text-sm">
            {error ?? `Connection failed: ${oauthError}. Please try again.`}
          </div>
        )}

        {/* Connect cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Kick card */}
          <div className="relative rounded-2xl bg-white/5 border border-emerald-500/20 hover:border-emerald-500/40 backdrop-blur p-8 flex flex-col items-center text-center gap-5 transition-all group">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <KickIcon size={28} />
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg mb-1">Connect with Kick</h2>
              <p className="text-zinc-400 text-sm">See your credits and leaderboard rank</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/viewer/kick-connect"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-semibold transition-colors shadow-lg shadow-emerald-500/20"
            >
              <KickIcon size={16} />
              Connect Kick
            </a>
          </div>

          {/* Discord card */}
          <div className="relative rounded-2xl bg-white/5 border border-indigo-500/20 hover:border-indigo-500/40 backdrop-blur p-8 flex flex-col items-center text-center gap-5 transition-all group">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <DiscordIcon size={28} />
            </div>
            <div>
              <h2 className="text-white font-semibold text-lg mb-1">Connect with Discord</h2>
              <p className="text-zinc-400 text-sm">Link your Discord identity</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/api/viewer/discord-connect"
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors shadow-lg shadow-indigo-500/20"
            >
              <DiscordIcon size={16} />
              Connect Discord
            </a>
          </div>
        </div>

        {/* How credits work */}
        <div className="rounded-2xl bg-white/5 border border-white/10 backdrop-blur p-6">
          <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-5">How to Earn Credits</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: '⭐', label: 'Subscribe', value: '+100 credits', desc: 'New subscription' },
              { icon: '🔄', label: 'Resub', value: '+100 credits', desc: 'Monthly renewal' },
              { icon: '🎁', label: 'Gift a Sub', value: '+100 credits', desc: 'Gift subscriptions' },
              { icon: '🏆', label: 'Rewards', value: 'Varies', desc: 'Channel point rewards' },
            ].map((item) => (
              <div key={item.label} className="flex flex-col gap-2 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:border-white/10 transition-colors">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <p className="text-white font-semibold text-sm">{item.label}</p>
                  <p className="text-zinc-500 text-xs">{item.desc}</p>
                </div>
                <p className="text-emerald-400 font-bold text-sm mt-auto">{item.value}</p>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-zinc-600">
            Use credits to play blackjack in chat with{' '}
            <code className="font-mono text-zinc-500">!deal [amount]</code>
          </p>
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
