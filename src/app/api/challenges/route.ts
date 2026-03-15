import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestAuth } from '@/lib/api-auth';
import {
  getChallenges,
  addChallenge,
  updateChallengeStatus,
  removeChallenge,
  clearResolvedChallenges,
  setChallengesState,
  makeSocialChallenge,
} from '@/utils/challenges-storage';
import { broadcastChallenges } from '@/lib/challenges-broadcast';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import { addCredits } from '@/utils/gambling-storage';

export const dynamic = 'force-dynamic';

/** GET /api/challenges — public read */
export async function GET() {
  const state = await getChallenges();
  return NextResponse.json(state);
}

/** POST /api/challenges — add a new challenge */
export async function POST(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json() as { bounty?: unknown; description?: unknown; expiresAt?: unknown; durationMs?: unknown; action?: string };

    // Quick-add: random social task ($15)
    if (body.action === 'random_social') {
      const { description, bounty } = makeSocialChallenge();
      const item = await addChallenge(bounty, description);
      if (!item) return NextResponse.json({ error: 'Max 5 active challenges reached' }, { status: 409 });
      void broadcastChallenges().catch(() => {});
      return NextResponse.json(item);
    }

    const bounty = typeof body.bounty === 'number' ? body.bounty : parseFloat(String(body.bounty ?? ''));
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!Number.isFinite(bounty) || bounty < 0) {
      return NextResponse.json({ error: 'Invalid bounty' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: 'Description required' }, { status: 400 });
    }
    // expiresAt: absolute timestamp, OR durationMs: relative ms from now
    let expiresAt: number | undefined;
    if (typeof body.expiresAt === 'number' && body.expiresAt > 0) {
      expiresAt = body.expiresAt;
    } else if (typeof body.durationMs === 'number' && body.durationMs > 0) {
      expiresAt = Date.now() + body.durationMs;
    }
    const item = await addChallenge(bounty, description, expiresAt);
    if (!item) return NextResponse.json({ error: 'Max 5 active challenges reached' }, { status: 409 });
    void broadcastChallenges().catch(() => {});
    return NextResponse.json(item);
  } catch {
    return NextResponse.json({ error: 'Failed to add challenge' }, { status: 500 });
  }
}

/** PATCH /api/challenges — update challenge status, description, bounty, or clear resolved */
export async function PATCH(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      action?: string;
      id?: unknown;
      status?: string;
      description?: string;
      bounty?: unknown;
    };

    // Clear all resolved challenges
    if (body.action === 'clear') {
      const removed = await clearResolvedChallenges();
      void broadcastChallenges().catch(() => {});
      return NextResponse.json({ removed });
    }

    const id = typeof body.id === 'number' ? body.id : parseInt(String(body.id ?? ''), 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    // Update status (completed/failed/active)
    if (body.status !== undefined) {
      if (!['active', 'completed', 'failed', 'timedOut'].includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      if (body.status === 'active') {
        // Reactivate: fetch state and flip
        const state = await getChallenges();
        const c = state.challenges.find((ch) => ch.id === id);
        if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
        c.status = 'active';
        delete c.resolvedAt;
        await setChallengesState(state);
        void broadcastChallenges().catch(() => {});
        return NextResponse.json(c);
      }
      const updated = await updateChallengeStatus(id, body.status as 'completed' | 'failed');
      if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      void broadcastChallenges().catch(() => {});
      if (body.status === 'failed') {
        const bountyStr = updated.bounty % 1 === 0 ? updated.bounty.toFixed(0) : updated.bounty.toFixed(2);
        void getValidAccessToken().then((token) => {
          if (token) return sendKickChatMessage(token, `❌ Challenge failed: $${bountyStr} — ${updated.description}`);
        }).catch(() => {});
      }
      return NextResponse.json(updated);
    }

    // Edit description or bounty
    if (body.description !== undefined || body.bounty !== undefined) {
      const state = await getChallenges();
      const c = state.challenges.find((ch) => ch.id === id);
      if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (body.description !== undefined) c.description = body.description.trim();
      if (body.bounty !== undefined) {
        const b = typeof body.bounty === 'number' ? body.bounty : parseFloat(String(body.bounty));
        if (Number.isFinite(b) && b >= 0) c.bounty = Math.round(b * 100) / 100;
      }
      await setChallengesState(state);
      void broadcastChallenges().catch(() => {});
      return NextResponse.json(c);
    }

    return NextResponse.json({ error: 'No action specified' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}

/** DELETE /api/challenges?id=<id> — remove a challenge */
export async function DELETE(request: NextRequest) {
  if (!verifyRequestAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const id = parseInt(url.searchParams.get('id') ?? '', 10);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const removed = await removeChallenge(id);
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (removed.buyerUsername) {
      void addCredits(removed.buyerUsername, 1000, { skipExclusions: true }).catch(() => {});
    }
    void broadcastChallenges().catch(() => {});
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
