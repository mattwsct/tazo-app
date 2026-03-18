/**
 * Extended chat command handler — commands previously only available via Fossabot HTTP routes.
 *
 * Social links:    !instagram (!ig), !tiktok, !youtube (!yt), !twitter (!x), !discord,
 *                  !kick (profile), !twitch, !rumble, !parti, !dlive, !onlyfans (!of),
 *                  !shoutout / !so <username>
 * Location/time:   !location, !time
 * Weather:         !weather, !sun, !temp / !temperature, !moon
 * Games:           !coin / !flip, !dice / !roll, !8ball / !magic8ball, !random
 * Size ranking:    !inch, !cm
 * Travel/culture:  !food, !phrase, !emergency, !flirt, !insults / !insult,
 *                  !countries, !fact / !facts, !currency
 */

import { LINKS } from '@/data/links';
import { getLocationData, getPersistentLocation } from '@/utils/location-cache';
import { kv } from '@/lib/kv';
import { DEFAULT_OVERLAY_SETTINGS } from '@/types/settings';
import type { OverlaySettings } from '@/types/settings';
import { resolveLocationForChat } from '@/lib/chat-response-helpers';
import {
  getWeatherEmoji,
  isNightTime,
  formatTemperature,
  getNotableConditions,
} from '@/utils/weather-chat';
import { getTravelData, getAvailableCountries } from '@/utils/travel-data';
import { pickN, getCountryNameFromCode } from '@/utils/chat-utils';
import { handleSizeRanking, getSizeRouteConfig } from '@/utils/size-ranking';

export interface ExtendedChatResult {
  handled: boolean;
  reply?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function socialUrl(id: string): string | null {
  return LINKS.find((l) => l.id === id)?.url ?? null;
}

function moonPhase(): string {
  const now = new Date();
  const d = (now.getFullYear() * 365.25 + (now.getMonth() + 1) * 30.44 + now.getDate()) % 29.53;
  const illumination = Math.round(Math.abs(Math.cos((d / 29.53) * 2 * Math.PI)) * 100);
  let name: string, emoji: string;
  if (d < 1.84)       { name = 'New Moon';        emoji = '🌑'; }
  else if (d < 5.53)  { name = 'Waxing Crescent'; emoji = '🌒'; }
  else if (d < 9.22)  { name = 'First Quarter';   emoji = '🌓'; }
  else if (d < 12.91) { name = 'Waxing Gibbous';  emoji = '🌔'; }
  else if (d < 16.61) { name = 'Full Moon';        emoji = '🌕'; }
  else if (d < 20.30) { name = 'Waning Gibbous';  emoji = '🌖'; }
  else if (d < 23.99) { name = 'Last Quarter';     emoji = '🌗'; }
  else                 { name = 'Waning Crescent'; emoji = '🌘'; }
  return `${emoji} Moon: ${name} (${illumination}% illuminated)`;
}

function travelContext(arg: string, persistentLoc: Awaited<ReturnType<typeof getPersistentLocation>>) {
  const q = arg.trim().toUpperCase();
  const requested = q.length === 2 ? q : null;
  const available = getAvailableCountries();

  if (requested && !available.some((c) => c.code === requested)) {
    return { error: `Invalid country code: ${requested}. Use !countries to see available countries.` };
  }
  const countryCode = requested ?? persistentLoc?.location?.countryCode ?? null;
  const countryName = requested
    ? getCountryNameFromCode(requested)
    : (persistentLoc?.location?.country ?? (countryCode ? getCountryNameFromCode(countryCode) : null));
  const data = getTravelData(countryCode);
  const prefix = requested && data.isCountrySpecific && countryName ? `[${countryName}] ` : '';
  return { countryCode, countryName, data, prefix, requested };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function handleExtendedChatCommand(
  content: string,
): Promise<ExtendedChatResult> {
  const trimmed = content.trim();
  if (!trimmed.startsWith('!')) return { handled: false };

  const rest = trimmed.slice(1).trim();
  const spaceIdx = rest.indexOf(' ');
  const cmd = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

  // ── Social links ───────────────────────────────────────────────────────────

  const SOCIAL_MAP: Record<string, { id: string; name: string }> = {
    instagram: { id: 'instagram', name: 'Instagram' },
    ig:        { id: 'instagram', name: 'Instagram' },
    tiktok:    { id: 'tiktok',    name: 'TikTok' },
    youtube:   { id: 'youtube',   name: 'YouTube' },
    yt:        { id: 'youtube',   name: 'YouTube' },
    twitter:   { id: 'twitter',   name: 'Twitter/X' },
    x:         { id: 'twitter',   name: 'Twitter/X' },
    discord:   { id: 'discord',   name: 'Discord' },
    rumble:    { id: 'rumble',    name: 'Rumble' },
    twitch:    { id: 'twitch',    name: 'Twitch' },
    parti:     { id: 'parti',     name: 'Parti' },
    dlive:     { id: 'dlive',     name: 'DLive' },
    onlyfans:  { id: 'onlyfans',  name: 'OnlyFans' },
    of:        { id: 'onlyfans',  name: 'OnlyFans' },
  };

  if (cmd in SOCIAL_MAP) {
    const { id, name } = SOCIAL_MAP[cmd];
    const url = socialUrl(id);
    return { handled: true, reply: url ? `${name} → ${url}` : `${name} link unavailable` };
  }

  if (cmd === 'kick' && !arg) {
    const url = socialUrl('kick');
    return { handled: true, reply: url ? `Kick → ${url}` : 'Kick link unavailable' };
  }

  if (cmd === 'shoutout' || cmd === 'so') {
    if (!arg) return { handled: true, reply: 'Usage: !so <username>' };
    return { handled: true, reply: `Check out ${arg} → https://kick.com/${arg}` };
  }

  // ── Location & time ────────────────────────────────────────────────────────

  if (cmd === 'location') {
    const settings = (await kv.get<OverlaySettings>('overlay_settings')) ?? DEFAULT_OVERLAY_SETTINGS;
    const [persistentLocation, locationData] = await Promise.all([getPersistentLocation(), getLocationData()]);
    const lat = persistentLocation?.rtirl?.lat ?? locationData?.rtirl?.lat ?? null;
    const lon = persistentLocation?.rtirl?.lon ?? locationData?.rtirl?.lon ?? null;
    const resolved = await resolveLocationForChat(settings.locationDisplay, persistentLocation, lat, lon);
    switch (resolved.type) {
      case 'hidden':    return { handled: true, reply: 'Location is hidden' };
      case 'country':   return { handled: true, reply: `📍 ${resolved.name}` };
      case 'formatted': return { handled: true, reply: `📍 ${resolved.text}` };
      case 'coords':    return { handled: true, reply: 'Location unavailable' };
    }
  }

  if (cmd === 'time') {
    const [locationData, persistentLocation] = await Promise.all([getLocationData(), getPersistentLocation()]);
    const timezone = locationData?.timezone ?? persistentLocation?.location?.timezone ?? null;
    if (!timezone) return { handled: true, reply: '⏰ Time unavailable — no timezone data' };
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone });
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone });
    return { handled: true, reply: `⏰ ${timeStr} on ${dateStr} (${timezone})` };
  }

  // ── Weather ────────────────────────────────────────────────────────────────

  if (cmd === 'weather') {
    const data = await getLocationData();
    if (!data?.weather) return { handled: true, reply: '🌤️ Weather data unavailable' };
    const { condition, desc, tempC, feelsLikeC, windKmh, humidity, visibility } = data.weather;
    const emoji = getWeatherEmoji(condition, isNightTime());
    const parts = [`${emoji} ${formatTemperature(tempC)} ${desc}`];
    if (Math.abs(feelsLikeC - tempC) > 1) parts.push(`feels like ${formatTemperature(feelsLikeC)}`);
    const notable = getNotableConditions({ tempC, feelsLikeC, windKmh, humidity, visibility });
    if (notable.length) parts.push(notable.join(', '));
    return { handled: true, reply: parts.join(' · ') };
  }

  if (cmd === 'sun') {
    const data = await getLocationData();
    if (!data?.timezone || !data?.sunriseSunset) return { handled: true, reply: '🌅 Sunrise/sunset unavailable' };
    const { sunrise, sunset } = data.sunriseSunset;
    const tz = data.timezone;
    const timeOpts: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz };
    const sunriseStr = new Date(sunrise * 1000).toLocaleTimeString('en-US', timeOpts);
    const sunsetStr  = new Date(sunset  * 1000).toLocaleTimeString('en-US', timeOpts);
    const now = Date.now();
    const DAY = 86400000;
    const msToRise = sunrise * 1000 - now;
    const msToSet  = sunset  * 1000 - now;
    const nextRise = msToRise >= 0 ? msToRise : msToRise + DAY;
    const nextSet  = msToSet  >= 0 ? msToSet  : msToSet  + DAY;
    const fmt = (ms: number, tomorrow: boolean) => {
      const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
      return tomorrow ? `in ${h}h ${String(m).padStart(2, '0')}m tomorrow` : `in ${h}h ${String(m).padStart(2, '0')}m`;
    };
    const parts = nextRise <= nextSet
      ? [`🌅 Sunrise ${sunriseStr} (${fmt(nextRise, msToRise < 0)})`, `🌇 Sunset ${sunsetStr} (${fmt(nextSet, msToSet < 0)})`]
      : [`🌇 Sunset ${sunsetStr} (${fmt(nextSet, msToSet < 0)})`, `🌅 Sunrise ${sunriseStr} (${fmt(nextRise, msToRise < 0)})`];
    return { handled: true, reply: parts.join(' · ') };
  }

  if (cmd === 'temp' || cmd === 'temperature') {
    if (!arg) return { handled: true, reply: 'Usage: !temp <value> [c/f]  e.g. !temp 25c  !temp 77f' };
    const match = arg.match(/^([+-]?\d+\.?\d*)\s*([cf]|celsius|fahrenheit)?$/i);
    if (!match) return { handled: true, reply: 'Usage: !temp <value> [c/f]  e.g. !temp 25c  !temp 77f' };
    const val = parseFloat(match[1]);
    const unit = (match[2] ?? 'c').toLowerCase().startsWith('f') ? 'f' : 'c';
    const result = unit === 'f'
      ? `${val}°F = ${((val - 32) * 5 / 9).toFixed(1)}°C`
      : `${val}°C = ${(val * 9 / 5 + 32).toFixed(1)}°F`;
    return { handled: true, reply: `🌡️ ${result}` };
  }

  if (cmd === 'moon') {
    return { handled: true, reply: moonPhase() };
  }

  // ── Games ──────────────────────────────────────────────────────────────────

  if (cmd === 'coin' || cmd === 'flip') {
    return { handled: true, reply: `🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}` };
  }

  if (cmd === 'dice' || cmd === 'roll') {
    const parts = arg.split(/\s+/).filter(Boolean);
    let sides = 6, count = 1;
    if (parts[0]) {
      const n = parseInt(parts[0]);
      if (!isNaN(n) && n > 0) {
        if (n <= 100) { sides = n; if (parts[1]) { const c = parseInt(parts[1]); if (!isNaN(c) && c > 0 && c <= 10) count = c; } }
        else count = Math.min(n, 10);
      }
    }
    const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1);
    const reply = count === 1
      ? `🎲 Rolled ${rolls[0]} (d${sides})`
      : `🎲 Rolled ${rolls.join(', ')} = ${rolls.reduce((a, b) => a + b, 0)} (${count}d${sides})`;
    return { handled: true, reply };
  }

  if (cmd === '8ball' || cmd === 'magic8ball') {
    const answers = [
      'It is certain', 'Without a doubt', 'Yes definitely', 'You may rely on it', 'As I see it, yes',
      'Most likely', 'Outlook good', 'Yes', 'Signs point to yes', 'Reply hazy, try again',
      'Ask again later', 'Better not tell you now', 'Cannot predict now', 'Concentrate and ask again',
      "Don't count on it", 'My reply is no', 'My sources say no', 'Outlook not so good', 'Very doubtful', 'No',
    ];
    return { handled: true, reply: `🎱 ${answers[Math.floor(Math.random() * answers.length)]}` };
  }

  if (cmd === 'random') {
    const parts = arg.split(/\s+/).filter(Boolean);
    const [min, max] = parts.length === 0 ? [1, 100] : parts.length === 1 ? [1, parseInt(parts[0])] : [parseInt(parts[0]), parseInt(parts[1])];
    if (isNaN(min) || isNaN(max) || min > max || min < 0 || max > 1_000_000)
      return { handled: true, reply: 'Usage: !random [min max]  e.g. !random  !random 100  !random 1 100' };
    return { handled: true, reply: `🎲 ${Math.floor(Math.random() * (max - min + 1)) + min} (${min}–${max})` };
  }

  // ── Size ranking ───────────────────────────────────────────────────────────

  if (cmd === 'inch' || cmd === 'cm') {
    const config = getSizeRouteConfig(cmd);
    if (!arg) return { handled: true, reply: `Usage: !${cmd} <length> [girth]  e.g. !${cmd} ${cmd === 'inch' ? '6 5' : '15 12'}` };
    const parts = arg.split(/\s+/).filter(Boolean);
    const length = parseFloat(parts[0]);
    const girth = parts[1] ? parseFloat(parts[1]) : null;
    if (isNaN(length) || length <= 0) return { handled: true, reply: `Usage: !${cmd} <length> [girth]` };
    const result = handleSizeRanking(length, girth, config!.unit, config!.type);
    return { handled: true, reply: result ?? 'Invalid input' };
  }

  // ── Travel & culture ───────────────────────────────────────────────────────

  if (cmd === 'countries') {
    const list = getAvailableCountries().map((c) => `${c.code} (${c.name})`).join(', ');
    return { handled: true, reply: `Available countries: ${list}` };
  }

  if (cmd === 'food' || cmd === 'phrase' || cmd === 'emergency' || cmd === 'flirt' || cmd === 'insults' || cmd === 'insult' || cmd === 'currency' || cmd === 'fact' || cmd === 'facts') {
    const persistentLocation = await getPersistentLocation();
    const ctx = travelContext(arg, persistentLocation);
    if ('error' in ctx) return { handled: true, reply: ctx.error };
    const { data, prefix, countryName, countryCode } = ctx;

    if (cmd === 'food') {
      const items = pickN(data.foods, 3);
      if (!items.length) return { handled: true, reply: countryName ? `No food data for ${countryName} yet. Use !countries.` : 'No food data. Try !food JP' };
      return { handled: true, reply: prefix + items.join(' · ') };
    }

    if (cmd === 'phrase') {
      const items = pickN(data.phrases, 3);
      if (!items.length) return { handled: true, reply: countryName ? `No phrase data for ${countryName} yet.` : 'No phrase data. Try !phrase JP' };
      const lang = items[0].lang;
      const formatted = items.map((p, i) => {
        const s = p.roman ? `"${p.text}" (${p.roman}) = ${p.meaning}` : `"${p.text}" = ${p.meaning}`;
        return i === 0 ? `${lang} → ${s}` : s;
      });
      return { handled: true, reply: prefix + formatted.join(' · ') };
    }

    if (cmd === 'flirt') {
      const items = pickN(data.flirt ?? [], 3);
      if (!items.length) return { handled: true, reply: countryName ? `No flirt data for ${countryName} yet.` : 'No flirt data. Try !flirt JP' };
      return { handled: true, reply: prefix + items.join(' · ') };
    }

    if (cmd === 'insults' || cmd === 'insult') {
      const items = pickN(data.insults ?? [], 3);
      if (!items.length) return { handled: true, reply: countryName ? `No insult data for ${countryName} yet.` : 'No insult data. Try !insults JP' };
      return { handled: true, reply: prefix + items.join(' · ') };
    }

    if (cmd === 'emergency') {
      const e = data.emergencyInfo;
      if (!e) return { handled: true, reply: countryName ? `No emergency data for ${countryName} yet.` : 'No emergency data. Try !emergency AU' };
      const parts: string[] = [];
      if (prefix) parts.push(prefix.replace(' ', ''));
      const phones: string[] = [];
      if (e.police) phones.push(`Police: ${e.police}`);
      if (e.ambulance) phones.push(`Ambulance: ${e.ambulance}`);
      if (e.fire && e.fire !== e.ambulance) phones.push(`Fire: ${e.fire}`);
      if (!phones.length && e.phone) phones.push(e.phone);
      if (phones.length) parts.push(phones.join(' | '));
      if (e.australianEmbassy && countryCode !== 'AU') parts.push(`AU Embassy: ${e.australianEmbassy}`);
      return { handled: true, reply: parts.join(' | ') || 'Emergency data unavailable' };
    }

    if (cmd === 'currency') {
      if (!data.currency) return { handled: true, reply: countryName ? `No currency data for ${countryName} yet.` : 'No currency data. Try !currency JP' };
      const { name, symbol, code } = data.currency;
      return { handled: true, reply: `${prefix}${name} (${code}) ${symbol}` };
    }

    if (cmd === 'fact' || cmd === 'facts') {
      // If no country from arg or location, pick a random one with facts
      let targetData = data;
      let targetPrefix = prefix;
      if (!ctx.countryCode && !ctx.requested) {
        const available = getAvailableCountries().filter((c) => {
          const d = getTravelData(c.code);
          return d.facts && d.facts.length > 0;
        });
        if (!available.length) return { handled: true, reply: 'No facts available.' };
        const pick = available[Math.floor(Math.random() * available.length)];
        targetData = getTravelData(pick.code);
        targetPrefix = `[${pick.name}] `;
      }
      const facts = targetData.facts ?? [];
      if (!facts.length) return { handled: true, reply: countryName ? `No facts for ${countryName} yet.` : 'No facts available.' };
      return { handled: true, reply: targetPrefix + pickN(facts, 1)[0] };
    }
  }

  return { handled: false };
}
