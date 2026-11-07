/**
 * Mixtape: a night or a weekend in one city, planned as a tape of "tracks" (events) in time
 * order. The planner picks events that fit the vibe (energy, budget, how far you'll go and
 * moods), never overlap (allowing time to get from one to the next), spread over the days and
 * the parts of each day, and vary in kind. Locked tracks stay put; everything else can be
 * shuffled, one track or all at once. Pure functions, run in the browser so every shuffle is
 * instant; the server only sends the pool of candidates.
 */
import { haversineKm } from "../geo";
import { tzOffsetMs } from "../time";

/** An event that could go on the tape, with its times inside the tape's window. */
export interface MixCandidate {
  id: string;
  slug: string;
  title: string;
  /** Top-level category group and the most specific category. */
  group: string;
  cat: string;
  venue: string;
  lat: number;
  lng: number;
  img?: string;
  hue?: number;
  free: boolean;
  /** Cheapest known ticket, in the city's currency. */
  price?: number;
  family?: boolean;
  pick?: boolean;
  demo?: boolean;
  /** Performances with a start time: [start, end] (ms). */
  times?: [number, number][];
  /** Drop-in windows (an exhibition's day, an attraction's opening hours): [open, close] (ms). */
  open?: [number, number][];
  /** Only the dates are known: the times in `open` are a guess. */
  loose?: boolean;
  /** A run over weeks or months (until then): which days it's on may vary. */
  until?: number;
}

/** A track on the tape: which event, and when. */
export interface Track {
  id: string;
  start: number;
  end: number;
  /** A drop-in: the time is our suggestion, not a performance. */
  flex?: boolean;
  locked?: boolean;
}

export interface Vibe {
  /** 0 slow … 4 loud. */
  energy: number;
  /** 0 free only, 1 cheap, 2 mid-range, 3 treat yourself. */
  budget: number;
  /** 0 walkable, 1 short hops, 2 the whole city. */
  range: number;
  /** Mood ids (see MOODS); none means anything goes. */
  moods: string[];
}

export const DEFAULT_VIBE: Vibe = { energy: 2, budget: 2, range: 1, moods: [] };

export const ENERGY = [
  { label: "Slow & dreamy", short: "Slow", emoji: "🌙" },
  { label: "Easy-going", short: "Easy", emoji: "🍃" },
  { label: "A bit of both", short: "Balanced", emoji: "✨" },
  { label: "Lively", short: "Lively", emoji: "💃" },
  { label: "Turn it up", short: "Loud", emoji: "🔥" },
] as const;

/** Budget caps per ticket, in euros (converted to the city's currency where it differs). */
export const BUDGET = [
  { label: "Free only", short: "Free", emoji: "🆓", capEur: 0 },
  { label: "Cheap", short: "Cheap", emoji: "🪙", capEur: 15 },
  { label: "Mid-range", short: "Mid", emoji: "💳", capEur: 40 },
  { label: "Treat yourself", short: "Treat", emoji: "💎", capEur: Infinity },
] as const;

/** How far one track may be from the one before, in km (the first: from the city centre). */
export const RANGE = [
  { label: "Walkable", short: "Walk", emoji: "🚶", km: 1.6, firstKm: 6 },
  { label: "Short hops", short: "Hops", emoji: "🚲", km: 4, firstKm: 12 },
  { label: "Whole city", short: "City", emoji: "🚕", km: 25, firstKm: 35 },
] as const;

export const MOODS = [
  { id: "music", label: "Music", emoji: "🎵", groups: ["music"] },
  { id: "night", label: "Nightlife", emoji: "🪩", groups: ["nightlife"] },
  { id: "stage", label: "Stage & screen", emoji: "🎭", groups: ["theatre", "comedy", "cinema"] },
  { id: "art", label: "Art & museums", emoji: "🖼️", groups: ["exhibitions", "culture", "fashion"] },
  { id: "food", label: "Food & fests", emoji: "🍷", groups: ["food-drink", "festivals"] },
  { id: "sports", label: "Sports", emoji: "⚽", groups: ["sports"] },
  { id: "outdoors", label: "Out & about", emoji: "🌳", groups: ["outdoor", "attractions"] },
  { id: "family", label: "With kids", emoji: "🧸", groups: ["family"] },
] as const;

// How lively each kind of event is (0 calm … 1 loud), by category then by group.
const CAT_ENERGY: Record<string, number> = {
  electronic: 0.95, "rock-metal": 0.95, "hip-hop": 0.9, "dj-sets": 0.95, "music-festivals": 0.9, pop: 0.8, indie: 0.7, tribute: 0.65,
  concerts: 0.7, jazz: 0.45, acoustic: 0.35, classical: 0.2, opera: 0.25, "music-awards": 0.6,
};
const GROUP_ENERGY: Record<string, number> = {
  nightlife: 1, festivals: 0.85, sports: 0.8, music: 0.7, comedy: 0.6, "food-drink": 0.55, fashion: 0.55, outdoor: 0.5,
  culture: 0.45, attractions: 0.45, theatre: 0.4, family: 0.35, cinema: 0.3, technology: 0.2, education: 0.2, conferences: 0.15, exhibitions: 0.15, other: 0.4,
};
/** Talks, classes and trade fairs: real events, but rarely what a night out is made of. */
const WORKY = new Set(["conferences", "technology", "education"]);
/** Kinds of event that go on late into the night. */
const LATE = new Set(["nightlife", "music", "festivals"]);
/** Kinds of event you drop in on: a long run of these is open most days. */
const DROP_IN = new Set(["exhibitions", "culture", "attractions", "outdoor", "food-drink", "festivals", "fashion"]);

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Minutes past local midnight. */
export function localMinutes(t: number, tz: string): number {
  return Math.floor((((t + tzOffsetMs(t, tz)) % DAY) + DAY) % DAY / MIN);
}

/** The night a moment belongs to: until 05:00 it is still the evening before. */
export function tapeDay(t: number, tz: string): number {
  return Math.floor((t - 5 * HOUR + tzOffsetMs(t, tz)) / DAY);
}

export type Part = "day" | "eve" | "night";
/** Day (05:00–17:00), evening (17:00–21:00) or night (21:00–05:00). */
export function partOf(t: number, tz: string): Part {
  const m = localMinutes(t, tz);
  return m >= 300 && m < 1020 ? "day" : m >= 1020 && m < 1260 ? "eve" : "night";
}

/** Getting from one place to the next: on foot up to ~2 km, otherwise a ride. */
export function hop(a: { lat: number; lng: number }, b: { lat: number; lng: number }): { km: number; minutes: number; mode: "walk" | "ride" } {
  // Streets aren't straight lines.
  const km = haversineKm(a.lat, a.lng, b.lat, b.lng) * 1.25;
  if (km <= 2.2) return { km, minutes: Math.max(2, Math.round((km / 4.8) * 60)), mode: "walk" };
  return { km, minutes: Math.round(10 + (km / 22) * 60), mode: "ride" };
}

/** How long a drop-in visit lasts. */
function stayFor(c: MixCandidate): number {
  if (c.group === "exhibitions" || c.group === "culture") return 90 * MIN;
  if (c.group === "food-drink" || c.group === "festivals" || c.group === "outdoor") return 150 * MIN;
  return 120 * MIN;
}

/** How lively a track is at the time it's on: late nights are louder, mornings calmer. */
export function energyOf(c: MixCandidate, start: number, tz: string): number {
  const base = CAT_ENERGY[c.cat] ?? GROUP_ENERGY[c.group] ?? 0.4;
  const m = localMinutes(start, tz);
  const shift = m >= 22 * 60 || m < 5 * 60 ? 0.15 : m < 13 * 60 ? -0.1 : 0;
  return Math.max(0, Math.min(1, base + shift));
}

export interface TapeContext {
  tz: string;
  /** The window tracks may start in (ms). */
  from: number;
  to: number;
  vibe: Vibe;
  /** Budget caps per ticket in the city's currency, by budget step. */
  caps: number[];
  centre: { lat: number; lng: number };
}

/** Whether an event fits the budget and the moods at all. */
export function eligible(c: MixCandidate, ctx: TapeContext): boolean {
  const { budget, moods } = ctx.vibe;
  if (budget === 0 && !(c.free || c.price === 0)) return false;
  if (budget > 0 && budget < 3 && !c.free && c.price != null && c.price > ctx.caps[budget]) return false;
  if (moods.length) {
    const ok = moods.some((id) => {
      const m = MOODS.find((x) => x.id === id);
      return !!m && ((m.groups as readonly string[]).includes(c.group) || (id === "family" && !!c.family));
    });
    if (!ok) return false;
  }
  return true;
}

/** The ways an event could fit into the window: its performances, or drop-in slots on a half-hour grid. */
function placements(c: MixCandidate, ctx: TapeContext): { start: number; end: number; flex: boolean }[] {
  const out: { start: number; end: number; flex: boolean }[] = [];
  for (const [a, b] of c.times ?? []) if (a >= ctx.from && a < ctx.to) out.push({ start: a, end: Math.max(b, a + 30 * MIN), flex: false });
  const stay = stayFor(c);
  const late = LATE.has(c.group);
  for (const [o, cl] of c.open ?? []) {
    const lo = Math.ceil(Math.max(o, ctx.from) / (30 * MIN)) * 30 * MIN;
    const hi = Math.min(cl, ctx.to + stay);
    const len = Math.min(stay, hi - lo);
    if (len < 45 * MIN) continue;
    for (let s = lo; s + len <= hi && s < ctx.to && out.length < 120; s += 30 * MIN) {
      // Drop in at a sensible hour: from 9 in the morning, until the evening (or late, for a party).
      const m = localMinutes(s, ctx.tz);
      if (m < 9 * 60 ? !(late && m < 120) : m > 21 * 60 + 30 && !late) continue;
      out.push({ start: s, end: s + len, flex: true });
    }
  }
  return out;
}

/** Room to get there: no overlap with any track, with the trip in between. */
function fits(c: MixCandidate, start: number, end: number, chosen: { c: MixCandidate; t: Track }[]): boolean {
  for (const { c: o, t } of chosen) {
    const gap = (hop(o, c).minutes + 10) * MIN;
    if (start < t.end + gap && t.start < end + gap) return false;
  }
  return true;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export interface FillOptions {
  /** How many tracks the tape should have. */
  n: number;
  random?: () => number;
  /** Shown in an earlier version of the tape: less likely to come back straight away. */
  seen?: Set<string>;
  /** Never these (the track being replaced). */
  avoid?: Set<string>;
  /** Replacing a track: favour the same part of the same day. */
  prefer?: number;
}

/**
 * Fills a tape up to `n` tracks around the ones kept, in time order. Each step picks one
 * event by weighted chance (Efraimidis–Spirakis), weighing how well it fits the vibe, whether
 * it fills a day or part of the day not covered yet, variety, and distance from the tracks so
 * far. Returns fewer tracks when nothing else fits.
 */
export function fillTape(pool: MixCandidate[], ctx: TapeContext, keep: Track[], opts: FillOptions): Track[] {
  const random = opts.random ?? Math.random;
  const byId = new Map(pool.map((c) => [c.id, c]));
  const chosen = keep.map((t) => ({ c: byId.get(t.id)!, t })).filter((x) => !!x.c);
  const used = new Set(chosen.map((x) => x.c.id));
  const titles = new Set(chosen.map((x) => norm(x.c.title)));
  const want = ctx.vibe.energy / 4;
  const range = RANGE[Math.max(0, Math.min(2, ctx.vibe.range))];
  const preferDay = opts.prefer != null ? tapeDay(opts.prefer, ctx.tz) : undefined;
  const preferPart = opts.prefer != null ? partOf(opts.prefer, ctx.tz) : undefined;
  const cands = pool.filter((c) => !opts.avoid?.has(c.id) && eligible(c, ctx));

  while (chosen.length < opts.n) {
    const dayUse = new Map<number, number>();
    const bucketUse = new Map<string, number>();
    const groupUse = new Map<string, number>();
    const venueUse = new Set<string>();
    for (const { c, t } of chosen) {
      const d = tapeDay(t.start, ctx.tz);
      dayUse.set(d, (dayUse.get(d) ?? 0) + 1);
      const b = `${d}|${partOf(t.start, ctx.tz)}`;
      bucketUse.set(b, (bucketUse.get(b) ?? 0) + 1);
      groupUse.set(c.group, (groupUse.get(c.group) ?? 0) + 1);
      venueUse.add(norm(c.venue));
    }
    // The tracks so far in time order, to find a slot's neighbours.
    const inOrder = [...chosen].sort((a, b) => a.t.start - b.t.start);
    const before = (t: number) => {
      let o: (typeof chosen)[number] | undefined;
      for (const x of inOrder) if (x.t.start < t) o = x;
      return o;
    };
    const after = (t: number) => inOrder.find((x) => x.t.start > t);
    let best: { c: MixCandidate; p: { start: number; end: number; flex: boolean }; k: number } | undefined;
    for (const c of cands) {
      if (used.has(c.id) || titles.has(norm(c.title))) continue;
      // What the event brings whatever its time.
      let w = (c.img ? 2.5 : 1) * (c.pick ? 1.5 : 1) * (c.demo ? 0.05 : 1) * (c.loose ? 0.45 : 1) * (WORKY.has(c.group) ? 0.3 : 1) * (c.until && !DROP_IN.has(c.group) ? 0.5 : 1);
      w *= Math.pow(0.4, groupUse.get(c.group) ?? 0) * (venueUse.has(norm(c.venue)) ? 0.25 : 1) * (opts.seen?.has(c.id) ? 0.25 : 1);
      if (ctx.vibe.budget === 3 && c.price != null && c.price > ctx.caps[2]) w *= 1.3;
      if (w < 1e-6) continue;
      // The first track of a day: not too far from the centre.
      const fromCentre = haversineKm(ctx.centre.lat, ctx.centre.lng, c.lat, c.lng);
      const centreFit = fromCentre > range.firstKm ? Math.exp(-(fromCentre - range.firstKm) / (range.firstKm * 0.3)) : 1;
      // Each way it could fit, weighed by its time; one is drawn at random by weight.
      const ps = placements(c, ctx);
      let sum = 0;
      const ws: number[] = [];
      for (const p of ps) {
        if (!fits(c, p.start, p.end, chosen)) {
          ws.push(0);
          continue;
        }
        const day = tapeDay(p.start, ctx.tz);
        const part = partOf(p.start, ctx.tz);
        const e = energyOf(c, p.start, ctx.tz);
        let pw = Math.exp(-((e - want) ** 2) / (2 * 0.22 ** 2)) + 0.04;
        pw *= part === "day" ? 1.25 - want : part === "night" ? 0.45 + want : 1;
        pw *= (bucketUse.get(`${day}|${part}`) ? 0.12 : 1) / (1 + (dayUse.get(day) ?? 0));
        if (preferDay != null) pw *= day === preferDay ? (part === preferPart ? 6 : 2) : 1;
        // How far: the trip from the track before it and to the track after it, that day.
        let near = false;
        for (const o of [before(p.start), after(p.start)]) {
          if (!o || tapeDay(o.t.start, ctx.tz) !== day) continue;
          near = true;
          const d = haversineKm(o.c.lat, o.c.lng, c.lat, c.lng);
          // Nearer is better, and past the range much worse.
          pw *= Math.exp(-d / (range.km * 1.5));
          if (d > range.km) pw *= Math.exp(-(d - range.km) / (range.km * 0.25));
        }
        if (!near) pw *= centreFit;
        // Drop-ins: a suggested time is less of an event than a performance.
        if (p.flex) pw *= 0.8;
        ws.push(pw);
        sum += pw;
      }
      if (!(sum > 0)) continue;
      let r = random() * sum;
      let i = -1;
      for (let j = 0; j < ws.length; j++) {
        if (!ws[j]) continue;
        i = j;
        if ((r -= ws[j]) <= 0) break;
      }
      const total = w * Math.max(...ws);
      const k = Math.pow(random(), 1 / total);
      if (!best || k > best.k) best = { c, p: ps[i], k };
    }
    if (!best) break;
    used.add(best.c.id);
    titles.add(norm(best.c.title));
    chosen.push({ c: best.c, t: { id: best.c.id, start: best.p.start, end: best.p.end, flex: best.p.flex || undefined } });
  }
  return chosen.map((x) => x.t).sort((a, b) => a.start - b.start);
}

/** A new tape: locked tracks stay, everything else is drawn again (avoiding what was just shown). */
export function shuffleTape(pool: MixCandidate[], ctx: TapeContext, tape: Track[], n: number, seen: Set<string>, random?: () => number): Track[] {
  return fillTape(pool, ctx, tape.filter((t) => t.locked), { n, seen, random });
}

/** One track swapped for another at about the same time. */
export function rerollTrack(pool: MixCandidate[], ctx: TapeContext, tape: Track[], index: number, seen: Set<string>, random?: () => number): Track[] {
  const old = tape[index];
  if (!old) return tape;
  const keep = tape.filter((_, i) => i !== index);
  const next = fillTape(pool, ctx, keep, { n: tape.length, seen, avoid: new Set([old.id]), prefer: old.start, random });
  return next.length < tape.length ? tape : next;
}

/** One more track, wherever it fits best. */
export function addTrack(pool: MixCandidate[], ctx: TapeContext, tape: Track[], seen: Set<string>, random?: () => number): Track[] {
  return fillTape(pool, ctx, tape, { n: tape.length + 1, seen, random });
}

export interface TapeStats {
  tracks: number;
  /** Time at the events, in minutes. */
  minutes: number;
  /** Known ticket prices added up (city currency), and how many tracks have no known price. */
  cost: number;
  unpriced: number;
  free: number;
  /** Distance between tracks, in km. */
  km: number;
}

/** Totals for a tape; the distance counts trips within a day (not the way home and back). */
export function tapeStats(tape: Track[], byId: Map<string, MixCandidate>, tz = "UTC"): TapeStats {
  let minutes = 0, cost = 0, unpriced = 0, free = 0, km = 0;
  let prev: MixCandidate | undefined;
  let prevDay: number | undefined;
  for (const t of tape) {
    const c = byId.get(t.id);
    if (!c) continue;
    minutes += Math.round((t.end - t.start) / MIN);
    if (c.free || c.price === 0) free++;
    else if (c.price != null) cost += c.price;
    else unpriced++;
    const day = tapeDay(t.start, tz);
    if (prev && day === prevDay) km += hop(prev, c).km;
    prev = c;
    prevDay = day;
  }
  return { tracks: tape.length, minutes, cost, unpriced, free, km };
}

/** The tape's colour follows its energy: night blue when slow, hot pink-orange when loud. */
export function tapeHue(energy: number): number {
  return [222, 186, 262, 318, 14][Math.max(0, Math.min(4, Math.round(energy)))];
}

const NAMES: string[][] = [
  ["{city}, Unhurried", "Slow Songs for {city}", "Soft Focus {city}", "{city} at Half Speed"],
  ["Easy Days in {city}", "{city}, No Rush", "Sunny Side of {city}", "{city} Daydream"],
  ["The {city} Mix", "A Little Bit of {city}", "{city}, Side A to Side B", "{city} Mixtape Vol. 1"],
  ["{city} Greatest Hits", "Out & About in {city}", "Good Times, {city}", "The {city} Weekender"],
  ["{city} After Dark", "Turn It Up, {city}", "{city} Night Shift", "Loud in {city}"],
];

/** A name for the tape from the city and the vibe (the same seed gives the same name). */
export function tapeName(city: string, vibe: Vibe, seed = 0): string {
  const list = vibe.budget === 0 ? ["{city} for Free", "{city} on a Shoestring", "Free Entry, {city}", "Pocket Money {city}"] : NAMES[Math.max(0, Math.min(4, vibe.energy))];
  return list[Math.abs(Math.floor(seed)) % list.length].replace("{city}", city);
}

/** A small seeded random generator (mulberry32), for repeatable tapes and tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
