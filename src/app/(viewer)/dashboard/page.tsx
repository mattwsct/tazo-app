'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

interface ViewerData {
  authenticated: false;
}

interface AuthenticatedViewerData {
  authenticated: true;
  kickUsername?: string;
  discordUsername?: string;
  balance: number;
  rank: number | null;
}

type MeResponse = ViewerData | AuthenticatedViewerData;

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

  // Show any OAuth errors from the URL
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
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-zinc-500 text-sm animate-pulse">Loading...</div>
      </div>
    );
  }

  const isAuth = data?.authenticated === true;
  const authData = isAuth ? (data as AuthenticatedViewerData) : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-200">
      <div className="max-w-lg mx-auto px-4 py-16">
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">
            {isAuth && authData?.kickUsername
              ? `Hey, ${authData.kickUsername}!`
              : "Tazo's Dashboard"}
          </h1>
          {!isAuth && (
            <p className="text-zinc-400">
              Connect your account to see your credits, rank, and more.
            </p>
          )}
        </div>

        {/* Error notices */}
        {(error || oauthError) && (
          <div className="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm">
            {error ?? `Connection failed: ${oauthError}. Please try again.`}
          </div>
        )}

        {/* Not connected state */}
        {!isAuth && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-full p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 text-center">
              <p className="text-zinc-400 text-sm mb-6">
                Connect via Kick to see your credits and leaderboard rank, or link your Discord to verify your identity.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/viewer/kick-connect"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                >
                  <KickIcon />
                  Connect with Kick
                </a>
                {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                <a
                  href="/api/viewer/discord-connect"
                  className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors"
                >
                  <DiscordIcon />
                  Connect with Discord
                </a>
              </div>
            </div>

            {/* Credit earning info */}
            <div className="w-full p-5 rounded-xl bg-zinc-900/40 border border-zinc-800/60">
              <h2 className="text-sm font-semibold text-zinc-300 mb-3 uppercase tracking-wider">How credits work</h2>
              <ul className="space-y-1.5 text-sm text-zinc-400">
                <li className="flex justify-between"><span>Subscribe</span><span className="text-emerald-400 font-medium">+100 credits</span></li>
                <li className="flex justify-between"><span>Resub</span><span className="text-emerald-400 font-medium">+50 credits</span></li>
                <li className="flex justify-between"><span>Gift a sub</span><span className="text-emerald-400 font-medium">+75 per sub</span></li>
                <li className="flex justify-between"><span>Channel rewards</span><span className="text-emerald-400 font-medium">Varies</span></li>
              </ul>
              <p className="mt-3 text-xs text-zinc-500">
                Use credits to play blackjack in chat with <code className="font-mono text-zinc-400">!deal [amount]</code>
              </p>
            </div>
          </div>
        )}

        {/* Connected state */}
        {isAuth && authData && (
          <div className="space-y-4">
            {/* Stats card */}
            <div className="p-6 rounded-xl bg-zinc-900/60 border border-zinc-800 space-y-4">
              {/* Connected accounts */}
              <div className="space-y-2">
                {authData.kickUsername && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <KickIcon />
                      {authData.kickUsername}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">Kick connected</span>
                    <CheckIcon />
                  </div>
                )}
                {authData.discordUsername && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex items-center gap-1.5 text-indigo-400 font-medium">
                      <DiscordIcon />
                      {authData.discordUsername}
                    </span>
                    <span className="ml-auto text-xs text-zinc-500">Discord connected</span>
                    <CheckIcon />
                  </div>
                )}
              </div>

              <div className="border-t border-zinc-800" />

              {/* Credits */}
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Credits</p>
                  <p className="text-3xl font-bold text-white">
                    {authData.balance.toLocaleString()}
                  </p>
                </div>
                {authData.rank && (
                  <div className="text-right">
                    <p className="text-xs text-zinc-500 uppercase tracking-wider mb-1">Rank</p>
                    <p className="text-2xl font-bold text-emerald-400">#{authData.rank}</p>
                  </div>
                )}
              </div>

              {authData.rank && (
                <p className="text-xs text-zinc-500">
                  You are #{authData.rank} on the leaderboard.
                </p>
              )}
            </div>

            {/* Quick actions */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={() => router.push('/leaderboard/tazo')}
                className="flex-1 px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-sm font-medium transition-colors text-center"
              >
                View Leaderboard
              </button>
            </div>

            {/* Connect Discord if not yet connected */}
            {!authData.discordUsername && (
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a
                href="/api/viewer/discord-connect"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-700/50 text-indigo-300 text-sm font-medium transition-colors"
              >
                <DiscordIcon />
                Also connect Discord
              </a>
            )}

            {/* Credit earning reminders */}
            <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Earn more credits</h2>
              <ul className="space-y-1 text-xs text-zinc-500">
                <li>Subscribe: <span className="text-emerald-400">+100 credits</span></li>
                <li>Resub: <span className="text-emerald-400">+50 credits</span></li>
                <li>Gift a sub: <span className="text-emerald-400">+75 credits per sub</span></li>
                <li>Play blackjack: bet your credits in chat with <code className="font-mono text-zinc-400">!deal [amount]</code></li>
              </ul>
            </div>

            {/* Disconnect */}
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="w-full px-4 py-2.5 rounded-lg bg-zinc-900 hover:bg-red-900/30 border border-zinc-800 hover:border-red-800/60 text-zinc-500 hover:text-red-400 text-sm transition-colors disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function KickIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3H3v18h2v-7l2 2 5-5-5-5-2 2V3zm9 5l-2 2 5 4-5 4 2 2 7-6-7-6z" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
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
