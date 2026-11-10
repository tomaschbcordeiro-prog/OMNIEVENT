/**
 * The list an event was opened from (a search, a city's picks, a venue's dates), kept for the
 * tab so the event page can step to the previous and next ones without going back.
 */

export type Trail = {
  /** The list's address, to go back to. */
  back: string;
  /** Its events' addresses (slugs), in the order shown. */
  slugs: string[];
  /** Set when an event was just opened from the list (a normal step forward in history). */
  pending?: boolean;
  /** Set when stepping to a neighbour (it replaces the page in history). */
  flip?: boolean;
  /** The list is the page right behind this one in history, so "back" can be a real back. */
  behind?: boolean;
};

const KEY = "omnievent:trail";
const MAX = 400;

/** The event slug in a link to an event page, or null. */
export function eventSlug(href: string | null | undefined): string | null {
  const m = /^\/events\/([^/?#]+)\/?(?:[?#].*)?$/.exec(href ?? "");
  if (!m || m[1] === "new") return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** The slugs of a list's event links, each once, in order. */
export function slugsOf(hrefs: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const h of hrefs) {
    const s = eventSlug(h);
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
      if (out.length >= MAX) break;
    }
  }
  return out;
}

/** Where an event sits in its list: its position and its neighbours, or null when it isn't in it. */
export function neighbours(trail: Trail | null, slug: string): { index: number; total: number; prev?: string; next?: string } | null {
  if (!trail) return null;
  const i = trail.slugs.indexOf(slug);
  if (i < 0 || trail.slugs.length < 2) return null;
  return { index: i, total: trail.slugs.length, prev: trail.slugs[i - 1], next: trail.slugs[i + 1] };
}

export function readTrail(): Trail | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Trail | null;
    return t && typeof t.back === "string" && Array.isArray(t.slugs) ? t : null;
  } catch {
    return null;
  }
}

export function writeTrail(t: Trail | null) {
  try {
    if (t) sessionStorage.setItem(KEY, JSON.stringify(t));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage off (private mode): the pager just doesn't show
  }
}
