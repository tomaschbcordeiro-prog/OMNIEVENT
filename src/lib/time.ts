/**
 * Time-zone-aware time windows.
 *
 * Event instants are stored in UTC with the venue's IANA zone kept alongside.
 * A search such as "24 Oct, 18:00–23:00" is a *local* wall-clock window: for every
 * event we interpret it in that event's own venue zone, turn it into absolute
 * instants, and test for overlap with the event's scheduled interval.
 *
 * DST policy (documented, tested):
 * - A window start that falls in a repeated hour (clocks going back) uses the EARLIER instant,
 *   and a window end the LATER one, so the window never shrinks.
 * - A local time that doesn't exist (clocks going forward) moves to the first valid instant after it.
 * - An end time at or before the start time means the window runs past midnight into the next day.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    fmtCache.set(tz, f);
  }
  return f;
}

// Offsets only change on transitions, which fall on quarter-hour boundaries, so caching per
// 15-minute bucket is exact and makes repeated window maths cheap.
const offsetCache = new Map<string, number>();
const BUCKET = 15 * 60000;

/** UTC offset (ms) of `tz` at instant `t`. */
export function tzOffsetMs(t: number, tz: string): number {
  const key = `${tz}|${Math.floor(t / BUCKET)}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;
  const b = Math.floor(t / BUCKET) * BUCKET;
  const p = Object.fromEntries(partsFormatter(tz).formatToParts(new Date(b)).map((x) => [x.type, x.value]));
  const off = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - b;
  if (offsetCache.size > 200000) offsetCache.clear();
  offsetCache.set(key, off);
  return off;
}

const validTz = new Map<string, boolean>();
export function isValidTimeZone(tz: string): boolean {
  let ok = validTz.get(tz);
  if (ok === undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      ok = true;
    } catch {
      ok = false;
    }
    validTz.set(tz, ok);
  }
  return ok;
}

/** Wall-clock time in `tz` → UTC ms, with the DST policy above. */
export function zonedToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string, prefer: "earliest" | "latest" = "earliest"): number {
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = new Set([tzOffsetMs(wall - 864e5 / 2, tz), tzOffsetMs(wall, tz), tzOffsetMs(wall + 864e5 / 2, tz)]);
  const valid = [...offsets].map((o) => wall - o).filter((t) => tzOffsetMs(t, tz) === wall - t);
  if (valid.length) return prefer === "earliest" ? Math.min(...valid) : Math.max(...valid);
  // Nonexistent local time (spring-forward gap): use the offset from before the gap,
  // which lands just after the gap.
  return wall - tzOffsetMs(wall - 864e5 / 2, tz);
}

/** Back-compat helper used by the demo generator. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): string {
  return new Date(zonedToUtc(y, m, d, hh, mm, tz)).toISOString();
}

export const parseHM = (s: string): [number, number] => {
  const [h, m] = s.split(":").map(Number);
  return [h, m];
};

function* days(from: string, to: string): Generator<[number, number, number]> {
  let t = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const end = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  for (let i = 0; t <= end && i < 400; i++, t += 864e5) {
    const d = new Date(t);
    yield [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
}

/**
 * Absolute [start, end) intervals for a local window repeated on each day from..to in `tz`.
 * Without times, each day is the whole local day.
 */
const windowCache = new Map<string, [number, number]>();

export function windowIntervals(from: string, to: string, tz: string, tFrom?: string, tTo?: string): [number, number][] {
  const out: [number, number][] = [];
  const [sh, sm] = tFrom ? parseHM(tFrom) : [0, 0];
  const [eh, em] = tTo ? parseHM(tTo) : [24, 0];
  const overnight = eh * 60 + em <= sh * 60 + sm;
  for (const [y, m, d] of days(from, to)) {
    const key = `${tz}|${y}-${m}-${d}|${tFrom ?? ""}|${tTo ?? ""}`;
    let w = windowCache.get(key);
    if (!w) {
      const start = zonedToUtc(y, m, d, sh, sm, tz, "earliest");
      const endDay = new Date(Date.UTC(y, m - 1, d + (overnight || eh === 24 ? 1 : 0)));
      const end = zonedToUtc(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), eh === 24 ? 0 : eh, em, tz, "latest");
      w = [start, end];
      if (windowCache.size > 100000) windowCache.clear();
      windowCache.set(key, w);
    }
    out.push(w);
  }
  return out;
}

export const overlaps = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

/** "WEST, UTC+01:00" for a zone on a given day. */
export function tzLabel(tz: string, at: Date = new Date(), locale = "en-GB"): string {
  const short = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const off = Math.round(tzOffsetMs(at.getTime(), tz) / 60000);
  const sign = off >= 0 ? "+" : "-";
  const a = Math.abs(off);
  const utc = `UTC${sign}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
  return short && short !== utc && !short.startsWith("GMT") ? `${short}, ${utc}` : utc;
}

/** Today's date (YYYY-MM-DD) in a zone. */
const ymdFmt = new Map<string, Intl.DateTimeFormat>();
export function todayIn(tz: string, now = new Date()): string {
  let f = ymdFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    ymdFmt.set(tz, f);
  }
  return f.format(now);
}

export const TIME_PRESETS: { id: string; label: string; from?: string; to?: string }[] = [
  { id: "all", label: "All day" },
  { id: "morning", label: "Morning", from: "06:00", to: "12:00" },
  { id: "afternoon", label: "Afternoon", from: "12:00", to: "18:00" },
  { id: "evening", label: "Evening", from: "18:00", to: "23:00" },
  { id: "late", label: "Late night", from: "22:00", to: "04:00" },
];
