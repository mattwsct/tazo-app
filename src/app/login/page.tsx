"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { startAuthentication } from '@simplewebauthn/browser';
import '@/styles/marketing.css';

function KickIcon({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M5 3H3v18h2v-7l2 2 5-5-5-5-2 2V3zm9 5l-2 2 5 4-5 4 2 2 7-6-7-6z" />
    </svg>
  );
}

function FingerprintIcon() {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 17.5c2.07-1.44 3.48-3.47 3.5-5.5" />
      <path d="M7 13.51c0 4.23-1.27 6.5-2 8.49" />
      <path d="M21.7 16.4a6 6 0 0 0 .3-2.4" />
      <path d="M22 10a10 10 0 0 1-.26 2.26" />
      <path d="M5 10a7 7 0 0 1 14 0c0 3.5-.5 6-2 9.5" />
      <path d="M9 17.7c-.14 1.04-.14 1.76-.08 3" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasPasskeys, setHasPasskeys] = useState(false);

  // Check if any passkeys are registered (to decide whether to show the button)
  useEffect(() => {
    if (!window.PublicKeyCredential) return;
    fetch('/api/passkey/authenticate/options', { method: 'POST' })
      .then((r) => r.json())
      .then((opts: { allowCredentials?: unknown[] }) => {
        setHasPasskeys((opts.allowCredentials?.length ?? 0) > 0);
      })
      .catch(() => {});
  }, []);

  const handlePasskey = async () => {
    setIsPasskeyLoading(true);
    setError('');
    try {
      const optRes = await fetch('/api/passkey/authenticate/options', { method: 'POST' });
      const options = await optRes.json();

      const authResponse = await startAuthentication({ optionsJSON: options });

      const verifyRes = await fetch('/api/passkey/authenticate/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authResponse),
        credentials: 'include',
      });

      if (verifyRes.ok) {
        router.push('/admin');
      } else {
        const d = await verifyRes.json() as { error?: string };
        setError(d.error ?? 'Passkey authentication failed');
      }
    } catch (e) {
      // User cancelled or browser error
      if (e instanceof Error && e.name !== 'NotAllowedError') {
        setError('Passkey authentication failed — try password instead');
      }
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setIsLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        credentials: 'include',
      });
      if (res.ok) {
        router.push('/admin');
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-sm transition-colors mb-8">
            ← Back to site
          </Link>
        </div>

        <div className="rounded-2xl bg-white/[0.03] border border-white/10 backdrop-blur p-8">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <KickIcon size={32} />
            </div>
          </div>

          <h1 className="text-2xl font-bold text-white text-center mb-1 tracking-tight">Admin Login</h1>
          <p className="text-zinc-500 text-sm text-center mb-8">Access overlay controls and stream settings</p>

          {error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-900/20 border border-red-800/40 text-red-300 text-sm mb-4">
              <span aria-hidden="true">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {/* Passkey button — shown when passkeys are registered */}
          {hasPasskeys && (
            <>
              <button
                type="button"
                onClick={handlePasskey}
                disabled={isPasskeyLoading}
                className="w-full flex items-center justify-center gap-2.5 px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors text-sm mb-4"
              >
                {isPasskeyLoading ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Waiting for Touch ID…
                  </>
                ) : (
                  <>
                    <FingerprintIcon />
                    Sign in with Touch ID
                  </>
                )}
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-zinc-600 text-xs">or use password</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
            </>
          )}

          <form onSubmit={handlePassword} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="password" className="block text-xs font-semibold text-zinc-400 uppercase tracking-widest">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                disabled={isLoading}
                autoFocus={!hasPasskeys}
                className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 focus:border-emerald-500/50 focus:outline-none text-white placeholder-zinc-600 text-sm transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !password.trim()}
              className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/30 disabled:cursor-not-allowed text-white font-semibold transition-colors shadow-lg shadow-emerald-500/20 text-sm"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Logging in…
                </>
              ) : (
                <>
                  <span>🔐</span>
                  Login
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
