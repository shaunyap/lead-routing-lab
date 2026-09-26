// Deterministic randomness, hashing and string helpers shared by the generator and engines.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = ReturnType<typeof mulberry32>;

export const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

export function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (t: T) => number): T {
  const total = items.reduce((s, t) => s + weight(t), 0);
  let r = rng() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}

/** FNV-1a: stable across Node and the browser. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited",
  "plc", "gmbh", "bv", "kk", "sa", "ag",
]);

/** Comparison key for company names: accents, punctuation, case and legal suffixes removed. */
export function companyKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !COMPANY_SUFFIXES.has(w))
    .join(" ");
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, " ");
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice coefficient over character bigrams, 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map<string, number>();
  for (const g of A) counts.set(g, (counts.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of B) {
    const c = counts.get(g) ?? 0;
    if (c > 0) {
      hits++;
      counts.set(g, c - 1);
    }
  }
  return (2 * hits) / (A.length + B.length);
}

/** "jANE" -> "Jane", "anne-marie" -> "Anne-Marie", "o'neil" -> "O'Neil". */
export function properCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-zà-ÿ])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export function isOddCase(s: string): boolean {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2) return false;
  return letters === letters.toUpperCase() || letters === letters.toLowerCase();
}

export const pct = (n: number, d: number) => (d === 0 ? 1 : n / d);
