/**
 * Poll parsing and vote logic.
 */

import type { PollOption, PollState } from '@/types/poll';
import { containsBlockedContent } from '@/lib/poll-content-filter';

const YES_ALIASES = new Set(['yes', 'y']);
const NO_ALIASES = new Set(['no', 'n']);

/** Normalize string for vote matching: lowercase + strip accents (café → cafe) so US/UK keyboards work. */
function normalizeForVote(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** Single-word options to filter out — conjunctions etc. that slip in from "Yes or no" or "Pizza and burgers". */
const BANNED_OPTION_WORDS = new Set([
  'and', 'or', 'if', 'but', 'the', 'a', 'an', 'to', 'for', 'of', 'in', 'on', 'at',
]);

/** Allowed duration variants: !poll15, !poll30, !poll60, !poll120 */
export const POLL_DURATION_VARIANTS = [15, 30, 60, 120] as const;

/** Match !poll15, !poll30, !poll60, !poll120 — returns { duration, rest } or null. */
export function parsePollDurationVariant(content: string): { duration: number; rest: string } | null {
  const match = content.trim().match(/^!poll(15|30|60|120)(\s|$)/i);
  if (!match) return null;
  const duration = parseInt(match[1]!, 10);
  const rest = content.trim().slice(match[0]!.length).trim();
  return { duration, rest };
}

/** Parse !poll <question?> [opts] — question before ?, options after. Comma-separated or space-separated. Defaults to Yes/No if no options given. */
export function parsePollCommand(content: string): { question: string; options: PollOption[] } | null {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!poll ')) return null;
  const rest = trimmed.slice(6).trim();
  const qMark = rest.indexOf('?');
  const rawQuestion = qMark >= 0 ? rest.slice(0, qMark + 1).trim() : rest;
  if (!rawQuestion) return null;
  const question = rawQuestion.endsWith('?') ? rawQuestion : rawQuestion.trimEnd() + '?';
  const after = qMark >= 0 ? rest.slice(qMark + 1).trim() : '';

  let options: PollOption[];
  if (!after || after.length === 0) {
    options = [
      { label: 'Yes', votes: 0, voters: {} },
      { label: 'No', votes: 0, voters: {} },
    ];
  } else {
    const parts = after.includes(',')
      ? after.split(',').map((p) => p.trim()).filter(Boolean)
      : after.split(/\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;
    const filtered = parts.filter((p) => !BANNED_OPTION_WORDS.has(p.toLowerCase()));
    if (filtered.length < 2) return null;
    options = filtered.map((label) => ({ label, votes: 0, voters: {} }));
  }
  return { question, options };
}

/** Parse !rank opt1, opt2, opt3 — comma-separated or (when no commas) space-separated single-word options. */
export function parseRankCommand(content: string): { question: string; options: PollOption[] } | null {
  const trimmed = content.trim();
  if (!trimmed.toLowerCase().startsWith('!rank ')) return null;
  const rest = trimmed.slice(6).trim();
  if (!rest) return null;

  const parts = rest.includes(',')
    ? rest.split(',').map((p) => p.trim()).filter(Boolean)
    : rest.split(/\s+/).map((p) => p.trim()).filter(Boolean);
  const filtered = parts
    .filter((p) => !BANNED_OPTION_WORDS.has(p.toLowerCase()))
    .filter((p) => !containsBlockedContent(p));
  if (filtered.length < 2) return null;

  const question = 'Cast your vote!';
  const options = filtered.map((label) => ({ label, votes: 0, voters: {} }));
  return { question, options };
}

/** Max lengths for poll content (chars). */
export const POLL_QUESTION_MAX_LENGTH = 200;
export const POLL_OPTION_MAX_LENGTH = 50;

/** Returns true if question or any option exceeds max length. */
export function pollExceedsLength(question: string, options: { label: string }[]): boolean {
  if (question.length > POLL_QUESTION_MAX_LENGTH) return true;
  for (const opt of options) {
    if (opt.label.length > POLL_OPTION_MAX_LENGTH) return true;
  }
  return false;
}

/** Control chars, zero-width, RTL override — often used to break display or bypass filters. */
const INVALID_CHAR_REGEX = /[\x00-\x1f\x7f\u200b-\u200d\ufeff\u202e\u202d]/;

/** Returns true if question or any option contains invalid/exploit chars. */
export function pollContainsInvalidChars(question: string, options: { label: string }[]): boolean {
  if (INVALID_CHAR_REGEX.test(question)) return true;
  for (const opt of options) {
    if (INVALID_CHAR_REGEX.test(opt.label)) return true;
  }
  return false;
}

/** Returns true if options contain duplicate labels (case-insensitive). */
export function hasDuplicateOptions(options: { label: string }[]): boolean {
  const seen = new Set<string>();
  for (const opt of options) {
    const key = opt.label.toLowerCase().trim();
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
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
  options: PollOption[]
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

  // Match option label (case-insensitive, accents normalized: café matches "cafe")
  const userNorm = normalizeForVote(clean);
  for (let i = 0; i < options.length; i++) {
    if (normalizeForVote(options[i].label) === userNorm) return { optionIndex: i };
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

/** Find top voter across winning options (only meaningful when count > 1, e.g. not one-vote-per-person). */
function findTopVoter(
  state: PollState,
  winnerLabels: Set<string>
): { username: string; count: number } | undefined {
  let top: { username: string; count: number } | undefined;
  for (const opt of state.options) {
    if (!winnerLabels.has(opt.label) || !opt.voters) continue;
    for (const [username, count] of Object.entries(opt.voters)) {
      if (count > 0 && (!top || count > top.count)) {
        top = { username, count };
      }
    }
  }
  return top && top.count > 1 ? top : undefined;
}

/** Build winner message for chat. */
export function computePollResult(state: PollState): { winnerMessage: string; topVoter?: { username: string; count: number } } {
  if (state.options.length === 0) return { winnerMessage: '' };

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

  const winnerLabels = new Set(winners);
  const topVoter = findTopVoter(state, winnerLabels);
  const countStr = maxVotes === 1 ? '1 vote' : `${maxVotes} votes`;
  const winnerLabel = winners.length === 1 ? winners[0] : winners.join(' and ');
  let winnerMessage: string;
  if (winners.length === 0) {
    winnerMessage = `Poll "${state.question}" ended with no votes.`;
  } else {
    winnerMessage = `Poll "${state.question}" — ${winnerLabel} wins! (${countStr})`;
    if (topVoter) {
      const voterStr = topVoter.count === 1 ? '1 vote' : `${topVoter.count} votes`;
      winnerMessage += ` Top voter: ${topVoter.username} (${voterStr}).`;
    }
  }

  return { winnerMessage, topVoter };
}

/** Compact overlay winner text with vote count. */
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
  const countStr = maxVotes === 1 ? '1 vote' : `${maxVotes} votes`;
  return `${winner} wins (${countStr})`;
}
