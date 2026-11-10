/**
 * Trip planning: the stops of a trip (any city on Earth) with their dates, how the nights are
 * shared between them, the shortest order to visit them, where an event fits in the trip, a
 * name for it, and ready-made routes ("Benelux"). Pure functions, used by the planner and
 * the trip on the globe.
 */

import { haversineKm } from "./geo";

/** A city on the route, and the nights spent there: from the day of arrival to the day of leaving. */
export interface TripStop {
  id: string;
  name: string;
  country?: string;
  countryCode?: string;
  lat: number;
  lng: number;
  /** The site's own city, when it is one (for its page and its events). */
  cityId?: string;
  from: string; // YYYY-MM-DD, arrival
  to: string; // YYYY-MM-DD, departure (the next stop's arrival)
}

export type Place = Omit<TripStop, "id" | "from" | "to">;

const DAY = 86_400_000;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const at = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function addDays(d: string, n: number): string {
  return ymd(at(d) + n * DAY);
}

/** Nights between two dates (YYYY-MM-DD); 0 for the same day. */
export function nightsBetween(from: string, to: string): number {
  return Math.max(0, Math.round((at(to) - at(from)) / DAY));
}

/** Each day of a trip, from the first to the last (both included). */
export function daysOf(start: string, end: string): string[] {
  const n = nightsBetween(start, end);
  return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

/**
 * Shares a trip's nights between its stops, as evenly as they go (the first stops get any
 * extra night), each stop at least one night when there are enough. Returns each stop's
 * arrival and departure: one stop leaves the day the next one arrives.
 */
export function splitNights(start: string, end: string, count: number): { from: string; to: string }[] {
  if (count <= 0) return [];
  const total = nightsBetween(start, end);
  const base = Math.floor(total / count);
  const extra = total % count;
  const out: { from: string; to: string }[] = [];
  let day = start;
  for (let i = 0; i < count; i++) {
    const n = base + (i < extra ? 1 : 0);
    const to = addDays(day, n);
    out.push({ from: day, to });
    day = to;
  }
  return out;
}

/** The stops with their nights as given (an array of counts), from the trip's start. */
export function withNights<T extends { from: string; to: string }>(stops: T[], start: string, nights: number[]): T[] {
  let day = start;
  return stops.map((s, i) => {
    const to = addDays(day, Math.max(0, nights[i] ?? 0));
    const out = { ...s, from: day, to };
    day = to;
    return out;
  });
}

/**
 * Moves the boundary after stop `i` by `delta` nights: stop i gets longer, stop i + 1 shorter
 * (or the reverse), never below one night each (or zero when a stop already has none).
 */
export function moveBoundary(nights: number[], i: number, delta: number): number[] {
  if (i < 0 || i >= nights.length - 1 || !delta) return nights;
  const out = [...nights];
  const min = (n: number) => Math.min(1, n);
  const d = delta > 0 ? Math.min(delta, out[i + 1] - min(nights[i + 1])) : -Math.min(-delta, out[i] - min(nights[i]));
  out[i] += d;
  out[i + 1] -= d;
  return out;
}

/** Total length of a route in km, in the order given. */
export function routeKm(stops: { lat: number; lng: number }[]): number {
  let km = 0;
  for (let i = 1; i < stops.length; i++) km += haversineKm(stops[i - 1].lat, stops[i - 1].lng, stops[i].lat, stops[i].lng);
  return km;
}

/**
 * The shortest order to visit the stops, starting from the first (where the trip begins):
 * nearest-next, then improved by reversing stretches while that shortens it (2-opt).
 */
export function bestOrder<T extends { lat: number; lng: number }>(stops: T[]): T[] {
  if (stops.length < 3) return stops;
  const left = stops.slice(1);
  const out = [stops[0]];
  while (left.length) {
    const last = out[out.length - 1];
    let k = 0;
    for (let j = 1; j < left.length; j++) if (haversineKm(last.lat, last.lng, left[j].lat, left[j].lng) < haversineKm(last.lat, last.lng, left[k].lat, left[k].lng)) k = j;
    out.push(left.splice(k, 1)[0]);
  }
  let better = true;
  for (let round = 0; better && round < 50; round++) {
    better = false;
    for (let i = 1; i < out.length - 1; i++)
      for (let j = i + 1; j < out.length; j++) {
        const next = [...out.slice(0, i), ...out.slice(i, j + 1).reverse(), ...out.slice(j + 1)];
        if (routeKm(next) + 1e-6 < routeKm(out)) {
          out.splice(0, out.length, ...next);
          better = true;
        }
      }
  }
  return out;
}

/** How near a stop an event must be to count as part of it. */
export const STOP_RADIUS_KM = 60;

export type Fit =
  | { ok: true; stop: TripStop }
  | { ok: false; why: "before" | "after" | "elsewhere" | "wrong-days"; stop?: TripStop };

/**
 * Where an event fits in a trip: the stop it is near on a day spent there. When it doesn't,
 * why: before the trip, after it, nowhere near the route, or near a stop on another day.
 */
export function fitOf(stops: TripStop[], e: { lat: number; lng: number; day: string }): Fit {
  if (!stops.length) return { ok: false, why: "elsewhere" };
  const start = stops[0].from;
  const end = stops[stops.length - 1].to;
  // A stop's days run from arrival to departure (both, as travel days).
  const near = stops.filter((s) => haversineKm(s.lat, s.lng, e.lat, e.lng) <= STOP_RADIUS_KM);
  const on = near.find((s) => e.day >= s.from && e.day <= s.to);
  if (on) return { ok: true, stop: on };
  if (e.day < start) return { ok: false, why: "before", stop: near[0] };
  if (e.day > end) return { ok: false, why: "after", stop: near[0] };
  return near.length ? { ok: false, why: "wrong-days", stop: near[0] } : { ok: false, why: "elsewhere" };
}

/**
 * Where an event that runs for days (an exhibition, a festival, a season) fits: on any of its
 * days spent near it. Single-day events fit as `fitOf` says.
 */
export function fitSpan(stops: TripStop[], e: { lat: number; lng: number; day: string; until?: string }): Fit {
  const f = fitOf(stops, e);
  if (f.ok || !stops.length || !e.until || e.until <= e.day) return f;
  const near = stops.filter((s) => haversineKm(s.lat, s.lng, e.lat, e.lng) <= STOP_RADIUS_KM);
  const on = near.find((s) => s.from <= e.until! && s.to >= e.day);
  if (on) return { ok: true, stop: on };
  if (e.until < stops[0].from) return { ok: false, why: "before", stop: near[0] };
  if (e.day > stops[stops.length - 1].to) return { ok: false, why: "after", stop: near[0] };
  return near.length ? { ok: false, why: "wrong-days", stop: near[0] } : { ok: false, why: "elsewhere" };
}

/** The stop for a day of the trip (the one arrived at, on a travel day). */
export function stopOn(stops: TripStop[], day: string): TripStop | undefined {
  return [...stops].reverse().find((s) => day >= s.from && day <= s.to);
}

/** A flag from a country code (regional indicator letters). */
export function flagOf(cc?: string): string {
  if (!cc || !/^[A-Za-z]{2}$/.test(cc)) return "";
  return String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** A three-letter code for a place, boarding-pass style. */
export function codeOf(name: string): string {
  return name.normalize("NFD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase() || "???";
}

/** Regions a trip can be named after: when every country on it belongs (and at least `min` do). */
const GROUPS: { name: string; codes: string[]; min: number }[] = [
  { name: "Benelux", codes: ["NL", "BE", "LU"], min: 2 },
  { name: "Iberia", codes: ["PT", "ES"], min: 2 },
  { name: "Scandinavia", codes: ["DK", "SE", "NO"], min: 2 },
  { name: "the Nordics", codes: ["DK", "SE", "NO", "FI", "IS"], min: 2 },
  { name: "the Baltics", codes: ["EE", "LV", "LT"], min: 2 },
  { name: "the British Isles", codes: ["GB", "IE"], min: 2 },
  { name: "Central Europe", codes: ["DE", "CZ", "AT", "HU", "PL", "SK", "CH", "SI"], min: 3 },
  { name: "the Balkans", codes: ["SI", "HR", "BA", "RS", "ME", "MK", "AL", "BG", "GR", "XK"], min: 3 },
  { name: "the Mediterranean", codes: ["PT", "ES", "FR", "IT", "MT", "HR", "GR", "CY", "TR", "MA", "TN"], min: 3 },
  { name: "Southeast Asia", codes: ["TH", "VN", "KH", "LA", "MY", "SG", "ID", "PH", "MM"], min: 2 },
];

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A name for a trip from where and when it goes: "Benelux 2027", "Japan, April 2027",
 * "Portugal & Spain 2027", "Tokyo, May 2027".
 */
export function suggestName(stops: Pick<TripStop, "name" | "country" | "countryCode">[], start?: string): string {
  if (!stops.length) return "My trip";
  const when = start ? new Date(`${start}T12:00:00Z`) : null;
  const year = when ? String(when.getUTCFullYear()) : "";
  const month = when ? when.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) : "";
  const codes = [...new Set(stops.map((s) => s.countryCode?.toUpperCase()).filter((c): c is string => !!c))];
  const countries = [...new Map(stops.filter((s) => s.country).map((s) => [s.countryCode ?? s.country, s.country!])).values()];
  if (stops.length === 1) return [stops[0].name, month].filter(Boolean).join(", ");
  if (codes.length === 1 && countries[0]) return [countries[0], month].filter(Boolean).join(", ");
  if (codes.length >= 2) {
    const group = GROUPS.find((g) => codes.length >= g.min && codes.every((c) => g.codes.includes(c)));
    if (group) return [titleCase(group.name), year].filter(Boolean).join(" ");
  }
  if (countries.length === 2) return [`${countries[0]} & ${countries[1]}`, year].filter(Boolean).join(" ");
  if (countries.length > 2) return [`${countries.length} countries`, month].filter(Boolean).join(", ");
  return [`${stops[0].name} to ${stops[stops.length - 1].name}`, year].filter(Boolean).join(" ");
}

/** Ready-made routes to start from, in a sensible order. */
export const REGIONS: { id: string; name: string; emoji: string; places: Place[] }[] = [
  {
    id: "benelux", name: "Benelux", emoji: "🌷", places: [
      { name: "Amsterdam", country: "Netherlands", countryCode: "NL", lat: 52.3676, lng: 4.9041, cityId: "amsterdam" },
      { name: "Brussels", country: "Belgium", countryCode: "BE", lat: 50.8503, lng: 4.3517, cityId: "brussels" },
      { name: "Luxembourg", country: "Luxembourg", countryCode: "LU", lat: 49.6113, lng: 6.1298 },
    ],
  },
  {
    id: "iberia", name: "Iberia", emoji: "☀️", places: [
      { name: "Lisbon", country: "Portugal", countryCode: "PT", lat: 38.7223, lng: -9.1393, cityId: "lisbon" },
      { name: "Porto", country: "Portugal", countryCode: "PT", lat: 41.1579, lng: -8.6291, cityId: "porto" },
      { name: "Madrid", country: "Spain", countryCode: "ES", lat: 40.4168, lng: -3.7038, cityId: "madrid" },
      { name: "Barcelona", country: "Spain", countryCode: "ES", lat: 41.3874, lng: 2.1686, cityId: "barcelona" },
    ],
  },
  {
    id: "italy", name: "Italy", emoji: "🍝", places: [
      { name: "Milan", country: "Italy", countryCode: "IT", lat: 45.4642, lng: 9.19, cityId: "milan" },
      { name: "Venice", country: "Italy", countryCode: "IT", lat: 45.4408, lng: 12.3155, cityId: "venice" },
      { name: "Florence", country: "Italy", countryCode: "IT", lat: 43.7696, lng: 11.2558 },
      { name: "Rome", country: "Italy", countryCode: "IT", lat: 41.9028, lng: 12.4964, cityId: "rome" },
    ],
  },
  {
    id: "central", name: "Central Europe", emoji: "🏰", places: [
      { name: "Berlin", country: "Germany", countryCode: "DE", lat: 52.52, lng: 13.405, cityId: "berlin" },
      { name: "Prague", country: "Czechia", countryCode: "CZ", lat: 50.0755, lng: 14.4378, cityId: "prague" },
      { name: "Vienna", country: "Austria", countryCode: "AT", lat: 48.2082, lng: 16.3738, cityId: "vienna" },
      { name: "Budapest", country: "Hungary", countryCode: "HU", lat: 47.4979, lng: 19.0402, cityId: "budapest" },
    ],
  },
  {
    id: "scandinavia", name: "Scandinavia", emoji: "🌌", places: [
      { name: "Copenhagen", country: "Denmark", countryCode: "DK", lat: 55.6761, lng: 12.5683, cityId: "copenhagen" },
      { name: "Stockholm", country: "Sweden", countryCode: "SE", lat: 59.3293, lng: 18.0686, cityId: "stockholm" },
      { name: "Oslo", country: "Norway", countryCode: "NO", lat: 59.9139, lng: 10.7522, cityId: "oslo" },
    ],
  },
  {
    id: "isles", name: "British Isles", emoji: "☘️", places: [
      { name: "London", country: "United Kingdom", countryCode: "GB", lat: 51.5072, lng: -0.1276, cityId: "london" },
      { name: "Edinburgh", country: "United Kingdom", countryCode: "GB", lat: 55.9533, lng: -3.1883, cityId: "edinburgh" },
      { name: "Dublin", country: "Ireland", countryCode: "IE", lat: 53.3498, lng: -6.2603, cityId: "dublin" },
    ],
  },
  {
    id: "japan", name: "Japan", emoji: "🗻", places: [
      { name: "Tokyo", country: "Japan", countryCode: "JP", lat: 35.6762, lng: 139.6503, cityId: "tokyo" },
      { name: "Kyoto", country: "Japan", countryCode: "JP", lat: 35.0116, lng: 135.7681 },
      { name: "Osaka", country: "Japan", countryCode: "JP", lat: 34.6937, lng: 135.5023, cityId: "osaka" },
    ],
  },
  {
    id: "california", name: "California", emoji: "🌉", places: [
      { name: "San Francisco", country: "United States", countryCode: "US", lat: 37.7749, lng: -122.4194, cityId: "san-francisco" },
      { name: "Los Angeles", country: "United States", countryCode: "US", lat: 34.0522, lng: -118.2437, cityId: "los-angeles" },
      { name: "San Diego", country: "United States", countryCode: "US", lat: 32.7157, lng: -117.1611 },
    ],
  },
  {
    id: "east-coast", name: "US East Coast", emoji: "🗽", places: [
      { name: "Boston", country: "United States", countryCode: "US", lat: 42.3601, lng: -71.0589, cityId: "boston" },
      { name: "New York", country: "United States", countryCode: "US", lat: 40.7128, lng: -74.006, cityId: "new-york" },
      { name: "Washington", country: "United States", countryCode: "US", lat: 38.9072, lng: -77.0369 },
    ],
  },
  {
    id: "sea", name: "Southeast Asia", emoji: "🌴", places: [
      { name: "Bangkok", country: "Thailand", countryCode: "TH", lat: 13.7563, lng: 100.5018, cityId: "bangkok" },
      { name: "Singapore", country: "Singapore", countryCode: "SG", lat: 1.3521, lng: 103.8198, cityId: "singapore" },
      { name: "Bali", country: "Indonesia", countryCode: "ID", lat: -8.6705, lng: 115.2126 },
    ],
  },
];

/** The colour of each stop on the timeline and the globe, in route order. */
export const STOP_COLORS = ["#1463FF", "#F0475A", "#0FA979", "#F59A0B", "#7B4DFF", "#0A9BD6", "#E0398C", "#2F9E44", "#E8890C", "#6F819C"];
export const stopColor = (i: number) => STOP_COLORS[i % STOP_COLORS.length];

/**
 * How a trip could stretch to take in an event just outside it: the last city kept a few days
 * longer (or the first started earlier), or, when the event is somewhere else, that place as a
 * new city at the end (or start) of the route. Null when the event is within the trip's dates
 * (it is then a matter of the route, not the dates).
 */
export function extendFor(stops: TripStop[], e: { lat: number; lng: number; day: string; place: Place }): { stops: TripStop[]; label: string } | null {
  if (!stops.length) return null;
  const first = stops[0];
  const last = stops[stops.length - 1];
  const near = (s: TripStop) => haversineKm(s.lat, s.lng, e.lat, e.lng) <= STOP_RADIUS_KM;
  const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  if (e.day > last.to) {
    if (near(last)) return { stops: [...stops.slice(0, -1), { ...last, to: e.day }], label: `Stay in ${last.name} until ${day(e.day)}` };
    const to = addDays(e.day, 1);
    return { stops: [...stops, { ...e.place, id: `x${e.day}${Math.round(e.lat * 1e3)}`, from: last.to, to }], label: `Add ${e.place.name} after ${last.name}, until ${day(to)}` };
  }
  if (e.day < first.from) {
    if (near(first)) return { stops: [{ ...first, from: e.day }, ...stops.slice(1)], label: `Arrive in ${first.name} on ${day(e.day)}` };
    return { stops: [{ ...e.place, id: `x${e.day}${Math.round(e.lat * 1e3)}`, from: e.day, to: first.from }, ...stops], label: `Start in ${e.place.name} on ${day(e.day)}` };
  }
  return null;
}
