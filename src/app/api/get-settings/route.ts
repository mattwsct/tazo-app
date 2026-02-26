import { NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { logKVUsage } from '@/lib/api-auth';
import { validateEnvironment } from '@/lib/env-validator';
import { OverlayLogger } from '@/lib/logger';
import { mergeSettingsWithDefaults } from '@/utils/overlay-utils';
import { POLL_STATE_KEY, type PollState } from '@/types/poll';
import { getGamblingLeaderboardTop } from '@/utils/gambling-storage';
import { getEarnedLeaderboard } from '@/utils/tazo-vault-storage';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';
import { getRecentAlerts } from '@/utils/overlay-alerts-storage';
import { getStreamGoals } from '@/utils/stream-goals-storage';
import { getGoalCelebration } from '@/utils/stream-goals-celebration';

export const dynamic = 'force-dynamic';

async function handleGET() {
  try {
    logKVUsage('read');
    const [settings, rawPollState] = await kv.mget<[Record<string, unknown> | null, PollState | null]>(
      'overlay_settings',
      POLL_STATE_KEY
    );
    const pollState: PollState | null = rawPollState ?? null;
    const merged = mergeSettingsWithDefaults({ ...(settings || {}), pollState });

    const gamblingEnabled = merged.gamblingEnabled !== false;
    const showLeaderboard = merged.showLeaderboard !== false && gamblingEnabled;
    const needGoals = merged.showSubGoal || merged.showKicksGoal;
    const leaderboardTopN = merged.gamblingLeaderboardTopN ?? merged.leaderboardTopN ?? 5;

    const [gamblingLeaderboardTop, overlayAlerts, streamGoals, celebration, excludedUsers] = await Promise.all([
      showLeaderboard ? getGamblingLeaderboardTop(leaderboardTopN) : [],
      merged.showOverlayAlerts !== false ? getRecentAlerts() : [],
      needGoals ? getStreamGoals() : { subs: 0, kicks: 0 },
      needGoals ? getGoalCelebration() : {},
      showLeaderboard ? getLeaderboardExclusions() : Promise.resolve(new Set<string>()),
    ]);

    const [earnedWeekly, earnedMonthly, earnedLifetime] = showLeaderboard
      ? await Promise.all([
          getEarnedLeaderboard('weekly', leaderboardTopN, excludedUsers as Set<string>),
          getEarnedLeaderboard('monthly', leaderboardTopN, excludedUsers as Set<string>),
          getEarnedLeaderboard('lifetime', leaderboardTopN, excludedUsers as Set<string>),
        ])
      : [[], [], []];

    const combinedSettings = {
      ...merged,
      gamblingLeaderboardTop,
      earnedLeaderboardWeekly: earnedWeekly,
      earnedLeaderboardMonthly: earnedMonthly,
      earnedLeaderboardLifetime: earnedLifetime,
      overlayAlerts,
      streamGoals,
      subGoalCelebrationUntil: (celebration as { subsUntil?: number }).subsUntil,
      kicksGoalCelebrationUntil: (celebration as { kicksUntil?: number }).kicksUntil,
    };

    // Log at most once per 30s in dev to avoid log spam (get-settings is polled frequently)
    if (process.env.NODE_ENV === 'development') {
      const now = Date.now();
      const lastLog = (globalThis as { _getSettingsLastLog?: number })._getSettingsLastLog ?? 0;
      if (now - lastLog > 30000) {
        (globalThis as { _getSettingsLastLog?: number })._getSettingsLastLog = now;
        OverlayLogger.settings('Settings loaded', { hasPollState: !!pollState });
      }
    }
    
    return NextResponse.json(combinedSettings, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load settings' },
      { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  // Validate environment (only KV storage is required)
  const envValidation = validateEnvironment();
  if (!envValidation.isValid) {
    OverlayLogger.error('Environment validation failed', envValidation.missing);
    return new NextResponse('Server configuration error', { status: 500 });
  }
  
  // Allow unauthenticated access for overlay (public access)
  // Authentication is only required for admin panel access
  return handleGET();
} 