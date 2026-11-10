/**
 * "How was it?": saved events that ended a little while ago, to ask the person who saved them
 * for a few stars and words. Their answers are what the next person reads before going.
 */

type Dated = { id: string; start: string; eventType: string; ongoing?: boolean; hoursUnknown?: boolean };

/** Ended at least this long ago (a typical evening is over)… */
const AFTER_MS = 3 * 3600_000;
/** …and not so long ago that it's forgotten. */
const WITHIN_MS = 10 * 86_400_000;

/** The events worth asking about now, the most recent first. */
export function toAskAbout<T extends Dated>(cards: T[], asked: Iterable<string>, now = Date.now()): T[] {
  const skip = new Set(asked);
  return cards
    .filter((c) => {
      // Places open every day and runs over several days aren't "over" in an evening.
      if (skip.has(c.id) || c.eventType === "daily_attraction" || c.eventType === "multi_day" || c.ongoing) return false;
      const start = Date.parse(c.start);
      // With no time known, the date is all there is: ask the day after.
      const over = start + (c.hoursUnknown ? 27 * 3600_000 : AFTER_MS);
      return Number.isFinite(start) && over <= now && start > now - WITHIN_MS;
    })
    .sort((a, b) => b.start.localeCompare(a.start));
}

/** "tonight", "yesterday", "on Saturday", "on 3 Nov": when it was, from the visitor's side. */
export function whenItWas(start: string, timeZone: string, now = Date.now()): string {
  const day = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
  const s = Date.parse(start);
  if (day(s) === day(now)) return "today";
  if (day(s) === day(now - 86_400_000)) return "yesterday";
  if (now - s < 6 * 86_400_000) return `on ${new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(new Date(s))}`;
  return `on ${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone }).format(new Date(s))}`;
}

const KEY = "omnievent:asked:v1";

/** Events already answered or waved away (kept in this browser). */
export function askedIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function markAsked(id: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([id, ...askedIds().filter((x) => x !== id)].slice(0, 300)));
  } catch {
    // storage off: it may be asked again
  }
}

/**
 * Where to write the review, with the review box open and the stars already set: the event's
 * page while it's listed; once it's gone (events leave the catalogue after they happen), its
 * venue's page, with the event named at the start of the review.
 */
export function reviewHref(c: { slug: string; title: string; venueSlug?: string }, stars = 0, listed = true): string {
  if (listed || !c.venueSlug) return `/events/${encodeURIComponent(c.slug)}?review=${stars}#community`;
  return `/venues/${encodeURIComponent(c.venueSlug)}?review=${stars}&about=${encodeURIComponent(c.title.slice(0, 80))}#community`;
}

/** The details of an event kept with it when it's saved (see SavedSnap). */
export function snapOf(c: { slug: string; title: string; start: string; timeZone: string; eventType: string; hoursUnknown?: boolean; venueName: string; venueSlug?: string; imageUrl?: string; posterHue?: number; categorySlug: string }) {
  return { slug: c.slug, title: c.title.slice(0, 200), start: c.start, timeZone: c.timeZone, eventType: c.eventType, hoursUnknown: c.hoursUnknown || undefined, venueName: c.venueName.slice(0, 120), venueSlug: c.venueSlug, imageUrl: c.imageUrl, posterHue: c.posterHue, categorySlug: c.categorySlug };
}
