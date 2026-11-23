import { getCategory, groupOf } from "./categories";
import type { SavedSnap, Trip } from "./user/store";
import { flagOf, nightsBetween } from "./trip";

/**
 * "Your year": a few honest numbers from what you saved and the trips you planned this year, all
 * worked out in your browser from your own lists (nothing is sent anywhere). Each figure is only
 * given when there's enough behind it to mean something.
 */

export type DayPart = "night" | "day" | "any";

export interface Recap {
  year: number;
  saved: number;
  /** Of those, the ones still to come. */
  ahead: number;
  /** The kinds you saved most, with their share (0–1), biggest first, at most three. */
  kinds: { group: string; name: string; share: number }[];
  /** Events per weekday, Monday first; and the busiest day, when one stands out. */
  weekdays: number[];
  topDay?: string;
  /** When your events start: mostly in the evening, in the day, or all sorts. */
  dayPart?: DayPart;
  nightShare?: number;
  /** The busiest month (its name), when there were at least two in it. */
  topMonth?: string;
  trips: number;
  nights: number;
  cities: number;
  countries: string[];
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The local weekday (0 = Monday) and hour of an instant in a time zone. */
function localParts(iso: string, timeZone: string): { weekday: number; hour: number; year: number; month: number } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "numeric", hourCycle: "h23", year: "numeric", month: "numeric" }).formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const wd = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(get("weekday"));
    return { weekday: wd, hour: Number(get("hour")), year: Number(get("year")), month: Number(get("month")) - 1 };
  } catch {
    return null;
  }
}

export function yearRecap(data: { saved: { id: string; at: string; snap?: SavedSnap }[]; trips: Trip[] }, now = new Date()): Recap {
  const year = now.getFullYear();
  const mine = data.saved.filter((s) => s.snap && new Date(s.at).getFullYear() === year);
  const snaps = mine.map((s) => s.snap!) as SavedSnap[];

  const ahead = snaps.filter((s) => new Date(s.start).getTime() > now.getTime()).length;

  const byGroup = new Map<string, number>();
  for (const s of snaps) {
    const g = groupOf(s.categorySlug);
    byGroup.set(g, (byGroup.get(g) ?? 0) + 1);
  }
  const kinds = [...byGroup.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([group, n]) => ({ group, name: getCategory(group)?.name.split(" &")[0] ?? group, share: snaps.length ? n / snaps.length : 0 }));

  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const months = new Array(12).fill(0) as number[];
  let timed = 0;
  let night = 0;
  let day = 0;
  for (const s of snaps) {
    const p = localParts(s.start, s.timeZone);
    if (!p || p.weekday < 0) continue;
    weekdays[p.weekday]++;
    if (p.year === year) months[p.month]++;
    if (s.hoursUnknown || s.eventType === "daily_attraction") continue;
    timed++;
    if (p.hour >= 19 || p.hour < 4) night++;
    else if (p.hour >= 9 && p.hour < 18) day++;
  }
  const most = Math.max(...weekdays);
  const sortedDays = [...weekdays].sort((a, b) => b - a);
  // A day "stands out" when it has at least three events and more than any other day.
  const topDay = most >= 3 && sortedDays[0] > sortedDays[1] ? WEEKDAYS[weekdays.indexOf(most)] : undefined;
  const dayPart: DayPart | undefined = timed >= 4 ? (night / timed >= 0.55 ? "night" : day / timed >= 0.55 ? "day" : "any") : undefined;
  const topMonthN = Math.max(...months);
  const topMonth = topMonthN >= 2 && months.filter((n) => n === topMonthN).length === 1 ? MONTHS[months.indexOf(topMonthN)] : undefined;

  const trips = data.trips.filter((t) => (t.start ? Number(t.start.slice(0, 4)) === year : false));
  let nights = 0;
  const cities = new Set<string>();
  const countries = new Set<string>();
  for (const t of trips) {
    if (t.start && t.end) nights += Math.max(0, nightsBetween(t.start, t.end));
    for (const s of t.stops ?? []) {
      cities.add((s.place ?? s.name).toLowerCase());
      if (s.countryCode) countries.add(s.countryCode.toUpperCase());
    }
  }

  return {
    year,
    saved: snaps.length,
    ahead,
    kinds,
    weekdays,
    topDay,
    dayPart,
    nightShare: timed ? night / timed : undefined,
    topMonth,
    trips: trips.length,
    nights,
    cities: cities.size,
    countries: [...countries],
  };
}

/** Enough to be worth showing: a few saved events, or a trip. */
export const recapWorthShowing = (r: Recap) => r.saved >= 3 || r.trips >= 1;

/** The year in one line, for sharing. */
export function recapText(r: Recap): string {
  const bits: string[] = [];
  if (r.saved) bits.push(`${r.saved} events saved`);
  if (r.kinds[0]) bits.push(`mostly ${r.kinds[0].name.toLowerCase()}`);
  if (r.topDay) bits.push(`a ${r.topDay} person`);
  if (r.dayPart === "night") bits.push("a night owl");
  if (r.trips) bits.push(`${r.trips} ${r.trips === 1 ? "trip" : "trips"}${r.nights ? `, ${r.nights} nights` : ""}${r.countries.length ? ` in ${r.countries.length} ${r.countries.length === 1 ? "country" : "countries"} ${r.countries.map(flagOf).join("")}` : ""}`);
  return `My ${r.year} on Mundivi: ${bits.join(", ")}.`;
}
