import { NextResponse } from 'next/server';
import { txtResponse } from './shared';

export async function handleGameRoutes(route: string, q: string): Promise<NextResponse | null> {
  if (route === 'dice' || route === 'roll') {
    const parts = q.trim().split(/\s+/).filter(p => p);
    let sides = 6;
    let count = 1;

    if (parts.length > 0) {
      const first = parseInt(parts[0]);
      if (!isNaN(first) && first > 0) {
        if (first <= 100) {
          sides = first;
          if (parts.length > 1) {
            const second = parseInt(parts[1]);
            if (!isNaN(second) && second > 0 && second <= 10) {
              count = second;
            }
          }
        } else {
          count = Math.min(first, 10);
        }
      }
    }

    const results: number[] = [];
    for (let i = 0; i < count; i++) {
      results.push(Math.floor(Math.random() * sides) + 1);
    }

    if (count === 1) {
      return txtResponse(`🎲 Rolled ${results[0]} (d${sides})`);
    } else {
      const sum = results.reduce((a, b) => a + b, 0);
      return txtResponse(`🎲 Rolled ${results.join(', ')} = ${sum} (${count}d${sides})`);
    }
  }

  if (route === 'coin' || route === 'flip') {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    return txtResponse(`🪙 ${result}`);
  }

  if (route === '8ball' || route === 'magic8ball') {
    const responses = [
      'It is certain',
      'Without a doubt',
      'Yes definitely',
      'You may rely on it',
      'As I see it, yes',
      'Most likely',
      'Outlook good',
      'Yes',
      'Signs point to yes',
      'Reply hazy, try again',
      'Ask again later',
      'Better not tell you now',
      'Cannot predict now',
      'Concentrate and ask again',
      "Don't count on it",
      'My reply is no',
      'My sources say no',
      'Outlook not so good',
      'Very doubtful',
      'No'
    ];
    const response = responses[Math.floor(Math.random() * responses.length)];
    return txtResponse(`🎱 ${response}`);
  }

  if (route === 'random') {
    const parts = q.trim().split(/\s+/).filter(p => p);
    const [min, max] = (() => {
      if (parts.length === 0) return [1, 100];
      if (parts.length === 1) return [1, parseInt(parts[0])];
      return [parseInt(parts[0]), parseInt(parts[1])];
    })();

    if (isNaN(min) || isNaN(max) || min > max || min < 0 || max > 1000000) {
      return txtResponse('Usage: !random [min max] (e.g., !random, !random 100, !random 1 100)');
    }

    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return txtResponse(`🎲 Random: ${result} (${min}-${max})`);
  }

  return null;
}
