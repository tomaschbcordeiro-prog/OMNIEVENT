/**
 * When a tape plays: tonight, tomorrow, this weekend, next weekend or chosen dates, worked out
 * in the city's own time zone (Friday evening in Tokyo is not Friday evening in Lisbon).
 */
import { todayIn, zonedToUtc } from "../time";

export type WhenKind = "tonight" | "tomorrow" | "weekend" | "next-weekend" | "dates";

export const WHEN: { id: WhenKind; label: string }[] = [
  { id: "tonight", label: "Tonight" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "weekend", label: "This weekend" },
  { id: "next-weekend", label: "Next weekend" },
  { id: "dates", label: "Pick dates" },
];

export interface TapeWindow {
  kind: WhenKind;
  /** Tracks start from … until (ms). */
  from: number;
  to: number;
  /** The local dates covered (for the catalogue). */
  fromDate: string;
  toDate: string;
  /** How many tracks suit this much time. */
  tracks: number;
}

const DAY = 864e5;
const MAX_DAYS = 7;

export const addDays = (ymd: string, n: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const at = (ymd: string, hh: number, mm: number, tz: string) => zonedToUtc(+ymd.slice(0, 4), +ymd.slice(5, 7), +ymd.slice(8, 10), hh, mm, tz);
const isYmd = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));

/** The window for a choice, from `now`. Chosen dates are kept to a week at most. */
export function tapeWindow(kind: WhenKind, tz: string, now = Date.now(), dates?: { from: string; to: string }): TapeWindow {
  const today = todayIn(tz, new Date(now));
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  // Starting now means starting at the next quarter of an hour.
  const soon = Math.ceil(now / 9e5) * 9e5;
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  let from: number, to: number, tracks: number;
  switch (kind) {
    case "tonight": {
      // Past midnight, "tonight" is the night still going on.
      const night = hour < 5 ? addDays(today, -1) : today;
      from = Math.max(soon, at(night, 17, 0, tz));
      to = at(addDays(night, 1), 4, 0, tz);
      tracks = 3;
      break;
    }
    case "tomorrow": {
      const d = addDays(today, 1);
      from = at(d, 9, 0, tz);
      to = at(addDays(d, 1), 4, 0, tz);
      tracks = 3;
      break;
    }
    case "weekend":
    case "next-weekend": {
      // Friday 17:00 to Sunday midnight; on the weekend itself, from now.
      const toFri = wd === 0 ? -2 : 5 - wd;
      const fri = addDays(today, toFri + (kind === "next-weekend" ? 7 : 0));
      from = Math.max(soon, at(fri, 17, 0, tz));
      to = at(addDays(fri, 3), 0, 0, tz);
      tracks = 5;
      break;
    }
    default: {
      let a = isYmd(dates?.from) ? dates!.from : today;
      let b = isYmd(dates?.to) ? dates!.to : a;
      if (a < today) a = today;
      if (b < a) b = a;
      if (Date.parse(b) - Date.parse(a) > (MAX_DAYS - 1) * DAY) b = addDays(a, MAX_DAYS - 1);
      from = Math.max(soon, at(a, 9, 0, tz));
      to = at(addDays(b, 1), 4, 0, tz);
      const days = Math.round((Date.parse(b) - Date.parse(a)) / DAY) + 1;
      tracks = Math.min(8, days * 2 + 1);
    }
  }
  if (to <= from) to = from + 6 * 3600000;
  return { kind, from, to, fromDate: todayIn(tz, new Date(from)), toDate: todayIn(tz, new Date(to - 1)), tracks };
}

/** "Fri 13 – Sun 15 Nov", "Tonight · Sat 7 Nov". */
export function windowLabel(w: TapeWindow, tz: string, locale = "en-GB"): string {
  const day = (t: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts }).format(new Date(t));
  const a = day(w.from, { weekday: "short", day: "numeric" });
  const b = day(w.to - 1, { weekday: "short", day: "numeric", month: "short" });
  const one = w.fromDate === w.toDate || (w.kind === "tonight" || w.kind === "tomorrow");
  const range = one ? day(w.from, { weekday: "short", day: "numeric", month: "short" }) : `${a} – ${b}`;
  const name = WHEN.find((x) => x.id === w.kind)?.label;
  return w.kind === "dates" ? range : `${name} · ${range}`;
}
