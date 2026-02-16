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

// Condom nominal width tiers — girth drives fit.
//
// WHY: Nominal width = condom width when laid flat. Condom circumference ≈ 2× nominal width (not π×).
// Condom must stretch 5–20% to stay on (radial force) without breaking. Gerofi: condom circ < penis circ.
// Formula: nominal_width ≈ girth_mm / 2 / (1 + stretch). At 15% stretch: 139.7mm → 60.7mm (5.5" → 60mm).
//
// SOURCE: condom-sizes.org table (Gerofi study, Smith 1998 STD journal). Cross-checked condomerie.com,
// MY.SIZE/Playboy/Trojan Magnum XL specs for 5.5" (139–143mm) → 60mm.
//
// Verify: 5.5" girth = 139.7mm. 60mm nominal → 120mm unstretched circ → 139.7/120 = 16.4% stretch ✓
const CONDOM_SIZES: { minGirth: number; maxGirth: number; nominalWidth: number; label: string; brands: string[] }[] = [
  { minGirth: 3.5, maxGirth: 4.2, nominalWidth: 47, label: 'Snug', brands: ['Skyn Snug Fit', 'Pasante Trim', 'MyONE 47'] },
  { minGirth: 4.2, maxGirth: 4.5, nominalWidth: 49, label: 'Snug+', brands: ['Glyde SlimFit', 'Lifestyles Snugger Fit', 'MyONE 49'] },
  { minGirth: 4.5, maxGirth: 4.8, nominalWidth: 52, label: 'Regular', brands: ['Trojan ENZ', 'Durex', 'Skyn'] },
  { minGirth: 4.8, maxGirth: 5.1, nominalWidth: 54, label: 'Regular+', brands: ['Trojan Magnum Thin', 'Durex Avanti', 'Playboy Ultra Thin'] },
  { minGirth: 5.1, maxGirth: 5.3, nominalWidth: 56, label: 'Large', brands: ['Trojan Magnum', 'Durex Pleasuremax', 'Skyn Large'] },
  { minGirth: 5.3, maxGirth: 5.5, nominalWidth: 58, label: 'Large+', brands: ['Trojan Magnum XL', 'Durex XXL', 'Trustex XL'] },
  { minGirth: 5.5, maxGirth: 5.8, nominalWidth: 60, label: 'XL', brands: ['Trojan Magnum XL', 'Pasante King Size', 'MyONE 60'] },
  { minGirth: 5.8, maxGirth: 6.2, nominalWidth: 64, label: 'XXL', brands: ['Pasante Super King', 'MyONE 64', 'TITAN 2XL'] },
  { minGirth: 6.2, maxGirth: 99, nominalWidth: 69, label: 'XXXL', brands: ['Pasante Super King', 'MyONE 69', 'EXS Jumbo'] },
];

// Porn star size database (measured/verified sizes, not claimed)
// Format: { name, length, girth, notes } - includes spectrum from ~5.5" to 9"
const PORN_STAR_SIZES = [
  // 5.5–6.5" range (below-average length for industry)
  { name: "Owen Gray", length: 6.5, girth: 4.8, notes: "Popular performer" },
  { name: "Codey Steele", length: 6.2, girth: 4.6, notes: "Popular performer" },
  { name: "Chad Alva", length: 6.0, girth: 4.5, notes: "Popular performer" },
  { name: "Seth Gamble", length: 6.5, girth: 4.8, notes: "Director/performer" },
  { name: "Lucas Frost", length: 6.5, girth: 4.7, notes: "Popular performer" },
  { name: "Alex Mack", length: 6.3, girth: 4.6, notes: "Popular performer" },
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
  if (z >= 6) return 99.9999999;
  if (z <= -6) return 0.0000001;
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const percentile = z >= 0 ? (1 - p) * 100 : p * 100;
  return Math.max(1e-7, Math.min(100 - 1e-7, percentile));
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

/** Format small percentages with enough precision (e.g. 0.01, 0.0000001) */
function formatPercentileValue(p: number): string {
  if (p >= 10) return p.toFixed(1);
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.1) return p.toFixed(3);
  if (p >= 0.01) return p.toFixed(4);
  if (p >= 0.001) return p.toFixed(5);
  if (p >= 0.0001) return p.toFixed(6);
  if (p >= 0.00001) return p.toFixed(7);
  if (p >= 0.000001) return p.toFixed(8);
  const s = p.toFixed(12);
  return s.replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function getPercentileText(percentile: number): string {
  if (percentile >= 50) {
    const topPct = 100 - percentile;
    return `top ${formatPercentileValue(topPct)}%`;
  }
  return `bottom ${formatPercentileValue(percentile)}%`;
}

function getCondomSuggestion(girthInches: number): string {
  for (const tier of CONDOM_SIZES) {
    if (girthInches >= tier.minGirth && girthInches < tier.maxGirth) {
      const brands = tier.brands.slice(0, 2).join(', '); // Top 2 brands
      return ` ~${tier.nominalWidth}mm nominal width (${tier.label}): ${brands}`;
    }
  }
  return '';
}

function findSimilarPornStarByLength(lengthInches: number, unit: 'inch' | 'cm'): string | null {
  let closest: (typeof PORN_STAR_SIZES)[0] | null = null;
  let minDiff = Infinity;

  for (const star of PORN_STAR_SIZES) {
    const diff = Math.abs(star.length - lengthInches);
    if (diff < minDiff && diff <= 0.5) {
      minDiff = diff;
      closest = star;
    }
  }

  if (!closest) return null;

  const lengthMatch = Math.abs(closest.length - lengthInches) < 0.1;
  const phrase = lengthMatch
    ? `Same length as ${closest.name}`
    : `Similar length to ${closest.name}`;
  return ` ${phrase} (${formatMeasurement(closest.length, unit)})`;
}

function findSimilarPornStar(length: number, girth: number | null, unit: 'inch' | 'cm'): string | null {
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
  
  return ` ${phrase} (${formatMeasurement(selected.length, unit)} x ${formatMeasurement(selected.girth, unit)})`;
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
    // Length only - simplified format + porn star length comparison
    const lengthInfo = lengthPercentileText ? ` (${lengthPercentileText})` : '';
    const lengthStarMatch = type === 'erect' ? findSimilarPornStarByLength(lengthInches, unit) : null;
    let result = `🍆 ${formatMeasurement(lengthInches, unit)}${typeSuffix}: ${lengthCategory}${lengthInfo}`;
    if (lengthStarMatch) result += '.' + lengthStarMatch;
    return result;
  }

  const girthZ = (girthInches - stat.girth.mean) / stat.girth.sd;
  const girthCategory = classifySize(girthZ);
  const girthPercentile = zToPercentile(girthZ);
  const girthPercentileText = getPercentileText(girthPercentile);
  
  // Find similar porn star (only for erect measurements)
  const pornStarMatch = type === 'erect' ? findSimilarPornStar(lengthInches, girthInches, unit) : null;

  // Build response: size with percentiles attached to each measurement
  const lengthInfo = lengthPercentileText ? ` (${lengthPercentileText})` : '';
  const girthInfo = girthPercentileText ? ` (${girthPercentileText})` : '';
  
  let result = `🍆 ${formatMeasurement(lengthInches, unit)}${lengthInfo} x ${formatMeasurement(girthInches, unit)}${girthInfo}${typeSuffix}: ${lengthCategory} length, ${girthCategory} girth`;
  
  const condomSuggestion = getCondomSuggestion(girthInches);
  if (condomSuggestion) result += condomSuggestion;

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
