/**
 * POST to start a custom trivia (question, answers, points). Requires auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';
import { setTriviaState, getTriviaState } from '@/lib/trivia-store';
import { getValidAccessToken, sendKickChatMessage } from '@/lib/kick-api';
import type { TriviaState } from '@/types/trivia';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!(await verifyAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { question?: string; answers?: string[] | string; points?: number };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const rawAnswers = body.answers;
    const points = typeof body.points === 'number' && body.points >= 1 && body.points <= 10000
      ? Math.floor(body.points)
      : 50;
    if (!question) {
      return NextResponse.json({ error: 'Question is required' }, { status: 400 });
    }
    let answers: string[] = [];
    if (Array.isArray(rawAnswers)) {
      answers = rawAnswers.map((a) => String(a).trim().toLowerCase()).filter(Boolean);
    } else if (typeof rawAnswers === 'string') {
      answers = rawAnswers.split(/[\n,]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
    }
    if (answers.length === 0) {
      return NextResponse.json({ error: 'At least one answer is required' }, { status: 400 });
    }
    const existing = await getTriviaState();
    // Only block when a question is actively accepting answers; winner-display phase can be replaced
    if (existing && !existing.winnerDisplayUntil) {
      return NextResponse.json({ error: 'A trivia is already active. Use !endtrivia or !endquiz in chat to cancel.' }, { status: 409 });
    }
    const state: TriviaState = {
      id: `trivia_${Date.now()}`,
      question,
      acceptedAnswers: answers,
      points,
      startedAt: Date.now(),
    };
    await setTriviaState(state);
    const token = await getValidAccessToken();
    if (token) {
      sendKickChatMessage(token, `Trivia: ${state.question} — First correct answer wins ${state.points} Credits.`).catch((e) => {
        console.warn('[trivia-start] Failed to send trivia announcement to chat:', e);
      });
    }
    return NextResponse.json({ success: true, trivia: state });
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
