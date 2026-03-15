/**
 * Discord Bot API — role management for Kick subscriber sync.
 *
 * Requirements (set in Vercel env vars):
 *   DISCORD_BOT_TOKEN       — Bot token from discord.com/developers
 *   DISCORD_GUILD_ID        — Your Discord server ID (right-click server → Copy Server ID)
 *   DISCORD_SUBSCRIBER_ROLE_ID — Role ID to assign to Kick subscribers (right-click role → Copy Role ID)
 *
 * The bot must be in the server with the "Manage Roles" permission,
 * and its highest role must be above the subscriber role in the hierarchy.
 */

const BASE = 'https://discord.com/api/v10';

function getConfig(): { token: string; guildId: string; roleId: string } | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = process.env.DISCORD_SUBSCRIBER_ROLE_ID;
  if (!token || !guildId || !roleId) return null;
  return { token, guildId, roleId };
}

export function isDiscordRoleSyncConfigured(): boolean {
  return getConfig() !== null;
}

/** Assign the subscriber role to a Discord user. Silently no-ops if not configured. */
export async function assignSubscriberRole(discordUserId: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  const url = `${BASE}/guilds/${cfg.guildId}/members/${discordUserId}/roles/${cfg.roleId}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bot ${cfg.token}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    console.error(`[discord-roles] assign failed (${res.status}):`, body);
  }
}

/** Remove the subscriber role from a Discord user. Silently no-ops if not configured. */
export async function removeSubscriberRole(discordUserId: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;
  const url = `${BASE}/guilds/${cfg.guildId}/members/${discordUserId}/roles/${cfg.roleId}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${cfg.token}` },
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => '');
    console.error(`[discord-roles] remove failed (${res.status}):`, body);
  }
}
