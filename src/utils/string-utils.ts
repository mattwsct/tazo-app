/**
 * Shared string utilities
 */

/**
 * Returns true if two location names overlap (one contains the other or they share 2+ significant words).
 * Used to avoid duplicate display of similar names (e.g. "Downtown Los Angeles" + "Los Angeles County").
 */
export function hasOverlappingNames(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim();
  const n2 = name2.toLowerCase().trim();
  if (n1 === n2) return true;
  if (n1.includes(n2) || n2.includes(n1)) return true;
  const w1 = n1.split(/\s+/).filter((w) => w.length > 0);
  const w2 = n2.split(/\s+/).filter((w) => w.length > 0);
  if (w1.length === 0 || w2.length === 0) return false;
  const shorter = w1.length <= w2.length ? w1 : w2;
  const longer = w1.length > w2.length ? w1 : w2;
  if (shorter.every((word) => longer.includes(word))) return true;
  const common = shorter.filter((w) => longer.includes(w));
  return common.length >= 2;
}
