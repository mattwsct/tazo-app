/**
 * Shared role-check utility for Kick chat command handlers.
 * Accepts the raw `sender` object from a Kick webhook payload and returns
 * true if the sender is the broadcaster or a moderator.
 *
 * Checks all known Kick API shapes:
 *  - identity.role / top-level role string
 *  - roles array
 *  - badges array (Kick often sends mod/owner/broadcaster here in chat.message.sent)
 *  - boolean flags (is_moderator, moderator, isModerator)
 *  - username match against the stored broadcaster slug (fallback)
 */
function hasModOrBroadcasterBadge(badges: unknown): boolean {
  if (!badges || !Array.isArray(badges)) return false;
  for (const b of badges) {
    const v = typeof b === 'string' ? b.toLowerCase() : (b as Record<string, unknown>)?.type ?? (b as Record<string, unknown>)?.slug ?? (b as Record<string, unknown>)?.name ?? (b as Record<string, unknown>)?.text;
    const str = String(v ?? '').toLowerCase();
    if (str.includes('mod') || str === 'owner' || str === 'broadcaster') return true;
  }
  return false;
}

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
  const badges = s.badges ?? (identity?.badges as unknown);
  if (hasModOrBroadcasterBadge(badges)) return true;
  const broadcasterLower = broadcasterSlug?.toLowerCase() ?? '';
  if (senderUsername?.toLowerCase() === broadcasterLower) return true;
  return false;
}
