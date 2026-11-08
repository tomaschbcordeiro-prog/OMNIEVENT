import { ALL_DESTINATIONS } from "@/lib/destinations";
import { CATEGORIES } from "@/lib/categories";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Edit distance with swaps (Damerau–Levenshtein, optimal string alignment), stopping early past `max`. */
export function distance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** Words worth suggesting: places (and their other names) and kinds of event. */
let vocabulary: string[] | undefined;
function words(): string[] {
  if (vocabulary) return vocabulary;
  const set = new Set<string>();
  const add = (s?: string) => {
    for (const w of fold(s ?? "").split(/[^a-z0-9]+/)) if (w.length >= 4) set.add(w);
  };
  for (const d of ALL_DESTINATIONS) {
    add(d.name);
    for (const a of (d as { aliases?: string[] }).aliases ?? []) add(a);
  }
  for (const c of CATEGORIES) add(c.name);
  return (vocabulary = [...set]);
}

/**
 * For a search that found nothing: the same words with likely typos fixed ("lisbn" → "lisbon"),
 * or undefined when no word is close enough to a place or a kind of event.
 */
export function didYouMean(q: string): string | undefined {
  const vocab = words();
  let changed = false;
  const out = q.split(/(\s+)/).map((tok) => {
    const t = fold(tok);
    if (t.length < 4 || !/^[a-z0-9]+$/.test(t) || vocab.includes(t)) return tok;
    const allowed = t.length >= 8 ? 2 : 1;
    let best: string | undefined;
    let bestD = allowed + 1;
    for (const w of vocab) {
      const dd = distance(t, w, allowed);
      if (dd < bestD) {
        bestD = dd;
        best = w;
      }
    }
    if (!best) return tok;
    changed = true;
    return best;
  });
  return changed ? out.join("") : undefined;
}
