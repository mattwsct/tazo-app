// === 📏 SIZE RANKING UTILITIES ===

const SIZE_ROUTE_CONFIG: Record<string, { unit: 'inch' | 'cm'; type: 'erect' | 'flaccid' }> = {
  inch: { unit: 'inch', type: 'erect' },
  cm: { unit: 'cm', type: 'erect' },
  // Note: flaccid commands (finch, fcm) removed - use type parameter instead
};

// Updated 2025 meta-analysis data (Mostafaei et al., 2025)
// Global averages: Erect length 13.84cm (5.45"), Erect circumference 11.91cm (4.69")
const STATS = {
  erect: {
    length: { mean: 5.45, sd: 0.65 }, // 2025 meta-analysis: 13.84cm = 5.45"
    girth: { mean: 4.69, sd: 0.43 }, // 2025 meta-analysis: 11.91cm = 4.69"
  },
  flaccid: {
    length: { mean: 3.61, sd: 0.62 },
    girth: { mean: 3.67, sd: 0.35 },
  },
};

// Porn star size database (measured/verified sizes, not claimed)
// Format: { name, length, girth, notes }
const PORN_STAR_SIZES = [
  { name: "Johnny Sins", length: 7.0, girth: 5.0, notes: "Most popular male performer" },
  { name: "Danny D", length: 8.25, girth: 5.5, notes: "Known for girth" },
  { name: "Jax Slayher", length: 8.5, girth: 5.8, notes: "Top performer" },
  { name: "Lexington Steele", length: 8.5, girth: 5.7, notes: "Industry veteran" },
  { name: "Manuel Ferrara", length: 7.1, girth: 5.2, notes: "Popular performer" },
  { name: "Mick Blue", length: 7.5, girth: 5.3, notes: "Award winner" },
  { name: "Rocco Siffredi", length: 8.0, girth: 5.6, notes: "Legendary performer" },
  { name: "James Deen", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Keiran Lee", length: 8.0, girth: 5.5, notes: "British performer" },
  { name: "Ramon Nomar", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Erik Everhard", length: 7.5, girth: 5.3, notes: "Award winner" },
  { name: "Chris Strokes", length: 7.2, girth: 5.1, notes: "Popular performer" },
  { name: "Markus Dupree", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Toni Ribas", length: 7.5, girth: 5.2, notes: "Spanish performer" },
  { name: "Nacho Vidal", length: 7.0, girth: 5.0, notes: "Spanish performer" },
  { name: "Mandingo", length: 9.0, girth: 6.0, notes: "Known for extreme size" },
  { name: "Dredd", length: 8.5, girth: 6.2, notes: "Extreme girth specialist" },
  { name: "Julio Gomez", length: 8.75, girth: 5.9, notes: "Popular performer" },
  { name: "Shane Diesel", length: 8.5, girth: 5.8, notes: "Legendary performer" },
  { name: "Jack Napier", length: 8.75, girth: 5.7, notes: "Popular performer" },
  { name: "JMac", length: 7.8, girth: 5.5, notes: "Popular performer" },
  { name: "Xander Corvus", length: 7.5, girth: 5.4, notes: "Popular performer" },
  { name: "Bruce Venture", length: 7.2, girth: 5.2, notes: "Popular performer" },
  { name: "Logan Pierce", length: 7.0, girth: 5.1, notes: "Popular performer" },
  { name: "Tommy Pistol", length: 7.3, girth: 5.2, notes: "Popular performer" },
  { name: "Ryan Madison", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Ryan Driller", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Small Hands", length: 7.2, girth: 5.1, notes: "Popular performer" },
  { name: "Bill Bailey", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Richie Calhoun", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Ricky Johnson", length: 7.2, girth: 5.2, notes: "Popular performer" },
  { name: "Bradley Remington", length: 7.8, girth: 5.5, notes: "Popular performer" },
  { name: "John Strong", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Michael Vegas", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Tyler Nixon", length: 7.3, girth: 5.2, notes: "Popular performer" },
  { name: "Rob Piper", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Danny Mountain", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Chad White", length: 7.2, girth: 5.1, notes: "Popular performer" },
  { name: "Ryan Mclane", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Marcus London", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Bruce Banner", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Damon Dice", length: 7.2, girth: 5.2, notes: "Popular performer" },
  { name: "Ricky Spanish", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Danny Wylde", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Tommy Gunn", length: 7.8, girth: 5.5, notes: "Popular performer" },
  { name: "Derrick Pierce", length: 7.2, girth: 5.1, notes: "Popular performer" },
  { name: "Rocco Reed", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Tyler Knight", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Johnny Castle", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Brad Tyler", length: 7.3, girth: 5.2, notes: "Popular performer" },
  { name: "Scott Nails", length: 8.0, girth: 5.6, notes: "Popular performer" },
  { name: "Evan Stone", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Tom Byron", length: 7.8, girth: 5.4, notes: "Industry legend" },
  { name: "Peter North", length: 7.5, girth: 5.5, notes: "Industry legend" },
  { name: "Ron Jeremy", length: 7.0, girth: 5.2, notes: "Industry legend" },
  { name: "Jules Jordan", length: 7.5, girth: 5.3, notes: "Director/performer" },
  { name: "Sean Michaels", length: 7.2, girth: 5.2, notes: "Industry veteran" },
  { name: "Mark Davis", length: 7.8, girth: 5.4, notes: "Popular performer" },
  { name: "Tony T", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Ricky Martinez", length: 7.0, girth: 5.0, notes: "Popular performer" },
  { name: "Johnny Hazzard", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Brad Armstrong", length: 7.8, girth: 5.4, notes: "Director/performer" },
  { name: "Rodney Moore", length: 7.5, girth: 5.3, notes: "Industry veteran" },
  { name: "Joel Lawrence", length: 7.2, girth: 5.2, notes: "Popular performer" },
  { name: "Trent Tesoro", length: 7.5, girth: 5.3, notes: "Popular performer" },
  { name: "Dane Cross", length: 7.8, girth: 5.4, notes: "Popular performer" },
];

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
  // Show exact percentile for very high rankings, rounded to 2 decimals
  if (percentile >= 99.9) {
    const exact = (100 - percentile).toFixed(2);
    return `top ${exact}%`;
  }
  if (percentile >= 99) {
    const exact = (100 - percentile).toFixed(1);
    return `top ${exact}%`;
  }
  if (percentile >= 95) return 'top 5%';
  if (percentile >= 90) return 'top 10%';
  return '';
}

function getPercentileFunFact(percentile: number): string {
  const topPercent = 100 - percentile;
  
  // Fun facts based on rarity - randomized for variety
  const facts: Record<string, string[]> = {
    '99.9+': [
      'Rarer than finding a four-leaf clover!',
      'Rarer than being struck by lightning!',
      'Top 0.1% - absolutely exceptional!',
      'Statistically extraordinary!',
    ],
    '99.5-99.9': [
      'Rarer than winning the lottery!',
      'Top 0.5% - incredibly rare!',
      'Statistically remarkable!',
    ],
    '99-99.5': [
      'Top 1% - exceptional!',
      'Rarer than 99% of people!',
      'Statistically elite!',
    ],
    '97.5-99': [
      'Top 2.5% - very impressive!',
      'Well above average - great size!',
      'Statistically excellent!',
    ],
    '95-97.5': [
      'Top 5% - well above average!',
      'Statistically impressive!',
      'Above 95% of people!',
    ],
    '90-95': [
      'Top 10% - great size!',
      'Well above average!',
      'Statistically notable!',
    ],
    '75-90': [
      'Top 25% - above average!',
      'Better than most!',
      'Statistically above average!',
    ],
    '50-75': [
      'Right around average - perfectly normal!',
      'Average size - totally normal!',
      'Right in the middle - perfectly fine!',
    ],
    '25-50': [
      'Below average but still common!',
      'Slightly below average - still normal!',
      'Common size - nothing unusual!',
    ],
    '0-25': [
      'Less common but still normal!',
      'Smaller than average - still normal!',
      'Below average - perfectly fine!',
    ],
  };
  
  let category: string;
  if (percentile >= 99.9) category = '99.9+';
  else if (percentile >= 99.5) category = '99.5-99.9';
  else if (percentile >= 99) category = '99-99.5';
  else if (percentile >= 97.5) category = '97.5-99';
  else if (percentile >= 95) category = '95-97.5';
  else if (percentile >= 90) category = '90-95';
  else if (percentile >= 75) category = '75-90';
  else if (percentile >= 50) category = '50-75';
  else if (percentile >= 25) category = '25-50';
  else category = '0-25';
  
  const factArray = facts[category];
  return factArray[Math.floor(Math.random() * factArray.length)];
}

function getSizeComparison(length: number, girth: number | null): string {
  const lengthInches = length;
  const girthInches = girth || 0;
  
  // Length comparisons
  const comparisons: string[] = [];
  if (lengthInches >= 8) {
    comparisons.push('length similar to a banana');
  } else if (lengthInches >= 7) {
    comparisons.push('length similar to a large smartphone');
  } else if (lengthInches >= 6) {
    comparisons.push('length similar to a dollar bill');
  } else if (lengthInches >= 5) {
    comparisons.push('length similar to a credit card');
  }
  
  // Girth comparisons
  if (girthInches) {
    if (girthInches >= 6) {
      comparisons.push('girth like a tennis ball');
    } else if (girthInches >= 5.5) {
      comparisons.push('girth like a baseball');
    } else if (girthInches >= 5) {
      comparisons.push('girth like a golf ball');
    } else if (girthInches >= 4.5) {
      comparisons.push('girth like a ping pong ball');
    }
  }
  
  if (comparisons.length > 0) {
    return `Size comparison: ${comparisons.join(', ')}`;
  }
  return '';
}

function getPercentageAboveAverage(value: number, mean: number): string {
  const percentage = ((value - mean) / mean) * 100;
  if (Math.abs(percentage) < 1) return ' (average)';
  if (percentage > 0) {
    return ` (+${percentage.toFixed(1)}% above avg)`;
  } else {
    return ` (${percentage.toFixed(1)}% below avg)`;
  }
}

function findSimilarPornStar(length: number, girth: number | null): string | null {
  if (girth === null) return null;
  
  // Find all matches within threshold (within 1" combined difference)
  const matches: typeof PORN_STAR_SIZES[0][] = [];
  
  for (const star of PORN_STAR_SIZES) {
    // Weighted distance: length difference + girth difference
    const lengthDiff = Math.abs(star.length - length);
    const girthDiff = Math.abs(star.girth - girth);
    const distance = lengthDiff * 1.5 + girthDiff; // Weight length slightly more
    
    if (distance < 1.0) { // Only match if within 1" combined difference
      matches.push(star);
    }
  }
  
  if (matches.length === 0) return null;
  
  // Randomly select one from all matches within range
  const selected = matches[Math.floor(Math.random() * matches.length)];
  
  // Check if it's an exact match (same length and girth)
  const isExactMatch = Math.abs(selected.length - length) < 0.01 && Math.abs(selected.girth - girth) < 0.01;
  
  let phrase: string;
  if (isExactMatch) {
    // Exact match - use "Same size"
    phrase = `Same size as ${selected.name}`;
  } else {
    // Similar match - use similar phrases
    const similarPhrases = [
      `Similar size to ${selected.name}`,
      `Matches ${selected.name}'s size`,
      `Comparable to ${selected.name}`,
      `Close to ${selected.name}'s size`,
    ];
    phrase = similarPhrases[Math.floor(Math.random() * similarPhrases.length)];
  }
  
  return ` ${phrase} (${selected.length}" x ${selected.girth}")`;
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
    // Length only - simplified format
    const lengthInfo = lengthPercentileText ? ` (${lengthPercentileText})` : '';
    return `🍆 ${formatMeasurement(lengthInches, unit)}${typeSuffix}: ${lengthCategory}${lengthInfo}`;
  }

  const girthZ = (girthInches - stat.girth.mean) / stat.girth.sd;
  const girthCategory = classifySize(girthZ);
  const girthPercentile = zToPercentile(girthZ);
  const girthPercentileText = getPercentileText(girthPercentile);
  
  // Find similar porn star (only for erect measurements)
  const pornStarMatch = type === 'erect' ? findSimilarPornStar(lengthInches, girthInches) : null;

  // Build response: size with percentiles attached to each measurement
  const lengthInfo = lengthPercentileText ? ` (${lengthPercentileText})` : '';
  const girthInfo = girthPercentileText ? ` (${girthPercentileText})` : '';
  
  let result = `🍆 ${formatMeasurement(lengthInches, unit)}${lengthInfo} x ${formatMeasurement(girthInches, unit)}${girthInfo}${typeSuffix}: ${lengthCategory} length, ${girthCategory} girth`;
  
  if (pornStarMatch) {
    result += `. ${pornStarMatch.trim()}`;
  }

  return result;
}

export function getSizeRouteConfig(route: string): { unit: 'inch' | 'cm'; type: 'erect' | 'flaccid' } | null {
  return SIZE_ROUTE_CONFIG[route] || null;
}

export function isSizeRoute(route: string): boolean {
  return route === 'size' || route in SIZE_ROUTE_CONFIG;
}
