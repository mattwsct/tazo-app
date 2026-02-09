// === 📏 SIZE RANKING UTILITIES ===

const SIZE_ROUTE_CONFIG: Record<string, { unit: 'inch' | 'cm'; type: 'erect' | 'flaccid' }> = {
  inch: { unit: 'inch', type: 'erect' },
  cm: { unit: 'cm', type: 'erect' },
  // Note: flaccid commands (finch, fcm) removed - use type parameter instead
};

const STATS = {
  erect: {
    length: { mean: 5.17, sd: 0.65 },
    girth: { mean: 4.59, sd: 0.43 },
  },
  flaccid: {
    length: { mean: 3.61, sd: 0.62 },
    girth: { mean: 3.67, sd: 0.35 },
  },
};

function zToPercentile(z: number): number {
  if (z >= 4) return 99.9;
  if (z <= -4) return 0.1;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const percentile = z >= 0 ? (1 - p) * 100 : p * 100;
  const clamped = Math.max(0.1, Math.min(99.9, percentile));
  return Math.round(clamped * 10) / 10;
}

function classifySize(z: number): string {
  if (z < -3) return 'micro';
  if (z < -2) return 'tiny';
  if (z < -1) return 'small';
  if (z < -0.5) return 'below average';
  if (z < 0.5) return 'average';
  if (z < 1) return 'above average';
  if (z < 2) return 'large';
  if (z < 3) return 'huge';
  return 'massive';
}

function getFunFact(avgZ: number): string {
  const messages = {
    high: [
      'legendary size', 'exceptional', 'absolute unit', 'god-tier', 'mythical proportions',
      'legendary status', 'elite tier', 'top shelf', 'premium grade', 'exceptional specimen',
      'monster energy', 'beast mode', 'titanic', 'colossal', 'magnificent', 'spectacular',
      'world-class', 'champion size', 'hall of fame', 'legendary', 'epic proportions',
      'king-sized', 'emperor tier', 'divine proportions', 'celestial size', 'immortal status',
    ],
    medium: [
      'impressive', 'respectable', 'notable', 'commendable', 'praiseworthy', 'standout',
      'remarkable', 'admirable', 'worthy of respect', 'excellent', 'outstanding',
      'top-tier', 'premium', 'first-class', 'high-grade', 'superior', 'exceptional',
      'impressive specimen', 'noteworthy', 'praiseworthy', 'commendable', 'admirable',
    ],
    low: [
      'perfectly sized', 'just right', 'classic', 'tried and true', 'reliable choice',
      'goldilocks zone', 'sweet spot', 'ideal proportions', 'well-balanced', 'perfectly proportioned',
      'standard issue', 'textbook perfect', 'exactly as expected', 'right in the middle',
      'perfectly average', 'just the right size', 'ideal dimensions', 'perfect balance',
      'classic proportions', 'standard build', 'normal and nice', 'perfectly normal',
      'right where it should be', 'ideal size', 'perfect fit', 'just perfect',
    ],
  };

  let category: keyof typeof messages;
  if (avgZ >= 3) category = 'high';
  else if (avgZ >= 2) category = 'medium';
  else category = 'low';

  const arr = messages[category];
  return `, ${arr[Math.floor(Math.random() * arr.length)]}`;
}

function getPercentileText(percentile: number): string {
  if (percentile >= 99.9) return ' (top 0.1%)';
  if (percentile >= 99) return ' (top 1%)';
  if (percentile >= 95) return ' (top 5%)';
  if (percentile >= 90) return ' (top 10%)';
  return '';
}

function formatMeasurement(val: number, unit: 'inch' | 'cm'): string {
  if (unit === 'cm') {
    const cm = Math.round(val * 2.54 * 10) / 10;
    return `${cm % 1 === 0 ? Math.round(cm) : cm}cm`;
  }
  const inches = val.toFixed(1);
  return `${inches.replace(/\.0$/, '')}"`;
}

export function handleSizeRanking(
  length: number,
  girth: number | null,
  unit: 'inch' | 'cm',
  type: 'erect' | 'flaccid'
): string | null {
  if (isNaN(length) || length <= 0) {
    return null;
  }

  const lengthInches = unit === 'cm' ? length / 2.54 : length;
  const girthInches = girth !== null && !isNaN(girth) ? (unit === 'cm' ? girth / 2.54 : girth) : null;

  const stat = STATS[type];
  const lengthZ = (lengthInches - stat.length.mean) / stat.length.sd;
  const lengthCategory = classifySize(lengthZ);
  const lengthPercentile = zToPercentile(lengthZ);
  const lengthPercentileText = getPercentileText(lengthPercentile);

  const typeSuffix = type === 'flaccid' ? ' flaccid' : '';

  if (girthInches === null) {
    const funFact = getFunFact(lengthZ);
    return `🍆 ${formatMeasurement(lengthInches, unit)}${typeSuffix} — ${lengthCategory} length${lengthPercentileText}${funFact}`;
  }

  const girthZ = (girthInches - stat.girth.mean) / stat.girth.sd;
  const girthCategory = classifySize(girthZ);
  const girthPercentile = zToPercentile(girthZ);
  const girthPercentileText = getPercentileText(girthPercentile);
  const avgZ = (lengthZ + girthZ) / 2;
  const funFact = getFunFact(avgZ);

  return `🍆 ${formatMeasurement(lengthInches, unit)} x ${formatMeasurement(girthInches, unit)}${typeSuffix} — ${lengthCategory} length${lengthPercentileText}, ${girthCategory} girth${girthPercentileText}${funFact}`;
}

export function getSizeRouteConfig(route: string): { unit: 'inch' | 'cm'; type: 'erect' | 'flaccid' } | null {
  return SIZE_ROUTE_CONFIG[route] || null;
}

export function isSizeRoute(route: string): boolean {
  return route === 'size' || route in SIZE_ROUTE_CONFIG;
}
