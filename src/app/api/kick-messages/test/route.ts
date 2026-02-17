import { NextRequest, NextResponse } from 'next/server';
import { kv } from '@vercel/kv';
import { sendKickChatMessage, refreshKickTokens } from '@/lib/kick-api';
import type { StoredKickTokens } from '@/lib/kick-api';
import {
  getFollowResponse,
  getNewSubResponse,
  getResubResponse,
  getGiftSubResponse,
  getKicksGiftedResponse,
  getChannelRewardResponse,
  getStreamStatusResponse,
  getHostResponse,
} from '@/lib/kick-event-responses';
import type { KickMessageTemplates } from '@/types/kick-messages';

const KICK_TOKENS_KEY = 'kick_tokens';

export const dynamic = 'force-dynamic';

/** Mock payloads for template preview/test */
const MOCK_PAYLOADS: Record<keyof KickMessageTemplates, Record<string, unknown>> = {
  follow: { follower: { username: 'TestViewer' } },
  newSub: { subscriber: { username: 'TestViewer' } },
  resub: { subscriber: { username: 'TestViewer' }, duration: 3 },
  giftSubSingle: { gifter: { username: 'TestGifter' }, giftees: [{ username: 'TestViewer' }] },
  giftSubMulti: { gifter: { username: 'TestGifter' }, giftees: [{}, {}, {}] },
  giftSubGeneric: { gifter: { username: 'TestGifter' }, giftees: [] },
  kicksGifted: { sender: { username: 'TestViewer' }, gift: { amount: 100, name: 'High Five' } },
  kicksGiftedWithMessage: {
    sender: { username: 'TestViewer' },
    gift: { amount: 500, name: 'Rage Quit', message: 'Great stream!' },
  },
  channelReward: { redeemer: { username: 'TestViewer' }, reward: { title: 'Sample reward' } },
  channelRewardWithInput: {
    redeemer: { username: 'TestViewer' },
    reward: { title: 'Sample reward' },
    user_input: 'My message',
  },
  channelRewardApproved: {
    redeemer: { username: 'TestViewer' },
    reward: { title: 'Sample reward' },
    status: 'accepted',
  },
  channelRewardDeclined: {
    redeemer: { username: 'TestViewer' },
    reward: { title: 'Sample reward' },
    status: 'rejected',
  },
  streamStarted: { is_live: true },
  streamEnded: { is_live: false },
  host: { host: { username: 'HostChannel' }, viewers: 150 },
};

/** Build response functions for gift sub templates (lifetime subs depends on toggle) */
function getGiftSubResponseFn(lifetimeSubs: string) {
  return (p: unknown, t: KickMessageTemplates) =>
    getGiftSubResponse(p as never, t, { lifetimeSubs });
}

/** Response functions per template key (giftSub* all use getGiftSubResponse, etc.) */
function buildResponseFns(giftSubShowLifetimeSubs: boolean): Record<keyof KickMessageTemplates, (p: unknown, t: KickMessageTemplates) => string> {
  const lifetimeSubs = giftSubShowLifetimeSubs ? '(5 lifetime)' : '';
  return {
  follow: (p, t) => getFollowResponse(p as never, t),
  newSub: (p, t) => getNewSubResponse(p as never, t),
  resub: (p, t) => getResubResponse(p as never, t),
  giftSubSingle: getGiftSubResponseFn(lifetimeSubs),
  giftSubMulti: getGiftSubResponseFn(lifetimeSubs),
  giftSubGeneric: getGiftSubResponseFn(lifetimeSubs),
  kicksGifted: (p, t) => getKicksGiftedResponse(p as never, t),
  kicksGiftedWithMessage: (p, t) => getKicksGiftedResponse(p as never, t),
  channelReward: (p, t) => getChannelRewardResponse(p as never, t),
  channelRewardWithInput: (p, t) => getChannelRewardResponse(p as never, t),
  channelRewardApproved: (p, t) => getChannelRewardResponse(p as never, t),
  channelRewardDeclined: (p, t) => getChannelRewardResponse(p as never, t),
  streamStarted: (p, t) => getStreamStatusResponse(p as never, t),
  streamEnded: (p, t) => getStreamStatusResponse(p as never, t),
  host: (p, t) => getHostResponse(p as never, t),
  };
}

export async function POST(request: NextRequest) {
  const authToken = request.cookies.get('auth-token')?.value;
  if (authToken !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let content: string;
  let templateKey: keyof KickMessageTemplates | undefined;
  let templates: KickMessageTemplates | undefined;
  let giftSubShowLifetimeSubs = true;
  try {
    const body = await request.json();
    content = typeof body.content === 'string' ? body.content.trim() : '';
    templateKey = body.templateKey;
    templates = body.templates;
    if (body.alertSettings?.giftSubShowLifetimeSubs === false) giftSubShowLifetimeSubs = false;
  } catch {
    content = '';
  }

  // Template test: render with mock payload
  if (templateKey && templates) {
    const responseFns = buildResponseFns(giftSubShowLifetimeSubs);
    const fn = responseFns[templateKey];
    const payload = MOCK_PAYLOADS[templateKey];
    if (fn && payload) {
      content = fn(payload, templates);
    }
  }

  if (!content) {
    return NextResponse.json(
      { error: templateKey ? 'Invalid template key' : 'Message content required' },
      { status: 400 }
    );
  }

  const stored = await kv.get<StoredKickTokens>(KICK_TOKENS_KEY);
  if (!stored?.access_token || !stored.refresh_token) {
    return NextResponse.json({
      error: 'Not connected. Connect Kick first.',
    }, { status: 400 });
  }

  let accessToken = stored.access_token;
  const now = Date.now();
  if (stored.expires_at - 60 * 1000 < now) {
    try {
      const tokens = await refreshKickTokens(stored.refresh_token);
      accessToken = tokens.access_token;
      await kv.set(KICK_TOKENS_KEY, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: now + tokens.expires_in * 1000,
        scope: tokens.scope,
      });
    } catch {
      return NextResponse.json({ error: 'Token refresh failed' }, { status: 401 });
    }
  }

  try {
    await sendKickChatMessage(accessToken, content);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to send';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
