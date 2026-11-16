/**
 * Trip ideas without end: routes made from the places people travel to, around a theme (the
 * sea, mountains, wine, old towns…), in one country or across a few, for a weekend, a week or
 * longer. The same seed and number always make the same idea, so a list can be paged forever
 * and an idea's address always opens the same trip.
 */
import { PLACE_ROWS, type PlaceRow } from "./places";
import { bestOrder } from "../trip";
import { routeParam } from "./route-param";

export { parseRouteParam, routeParam } from "./route-param";

export type ThemeKey = "c" | "s" | "i" | "m" | "l" | "n" | "h" | "f" | "w" | "a" | "x" | "v";

export const THEMES: { key: ThemeKey; label: string; emoji: string; words: string }[] = [
  { key: "s", label: "Sea and beaches", emoji: "🏖️", words: "beaches" },
  { key: "h", label: "Old towns", emoji: "🏛️", words: "history" },
  { key: "m", label: "Mountains", emoji: "🏔️", words: "mountains" },
  { key: "f", label: "Food", emoji: "🍜", words: "good food" },
  { key: "w", label: "Wine", emoji: "🍷", words: "wine" },
  { key: "c", label: "Big cities", emoji: "🏙️", words: "big cities" },
  { key: "i", label: "Islands", emoji: "🏝️", words: "islands" },
  { key: "n", label: "Nature", emoji: "🌿", words: "nature" },
  { key: "l", label: "Lakes", emoji: "🛶", words: "lakes" },
  { key: "a", label: "Art", emoji: "🎨", words: "art" },
  { key: "x", label: "Nights out", emoji: "🎶", words: "nights out" },
  { key: "v", label: "Small towns", emoji: "🏘️", words: "small towns" },
];
const THEME = new Map(THEMES.map((t) => [t.key, t]));

export type Area = "europe" | "asia" | "africa" | "north-america" | "latin-america" | "oceania";
export const AREAS: { key: Area; label: string; emoji: string }[] = [
  { key: "europe", label: "Europe", emoji: "🏰" },
  { key: "asia", label: "Asia", emoji: "🏯" },
  { key: "africa", label: "Africa and the Middle East", emoji: "🐪" },
  { key: "north-america", label: "North America", emoji: "🗽" },
  { key: "latin-america", label: "Latin America", emoji: "🌮" },
  { key: "oceania", label: "Oceania", emoji: "🦘" },
];
const AREA_OF: Record<string, Area> = {};
const put = (a: Area, ccs: string) => ccs.split(" ").forEach((cc) => (AREA_OF[cc] = a));
put("europe", "PT ES FR MC IT CH AT DE NL BE LU GB IE DK SE NO FI IS EE LV LT PL CZ SK HU SI HR BA ME RS AL MK GR CY MT RO BG TR GE AM");
put("asia", "JP KR CN HK MO TW MN VN KH LA TH MM MY SG ID PH IN NP LK MV BT UZ KZ");
put("africa", "MA EG TN JO IL AE OM QA ZA KE TZ RW UG NA BW ZM ZW MG MU SC GH SN NG ET");
put("north-america", "US CA");
put("latin-america", "MX GT BZ CR PA NI CU DO PR JM BS BB CO PE EC BO CL AR UY BR");
put("oceania", "AU NZ FJ PF");

export type Length = "weekend" | "week" | "long";
export const LENGTHS: { key: Length; label: string }[] = [
  { key: "weekend", label: "A weekend" },
  { key: "week", label: "About a week" },
  { key: "long", label: "Two weeks or more" },
];

export interface TravelPlace {
  /** Its place in the list (what an idea's key is made of). */
  n: number;
  name: string;
  cc: string;
  lat: number;
  lng: number;
  themes: string;
  size: PlaceRow[5];
  region: string;
  cityId?: string;
  area: Area;
}

export const PLACES: TravelPlace[] = PLACE_ROWS.map(([name, cc, lat, lng, themes, size, region, cityId], n) => ({ n, name, cc, lat, lng, themes, size, region, cityId: cityId || undefined, area: AREA_OF[cc] ?? "europe" }));

export interface IdeaStop {
  place: TravelPlace;
  nights: number;
}
export interface TripIdea {
  /** The stops and their nights, as short as it gets: the idea's address. */
  key: string;
  title: string;
  emoji: string;
  theme: ThemeKey;
  stops: IdeaStop[];
  nights: number;
  km: number;
  countries: string[];
  /** What it's good for, in a few words ("beaches, old towns and good food"). */
  about: string;
}

export interface IdeaFilter {
  theme?: ThemeKey;
  area?: Area;
  /** Places in this country. */
  cc?: string;
  /** Starting near here (within a day's travel). */
  near?: { lat: number; lng: number };
  length?: Length;
}

// ---- Small helpers ---------------------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A seeded random number generator (mulberry32). */
function rngOf(seed: number) {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180;
  const dl = (b.lat - a.lat) * r;
  const dn = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
let names: Intl.DisplayNames | undefined;
export function countryName(cc: string): string {
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(cc) ?? cc;
  } catch {
    return cc;
  }
}
const pickOf = <T,>(rng: () => number, list: T[]): T => list[Math.floor(rng() * list.length)];
function weighted<T>(rng: () => number, list: T[], w: (x: T) => number): T {
  const total = list.reduce((n, x) => n + w(x), 0);
  let r = rng() * total;
  for (const x of list) if ((r -= w(x)) < 0) return x;
  return list[list.length - 1];
}
const joinWords = (w: string[]) => (w.length <= 1 ? (w[0] ?? "") : `${w.slice(0, -1).join(", ")} and ${w[w.length - 1]}`);

// ---- Making one idea ------------------------------------------------------------------------

/** How far a day's travel between stops can go: further where places are far apart. */
function hopKm(p: TravelPlace, theme: ThemeKey): number {
  const wide = p.area === "north-america" || p.area === "oceania" || p.area === "africa" || p.cc === "BR" || p.cc === "AR" || p.cc === "CL" || p.cc === "CN" || p.cc === "IN";
  return (wide ? 650 : 380) * (theme === "i" ? 1.6 : 1);
}

const LENGTH_SHAPE: Record<Length, { stops: [number, number]; nights: [number, number] }> = {
  weekend: { stops: [1, 2], nights: [2, 3] },
  week: { stops: [2, 4], nights: [5, 8] },
  long: { stops: [4, 7], nights: [11, 16] },
};

function inFilter(p: TravelPlace, f: IdeaFilter): boolean {
  if (f.area && p.area !== f.area) return false;
  if (f.cc && p.cc !== f.cc) return false;
  return true;
}

/** Nights shared out, more in big places, at least one each. */
export function shareNights(sizes: number[], total: number): number[] {
  const w = sizes.map((s) => 1 + s * 0.45);
  const sum = w.reduce((a, b) => a + b, 0);
  const out = w.map((x) => Math.max(1, Math.round((x / sum) * total)));
  // Even out the rounding on the biggest stop.
  let diff = total - out.reduce((a, b) => a + b, 0);
  const order = sizes.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
  for (let k = 0; diff !== 0 && k < 50; k++) {
    const i = order[k % order.length];
    if (diff > 0) {
      out[i]++;
      diff--;
    } else if (out[i] > 1) {
      out[i]--;
      diff++;
    }
  }
  return out;
}

/** The idea for this seed and number, or nothing when the filter leaves too little to make one. */
export function makeIdea(seed: string, k: number, f: IdeaFilter = {}): TripIdea | null {
  const rng = rngOf(hash(`${seed}:${k}:${f.theme ?? ""}${f.area ?? ""}${f.cc ?? ""}${f.length ?? ""}`));
  const nearOk = (p: TravelPlace) => !f.near || kmBetween(f.near, p) <= 700;
  const scope = PLACES.filter((p) => inFilter(p, f) && nearOk(p));
  if (!scope.length) return null;
  // A theme the places in scope have.
  const themes = f.theme ? [f.theme] : THEMES.map((t) => t.key).filter((t) => scope.some((p) => p.themes.includes(t)));
  if (!themes.length) return null;
  const theme = pickOf(rng, themes);
  const pool = scope.filter((p) => p.themes.includes(theme));
  if (!pool.length) return null;
  const length: Length = f.length ?? (rng() < 0.2 ? "weekend" : rng() < 0.65 ? "week" : "long");
  const shape = LENGTH_SHAPE[length];
  const want = shape.stops[0] + Math.floor(rng() * (shape.stops[1] - shape.stops[0] + 1));
  // Start somewhere that has the theme (near the asked-for place first, if any).
  const starts = f.near ? [...pool].sort((a, b) => kmBetween(f.near!, a) - kmBetween(f.near!, b)).slice(0, 6) : pool;
  // Better-known places start more ideas (a big city four times as often as a village).
  const anchor = weighted(rng, starts, (p) => 1 + p.size);
  const route: TravelPlace[] = [anchor];
  const used = new Set([anchor.n]);
  // Grow from either end, preferring places with the theme, near, and a bit of chance.
  while (route.length < want) {
    let best: { p: TravelPlace; end: 0 | 1; score: number } | null = null;
    for (const end of [0, 1] as const) {
      const at = end ? route[route.length - 1] : route[0];
      const max = hopKm(at, theme);
      for (const p of scope) {
        if (used.has(p.n) || p.area !== anchor.area || apart(p.cc, at.cc)) continue;
        const d = kmBetween(at, p);
        if (d > max || d < 8) continue;
        const shared = [...p.themes].filter((t) => anchor.themes.includes(t)).length;
        const score = (p.themes.includes(theme) ? 3 : 0) + shared * 0.35 + rng() * 2.2 - (d / max) * 1.6 + (p.cc === anchor.cc ? 0.4 : 0);
        if (!best || score > best.score) best = { p, end, score };
      }
    }
    if (!best) break;
    used.add(best.p.n);
    if (best.end) route.push(best.p);
    else route.unshift(best.p);
  }
  if (route.length < shape.stops[0]) return null;
  // The shortest way through them, starting wherever makes it shortest.
  const ordered = shortest(route);
  route.splice(0, route.length, ...ordered);
  const total = Math.max(route.length, shape.nights[0] + Math.floor(rng() * (shape.nights[1] - shape.nights[0] + 1)));
  const nights = shareNights(route.map((p) => p.size), total);
  return ideaOf(route.map((place, i) => ({ place, nights: nights[i] })), theme, rng);
}

const pathKm = (r: TravelPlace[]) => r.reduce((n, p, i) => (i ? n + kmBetween(r[i - 1], p) : 0), 0);
function shortest(route: TravelPlace[]): TravelPlace[] {
  if (route.length < 3) return route;
  let best = route;
  for (let i = 0; i < route.length; i++) {
    const r = bestOrder([route[i], ...route.filter((_, j) => j !== i)]);
    if (pathKm(r) < pathKm(best) - 1e-6) best = r;
  }
  return best;
}

// Borders that are closed or hard to cross over land.
const APART = new Set(["AM-TR", "CN-IN"]);
const apart = (a: string, b: string) => APART.has(a < b ? `${a}-${b}` : `${b}-${a}`);

/** An idea from its stops: its key, name, countries, length and what it's good for. */
export function ideaOf(stops: IdeaStop[], theme: ThemeKey, rng: () => number = rngOf(hash(stops.map((s) => s.place.n).join()))): TripIdea {
  const places = stops.map((s) => s.place);
  const countries = [...new Set(places.map((p) => p.cc))];
  let km = 0;
  for (let i = 1; i < places.length; i++) km += kmBetween(places[i - 1], places[i]);
  // What the stops are known for, the idea's own theme first.
  const counts = new Map<string, number>();
  for (const p of places) for (const t of p.themes) counts.set(t, (counts.get(t) ?? 0) + 1);
  const top = [theme, ...[...counts.entries()].filter(([t]) => t !== theme).sort((a, b) => b[1] - a[1]).map(([t]) => t)].slice(0, 3) as ThemeKey[];
  const about = joinWords(top.map((t) => THEME.get(t)?.words ?? "")).replace(/^./, (c) => c.toUpperCase());
  const title = titleOf(places, theme, countries, rng);
  const emoji = countries.length === 1 && rng() < 0.5 ? flag(countries[0]) : (THEME.get(theme)?.emoji ?? "✈️");
  return {
    key: `${stops.map((s) => `${s.place.n.toString(36)}.${s.nights}`).join("-")}~${theme}`,
    title,
    emoji,
    theme,
    stops,
    nights: stops.reduce((n, s) => n + s.nights, 0),
    km: Math.round(km),
    countries,
    about,
  };
}

const flag = (cc: string) => String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

// Countries said with "the" in a sentence.
const THE = new Set(["PH", "NL", "US", "GB", "BS", "MV", "AE", "DO", "SC", "CZ"]);
const said = (cc: string) => (THE.has(cc) ? `the ${countryName(cc)}` : countryName(cc));

const TITLES: Record<ThemeKey, string[]> = {
  s: ["{C} by the sea", "Coastal {C}", "Sun and sea in {C}", "The {R} coast"],
  h: ["Old towns of {C}", "{C}, through the ages", "History trail: {A} to {B}"],
  m: ["{C}'s mountains", "Peaks and valleys of {C}", "High {R}"],
  f: ["Eat your way through {C}", "A taste of {C}", "{A} to {B}, hungry"],
  w: ["{C} wine country", "Vineyards of {R}", "A glass in {A}, a glass in {B}"],
  c: ["Big cities of {C}", "{A}, {B} and more", "City hopping in {C}"],
  i: ["{C} island hop", "Islands of {C}", "Island time: {A} to {B}"],
  n: ["Wild {C}", "The great outdoors of {C}", "Into nature: {A} to {B}"],
  l: ["Lakes of {C}", "Lakeside {R}", "By the water: {A} to {B}"],
  a: ["Art and museums of {C}", "Masterpieces: {A} to {B}", "An artful {C}"],
  x: ["Nights out in {C}", "{A} after dark", "Dance across {C}"],
  v: ["Little towns of {C}", "Slow travel in {R}", "Villages of {C}"],
};

function titleOf(places: TravelPlace[], theme: ThemeKey, countries: string[], rng: () => number): string {
  const [a, b] = [places[0], places[places.length - 1]];
  const region = places.every((p) => p.region && p.region === a.region) && a.region.length <= 22 ? a.region : "";
  const C = countries.length === 1 ? said(countries[0]) : countries.length === 2 ? `${said(countries[0])} and ${said(countries[1])}` : `${countries.length} countries`;
  if (places.length === 1) return pickOf(rng, [`A weekend in ${a.name}`, `${a.name}, slowly`, `Just ${a.name}`]);
  const fits = TITLES[theme].filter((t) => (!t.includes("{R}") || region) && (!t.includes("{A}") || a !== b) && (!t.includes("and more") || places.length > 2));
  let t = pickOf(rng, fits.length ? fits : [`${a.name} to ${b.name}`]);
  // Across many countries, the places say it better.
  if (countries.length > 2 && t.includes("{C}")) t = `${a.name} to ${b.name}, across ${C}`;
  const out = t
    .replace("{C}'s", /s$/.test(C) ? `${C}'` : `${C}'s`)
    .replace("{C}", C)
    .replace("{R}", region)
    .replace("{A}", a.name)
    .replace("{B}", b.name);
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** The idea an address names (its key), or nothing if it doesn't make sense. */
export function ideaFromKey(key: string): TripIdea | null {
  const [list, theme] = key.split("~");
  if (!list || !THEME.has(theme as ThemeKey)) return null;
  const stops: IdeaStop[] = [];
  for (const part of list.split("-").slice(0, 12)) {
    const [n, nights] = part.split(".");
    const place = PLACES[parseInt(n, 36)];
    const k = Number(nights);
    if (!place || !Number.isInteger(k) || k < 0 || k > 60) return null;
    stops.push({ place, nights: k });
  }
  return stops.length ? ideaOf(stops, theme as ThemeKey) : null;
}

/**
 * A page of ideas: `count` new ones after those already shown (their keys in `seen`), as many as
 * the filter allows. An empty page means the filter has run out of new ideas.
 */
export function ideasPage(seed: string, from: number, count: number, f: IdeaFilter = {}, seen: Set<string> = new Set()): { ideas: TripIdea[]; next: number } {
  const ideas: TripIdea[] = [];
  const routes = new Set([...seen].map((k) => routeOf(k)));
  let k = from;
  // Each try is cheap; a narrow filter gives up after a while instead of looping for ever.
  for (let tries = 0; ideas.length < count && tries < count * 25; tries++, k++) {
    const idea = makeIdea(seed, k, f);
    if (!idea) continue;
    const r = routeOf(idea.key);
    if (routes.has(r)) continue;
    routes.add(r);
    ideas.push(idea);
  }
  return { ideas, next: k };
}
/** The same places in any order (and any nights) make the same route. */
const routeOf = (key: string) => key.split("~")[0].split("-").map((p) => p.split(".")[0]).sort().join(",");

/** Places for the "ideas around…" search: by name or country. */
export function findPlaces(q: string, max = 8): TravelPlace[] {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = n(q.trim());
  if (t.length < 2) return [];
  const hits = PLACES.filter((p) => n(p.name).startsWith(t) || n(p.name).includes(` ${t}`));
  return hits.sort((a, b) => b.size - a.size).slice(0, max);
}
/** Countries with places, for the "ideas in…" search. */
export function findCountries(q: string, max = 5): { cc: string; name: string; places: number }[] {
  const n = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const t = n(q.trim());
  if (t.length < 2) return [];
  const by = new Map<string, number>();
  for (const p of PLACES) by.set(p.cc, (by.get(p.cc) ?? 0) + 1);
  return [...by.entries()]
    .map(([cc, places]) => ({ cc, name: countryName(cc), places }))
    .filter((c) => n(c.name).startsWith(t) || n(c.name).includes(` ${t}`))
    .sort((a, b) => b.places - a.places)
    .slice(0, max);
}

/** The planner's address for an idea. */
export function planHref(idea: Pick<TripIdea, "stops" | "title" | "emoji">): string {
  const q = new URLSearchParams({
    route: routeParam(idea.stops.map((s) => ({ name: s.place.name, cc: s.place.cc, lat: s.place.lat, lng: s.place.lng, nights: s.nights, cityId: s.place.cityId }))),
    name: idea.title,
    emoji: idea.emoji,
  });
  return `/trips/new?${q}`;
}
