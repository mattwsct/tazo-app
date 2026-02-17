/**
 * Poll parsing and vote logic.
 */

import type { PollOption, PollState, QueuedPoll } from '@/types/poll';
import { containsBlockedContent } from '@/lib/poll-content-filter';

const YES_ALIASES = new Set(['yes', 'y']);
const NO_ALIASES = new Set(['no', 'n']);

/** Parse !poll <question?> [opt1], [opt2], ... — question before ?, options after (or yes/no) */
export function parsePollCommand(content: string): { question: string; options: PollOption[] } | null {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!poll ')) return null;
  const rest = trimmed.slice(6).trim();
  const qMark = rest.indexOf('?');
  const question = qMark >= 0 ? rest.slice(0, qMark + 1).trim() : rest;
  const after = qMark >= 0 ? rest.slice(qMark + 1).trim() : '';
  if (!question) return null;

  let options: PollOption[];
  if (!after || after.length === 0) {
    options = [
      { label: 'Yes', votes: 0, voters: {} },
      { label: 'No', votes: 0, voters: {} },
    ];
  } else {
    const parts = after.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    options = parts.map((label) => ({ label, votes: 0, voters: {} }));
  }
  return { question, options };
}

/** Returns true if poll question or any option contains blocked content. */
export function pollContainsBlockedContent(question: string, options: { label: string }[]): boolean {
  if (containsBlockedContent(question)) return true;
  for (const opt of options) {
    if (containsBlockedContent(opt.label)) return true;
  }
  return false;
}

/** Map chat message to poll option index. Returns -1 if not a valid vote. */
export function parseVote(
  content: string,
  options: PollOption[],
  username: string
): { optionIndex: number } | null {
  const raw = content.trim().toLowerCase();
  const clean = raw.startsWith('!') ? raw.slice(1).trim() : raw;
  if (!clean) return null;

  // Default yes/no
  if (options.length === 2) {
    const l0 = options[0].label.toLowerCase();
    const l1 = options[1].label.toLowerCase();
    const isYesNo =
      (l0 === 'yes' && l1 === 'no') ||
      (l0 === 'no' && l1 === 'yes');
    if (isYesNo) {
      const yesIdx = l0 === 'yes' ? 0 : 1;
      const noIdx = 1 - yesIdx;
      if (YES_ALIASES.has(clean)) return { optionIndex: yesIdx };
      if (NO_ALIASES.has(clean)) return { optionIndex: noIdx };
    }
  }

  // Exact match (case-insensitive) to option label
  for (let i = 0; i < options.length; i++) {
    if (options[i].label.toLowerCase() === clean) return { optionIndex: i };
  }
  return null;
}

/** Check if sender can start poll based on role toggles. */
export function canStartPoll(
  senderUsername: string,
  broadcasterUsername: string | null,
  settings: { everyoneCanStart?: boolean; modsCanStart?: boolean; vipsCanStart?: boolean; ogsCanStart?: boolean; subsCanStart?: boolean },
  roles: { isMod?: boolean; isVip?: boolean; isOg?: boolean; isSub?: boolean }
): boolean {
  const senderLower = senderUsername.toLowerCase();
  const broadcasterLower = broadcasterUsername?.toLowerCase() ?? '';

  if (senderLower === broadcasterLower) return true;
  if (settings.everyoneCanStart) return true;
  if (roles.isMod && settings.modsCanStart) return true;
  if (roles.isVip && settings.vipsCanStart) return true;
  if (roles.isOg && settings.ogsCanStart) return true;
  if (roles.isSub && settings.subsCanStart) return true;
  return false;
}

/** Build winner message and top voter. */
export function computePollResult(state: PollState): { winnerMessage: string; topVoter?: { username: string; count: number } } {
  if (state.options.length === 0) return { winnerMessage: '' };

  let maxVotes = 0;
  const winners: string[] = [];
  const voterTotals: Record<string, number> = {};

  for (const opt of state.options) {
    if (opt.votes > maxVotes) {
      maxVotes = opt.votes;
      winners.length = 0;
      winners.push(opt.label);
    } else if (opt.votes === maxVotes && maxVotes > 0) {
      winners.push(opt.label);
    }
    if (opt.voters) {
      for (const [u, c] of Object.entries(opt.voters)) {
        voterTotals[u] = (voterTotals[u] ?? 0) + c;
      }
    }
  }

  const winnerLabel = winners.length === 1 ? winners[0] : winners.join(' and ');
  const countStr = maxVotes === 1 ? '1 vote' : `${maxVotes} votes`;
  let winnerMessage =
    winners.length === 0
      ? `Poll "${state.question}" ended with no votes.`
      : `Poll "${state.question}" — ${winnerLabel} wins! (${countStr})`;

  let topVoter: { username: string; count: number } | undefined;
  let topCount = 0;
  for (const [u, c] of Object.entries(voterTotals)) {
    if (c > topCount) {
      topCount = c;
      topVoter = { username: u, count: c };
    }
  }
  if (topVoter && topVoter.count > 1) {
    winnerMessage += ` Top voter: ${topVoter.username} (${topVoter.count} votes).`;
  }
  return { winnerMessage, topVoter: topVoter && topVoter.count > 1 ? topVoter : undefined };
}

/** Compact overlay winner text (no question repetition). */
export function getOverlayWinnerText(state: PollState): string {
  if (state.options.length === 0) return 'No votes';
  let maxVotes = 0;
  const winners: string[] = [];
  for (const opt of state.options) {
    if (opt.votes > maxVotes) {
      maxVotes = opt.votes;
      winners.length = 0;
      winners.push(opt.label);
    } else if (opt.votes === maxVotes && maxVotes > 0) {
      winners.push(opt.label);
    }
  }
  if (maxVotes === 0) return 'No votes';
  const winner = winners.length === 1 ? winners[0] : winners.join(' & ');
  const n = maxVotes === 1 ? '1' : String(maxVotes);
  return `${winner} wins (${n})`;
}
