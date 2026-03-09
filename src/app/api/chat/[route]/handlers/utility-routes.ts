import { NextResponse } from 'next/server';
import { txtResponse } from './shared';

function calculateMoonPhase(): { name: string; emoji: string; illumination: number } {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  // Simplified moon phase calculation (approximate)
  const daysSinceNewMoon = (year * 365.25 + month * 30.44 + day) % 29.53;
  const illumination = Math.abs(Math.cos((daysSinceNewMoon / 29.53) * 2 * Math.PI)) * 100;

  let phase: string;
  let emoji: string;

  if (daysSinceNewMoon < 1.84) {
    phase = 'New Moon';
    emoji = '🌑';
  } else if (daysSinceNewMoon < 5.53) {
    phase = 'Waxing Crescent';
    emoji = '🌒';
  } else if (daysSinceNewMoon < 9.22) {
    phase = 'First Quarter';
    emoji = '🌓';
  } else if (daysSinceNewMoon < 12.91) {
    phase = 'Waxing Gibbous';
    emoji = '🌔';
  } else if (daysSinceNewMoon < 16.61) {
    phase = 'Full Moon';
    emoji = '🌕';
  } else if (daysSinceNewMoon < 20.30) {
    phase = 'Waning Gibbous';
    emoji = '🌖';
  } else if (daysSinceNewMoon < 23.99) {
    phase = 'Last Quarter';
    emoji = '🌗';
  } else {
    phase = 'Waning Crescent';
    emoji = '🌘';
  }

  return { name: phase, emoji, illumination: Math.round(illumination) };
}

export async function handleUtilityRoutes(route: string, q: string): Promise<NextResponse | null> {
  if (route === 'temp' || route === 'temperature') {
    const input = q.trim();
    if (!input) {
      return txtResponse('Usage: !temp <value> [unit] (e.g., !temp 25, !temp 77 f, !temp 22c, !temp 70f)');
    }

    let value: number;
    let unit: string = 'c';

    const attachedUnitMatch = input.match(/^([+-]?\d+\.?\d*)\s*([cf]|celsius|fahrenheit)$/i);
    if (attachedUnitMatch) {
      value = parseFloat(attachedUnitMatch[1]);
      unit = attachedUnitMatch[2].toLowerCase();
      if (unit === 'celsius') unit = 'c';
      if (unit === 'fahrenheit') unit = 'f';
    } else {
      const parts = input.split(/\s+/).filter(p => p);
      value = parseFloat(parts[0]);
      if (parts.length > 1) {
        const unitPart = parts[1].toLowerCase();
        if (unitPart === 'f' || unitPart === 'fahrenheit') {
          unit = 'f';
        } else if (unitPart === 'c' || unitPart === 'celsius') {
          unit = 'c';
        }
      }
    }

    if (isNaN(value)) {
      return txtResponse('Usage: !temp <value> [unit] (e.g., !temp 25, !temp 77 f, !temp 22c, !temp 70f)');
    }

    let result: string;

    if (unit === 'f') {
      const celsius = (value - 32) * 5 / 9;
      result = `${value}°F = ${celsius.toFixed(1)}°C`;
    } else {
      const fahrenheit = value * 9 / 5 + 32;
      result = `${value}°C = ${fahrenheit.toFixed(1)}°F`;
    }

    return txtResponse(`🌡️ ${result}`);
  }

  if (route === 'moon') {
    const moonPhase = calculateMoonPhase();
    return txtResponse(`${moonPhase.emoji} Moon: ${moonPhase.name} (${moonPhase.illumination}% illuminated)`);
  }

  return null;
}
