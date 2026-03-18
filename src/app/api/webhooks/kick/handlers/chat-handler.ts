import { kv } from '@/lib/kv';
import { sendKickChatMessage, getValidAccessToken } from '@/lib/kick-api';
import { parseKickChatMessage, handleKickChatCommand } from '@/lib/kick-chat-commands';
import { handleChatPoll } from '@/lib/poll-webhook-handler';
import { handleTrivia } from '@/lib/trivia-webhook-handler';
import { handleStreamTitleCommand } from '@/lib/stream-title-chat-handler';
import { handleGoalCommand } from '@/lib/goal-chat-handler';
import { handleChallengesCommand } from '@/lib/challenges-chat-handler';
import { handleAddCreditsCommand } from '@/lib/addcredits-chat-handler';
import { handleCategoryCommand } from '@/lib/category-chat-handler';
import { handleExtendedChatCommand } from '@/lib/extended-chat-handler';
import { getLeaderboardExclusions } from '@/utils/leaderboard-storage';
import { KICK_BROADCASTER_SLUG_KEY } from '@/lib/kick-api';
import { KICK_LAST_CHAT_MESSAGE_AT_KEY } from '@/types/poll';

export async function handleChatMessage(payload: Record<string, unknown>): Promise<boolean> {
  const content = (payload.content as string) || '';
  const sender = (payload.sender as { username?: string })?.username ?? '?';

  try {
    await kv.set(KICK_LAST_CHAT_MESSAGE_AT_KEY, Date.now());
  } catch { /* ignore */ }

  // Track human chat activity for offline gate
  void (async () => {
    try {
      const senderNorm = sender.trim().toLowerCase();
      if (!senderNorm.startsWith('@')) {
        const [broadcasterSlug, excluded] = await Promise.all([
          kv.get<string>(KICK_BROADCASTER_SLUG_KEY),
          getLeaderboardExclusions(),
        ]);
        const isBroadcaster = broadcasterSlug && senderNorm === broadcasterSlug.trim().toLowerCase();
        if (!isBroadcaster && !excluded.has(senderNorm)) {
          await kv.set('offline_human_chat_at', String(Date.now()));
        }
      }
    } catch { /* ignore */ }
  })();

  const triviaResult = await handleTrivia(content, sender, payload);
  if (triviaResult.handled) return true;

  const pollResult = await handleChatPoll(content, sender, payload);
  if (pollResult.handled) return true;

  const sendReply = async (reply: string) => {
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      try {
        await sendKickChatMessage(accessToken, reply, messageId ? { replyToMessageId: messageId } : undefined);
      } catch { /* silent */ }
    }
  };

  const titleResult = await handleStreamTitleCommand(content, sender, payload);
  if (titleResult.handled) {
    if (titleResult.reply) await sendReply(titleResult.reply);
    return true;
  }

  const categoryResult = await handleCategoryCommand(content, sender, payload);
  if (categoryResult.handled) {
    if (categoryResult.reply) await sendReply(categoryResult.reply);
    return true;
  }

  const addcreditsResult = await handleAddCreditsCommand(content, sender, payload);
  if (addcreditsResult.handled) {
    if (addcreditsResult.reply) await sendReply(addcreditsResult.reply);
    return true;
  }

  const goalResult = await handleGoalCommand(content, sender, payload);
  if (goalResult.handled) {
    if (goalResult.reply) await sendReply(goalResult.reply);
    return true;
  }

  const challengesResult = await handleChallengesCommand(content, sender, payload);
  if (challengesResult.handled) {
    if (challengesResult.reply) await sendReply(challengesResult.reply);
    return true;
  }

  const extendedResult = await handleExtendedChatCommand(content);
  if (extendedResult.handled) {
    if (extendedResult.reply) await sendReply(extendedResult.reply);
    return true;
  }

  const parsed = parseKickChatMessage(content);
  if (parsed) {
    const response = await handleKickChatCommand(parsed, sender);
    if (response) {
      const accessToken = await getValidAccessToken();
      if (accessToken) {
        const messageId = (payload.id ?? payload.message_id) as string | undefined;
        try {
          await sendKickChatMessage(accessToken, response, messageId ? { replyToMessageId: messageId } : undefined);
        } catch (err) {
          console.error('[Kick webhook] Chat command failed:', err instanceof Error ? err.message : String(err));
        }
      }
    }
    return true;
  }

  // Non-command messages: bare-word blackjack actions
  const replyNonCmd = async (msg: string) => {
    const accessToken = await getValidAccessToken();
    if (accessToken) {
      const messageId = (payload.id ?? payload.message_id) as string | undefined;
      try {
        await sendKickChatMessage(accessToken, msg, messageId ? { replyToMessageId: messageId } : undefined);
      } catch { /* silent */ }
    }
  };

  const bareWord = content.trim().toLowerCase();
  const bareBlackjackCmds: Record<string, 'hit' | 'stand' | 'double' | 'split'> = { hit: 'hit', stand: 'stand', double: 'double', split: 'split' };
  const bjCmd = bareBlackjackCmds[bareWord];
  if (bjCmd) {
    const bjResponse = await handleKickChatCommand({ cmd: bjCmd }, sender);
    if (bjResponse) { await replyNonCmd(bjResponse); return true; }
  }

  return true;
}
