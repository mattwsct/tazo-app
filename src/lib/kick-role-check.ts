/**
 * Shared role-check utility for Kick chat command handlers.
 * Accepts the raw `sender` object from a Kick webhook payload and returns
 * true if the sender is the broadcaster or a moderator.
 *
 * Checks all known Kick API shapes:
 *  - identity.role / top-level role string
 *  - roles array
 *  - boolean flags (is_moderator, moderator, isModerator)
 *  - username match against the stored broadcaster slug (fallback)
 */
export function isModOrBroadcaster(
  sender: unknown,
  senderUsername: string,
  broadcasterSlug: string | null
): boolean {
  if (!sender || typeof sender !== 'object') return false;
  const s = sender as Record<string, unknown>;
  const identity = s.identity as Record<string, unknown> | undefined;
  const role = String(identity?.role ?? s.role ?? '').toLowerCase();
  const rolesArr = s.roles as string[] | undefined;
  const rolesLower = Array.isArray(rolesArr) ? rolesArr.map((r) => String(r).toLowerCase()) : [];
  if (role === 'moderator' || role === 'owner' || role === 'broadcaster') return true;
  if (rolesLower.includes('moderator') || rolesLower.includes('owner') || rolesLower.includes('broadcaster')) return true;
  if (s.is_moderator === true || s.moderator === true || s.isModerator === true) return true;
  const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
  if (senderUsername?.toLowerCase() === broadcasterLower) return true;
  return false;
}
