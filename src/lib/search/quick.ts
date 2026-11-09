import type { SearchFilters } from "../types";

/**
 * One-tap picks above every list of events: when (today, tonight, tomorrow, this weekend,
 * the next seven days) and whether it's free. The "when" picks replace one another; tapping
 * the one that's on clears it. "Free" goes on and off by itself.
 */
export type QuickId = "today" | "tonight" | "tomorrow" | "weekend" | "week" | "free";

export const TONIGHT = { tFrom: "18:00", tTo: "04:00" } as const;

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The visitor's calendar days (their own clock), as YYYY-MM-DD. */
function days(now: Date) {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const add = (n: number) => ymd(new Date(today.getTime() + n * 86400000));
  const dow = today.getUTCDay();
  // This weekend: Friday to Sunday, or what's left of it.
  const fri = dow === 0 || dow === 6 ? 0 : 5 - dow;
  const sun = dow === 0 ? 0 : 7 - dow;
  return { today: add(0), tomorrow: add(1), weekendFrom: add(fri), weekendTo: add(sun), weekTo: add(6) };
}

export interface QuickPick {
  id: QuickId;
  label: string;
  /** The search with this pick on. */
  on: (f: SearchFilters) => SearchFilters;
}

const noTonight = (f: SearchFilters): Partial<SearchFilters> => (f.tFrom === TONIGHT.tFrom && f.tTo === TONIGHT.tTo ? { tFrom: undefined, tTo: undefined } : {});

export function quickPicks(now = new Date()): QuickPick[] {
  const d = days(now);
  const span = (from: string, to: string) => (f: SearchFilters): SearchFilters => ({ ...f, ...noTonight(f), from, to, live: undefined, page: undefined });
  return [
    { id: "today", label: "Today", on: span(d.today, d.today) },
    { id: "tonight", label: "Tonight", on: (f) => ({ ...f, from: d.today, to: d.today, ...TONIGHT, live: undefined, page: undefined }) },
    { id: "tomorrow", label: "Tomorrow", on: span(d.tomorrow, d.tomorrow) },
    { id: "weekend", label: "This weekend", on: span(d.weekendFrom, d.weekendTo) },
    { id: "week", label: "Next 7 days", on: span(d.today, d.weekTo) },
    { id: "free", label: "Free", on: (f) => ({ ...f, access: "free", page: undefined }) },
  ];
}

/** Which picks the search is on now. */
export function activeQuick(f: SearchFilters, now = new Date()): Set<QuickId> {
  const d = days(now);
  const on = new Set<QuickId>();
  const tonight = f.tFrom === TONIGHT.tFrom && f.tTo === TONIGHT.tTo;
  const timed = !!(f.tFrom || f.tTo);
  if (f.from === d.today && f.to === d.today) {
    if (tonight) on.add("tonight");
    else if (!timed) on.add("today");
  }
  if (!timed) {
    if (f.from === d.tomorrow && f.to === d.tomorrow) on.add("tomorrow");
    if (f.from === d.weekendFrom && f.to === d.weekendTo) on.add("weekend");
    if (f.from === d.today && f.to === d.weekTo) on.add("week");
  }
  if (f.access === "free") on.add("free");
  return on;
}

/** The search after tapping a pick: on if it was off, off (with nothing else changed) if it was on. */
export function toggleQuick(f: SearchFilters, id: QuickId, now = new Date()): SearchFilters {
  const pick = quickPicks(now).find((p) => p.id === id)!;
  if (!activeQuick(f, now).has(id)) return pick.on(f);
  if (id === "free") return { ...f, access: undefined, page: undefined };
  return { ...f, ...noTonight(f), from: undefined, to: undefined, page: undefined };
}
