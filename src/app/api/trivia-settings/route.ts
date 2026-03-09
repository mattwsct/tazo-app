/**
 * GET/POST trivia settings (randomQuestionsText, defaultPoints). Requires auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/api-auth';
import { getTriviaSettings, setTriviaSettings } from '@/lib/trivia-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await verifyAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const settings = await getTriviaSettings();
  return NextResponse.json(settings);
}

export async function POST(request: NextRequest) {
  if (!(await verifyAuth())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as { randomQuestionsText?: string; defaultPoints?: number };
    const updates: { randomQuestionsText?: string; defaultPoints?: number } = {};
    if (typeof body.randomQuestionsText === 'string') updates.randomQuestionsText = body.randomQuestionsText;
    if (typeof body.defaultPoints === 'number' && body.defaultPoints >= 1 && body.defaultPoints <= 10000) {
      updates.defaultPoints = body.defaultPoints;
    }
    await setTriviaSettings(updates);
    const settings = await getTriviaSettings();
    return NextResponse.json(settings);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
