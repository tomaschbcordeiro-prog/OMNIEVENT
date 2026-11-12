/**
 * A trip as a show: scene after scene, the way it will happen. A title, the journey to the
 * first city, each city with its days and everything planned on them (places, meals,
 * meetings, events) in time order, what's still on the list to see there, the journeys between
 * cities, home again, and the trip in numbers. Built afresh from the trip each time it plays,
 * so whatever is added later is in it.
 */
import { daysOf, nightsBetween, STOP_RADIUS_KM, type TripStop } from "./trip";
import { haversineKm } from "./geo";
import { isScheduled, isTravel, type PlanKind, type TripPlan } from "./trip-plans";
import { formatEventTime } from "./format";
import type { TripEvent } from "./trip-snap";

export interface ShowItem {
  key: string;
  title: string;
  kind: PlanKind | "event";
  time?: string;
  endTime?: string;
  lat?: number;
  lng?: number;
  image?: string;
  place?: string;
  notes?: string;
  poi?: string;
  plan?: TripPlan;
  event?: TripEvent;
}

interface Base {
  key: string;
  /** The chapter it's in (the start, a city, the end). */
  chapter: number;
  /** How long it stays on screen at normal speed (0: until you go on). */
  ms: number;
}
export type Scene =
  | (Base & { type: "intro" })
  | (Base & { type: "leg"; from?: TripStop; to?: TripStop; plan?: TripPlan; km?: number })
  | (Base & { type: "city"; stop: TripStop; index: number; stay?: TripPlan; planned: number })
  | (Base & { type: "day"; stop: TripStop; index: number; day: string; n: number; items: ShowItem[] })
  | (Base & { type: "item"; stop: TripStop; index: number; day: string; item: ShowItem; n: number; of: number })
  | (Base & { type: "wish"; stop: TripStop; index: number; places: TripPlan[] })
  | (Base & { type: "outro" });

export interface Chapter {
  key: string;
  label: string;
  sub?: string;
  /** The city's place in the route (its colour). */
  index?: number;
  /** Its first scene, and how many. */
  first: number;
  count: number;
}

export interface ShowStats {
  cities: number;
  nights: number;
  km: number;
  countries: string[];
  planned: number;
  events: number;
  toSee: number;
  days: number;
}

export interface Show {
  scenes: Scene[];
  chapters: Chapter[];
  stats: ShowStats;
}

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { ...o, timeZone: "UTC" });

/** How long the globe takes to fly a leg (as the globe's own flights do). */
export const legMs = (km: number) => Math.max(2600, Math.min(6400, 2300 + km * 0.36));

/** The scene's time, for its kind of thing: a sight with a note stays longer than a free day. */
const itemMs = (x: ShowItem) => 4300 + (x.notes ? 900 : 0) + (x.image ? 300 : 0);

export function buildShow({ trip, stops, events }: { trip: { plans?: TripPlan[]; start?: string; end?: string }; stops: TripStop[]; events: { e: TripEvent; day: string }[] }): Show {
  const plans = trip.plans ?? [];
  const scenes: Scene[] = [];
  const chapters: Chapter[] = [];
  const near = (lat: number | undefined, lng: number | undefined, s: TripStop) => lat != null && lng != null && haversineKm(lat, lng, s.lat, s.lng) <= STOP_RADIUS_KM;
  // The city a day is spent in: from its first day up to (not on) the day you leave, and the
  // last city on its last day too.
  const owner = (d: string) => {
    const i = stops.findIndex((s, k) => s.from <= d && (d < s.to || (k === stops.length - 1 && d <= s.to)));
    return i;
  };
  // Where something on a day happens: the city it's in (if it's on the map and you're there that
  // day), else the city of that day.
  const whereOf = (d: string, lat?: number, lng?: number) => {
    const at = stops.findIndex((s) => s.from <= d && d <= s.to && near(lat, lng, s));
    return at >= 0 ? at : owner(d);
  };

  // The journeys: into the first city, between cities, home from the last.
  const used = new Set<string>();
  const travelOn = (day: string, to?: string, from?: string) => {
    const on = plans.filter((p) => isTravel(p.kind) && isScheduled(p) && p.day === day && !used.has(p.id));
    const lc = (x?: string) => (x ?? "").toLowerCase();
    const best = on.find((p) => (to && lc(p.to).includes(lc(to))) || (from && lc(p.from).includes(lc(from)))) ?? on[0];
    if (best) used.add(best.id);
    return best;
  };
  const first = stops[0];
  const last = stops[stops.length - 1];
  const arrive = first ? travelOn(first.from, first.name) : undefined;
  const between = stops.slice(1).map((b, j) => travelOn(stops[j].to, b.name, stops[j].name));
  const home = last && stops.length ? travelOn(last.to, undefined, last.name) : undefined;

  // Everything else on a day, in the city it's in.
  const byStopDay = new Map<string, ShowItem[]>();
  const put = (i: number, d: string, x: ShowItem) => {
    if (i < 0) return;
    const k = `${i}|${d}`;
    byStopDay.set(k, [...(byStopDay.get(k) ?? []), x]);
  };
  for (const p of plans) {
    if (!isScheduled(p) || p.kind === "stay" || used.has(p.id)) continue;
    put(whereOf(p.day, p.lat, p.lng), p.day, { key: `p${p.id}`, title: p.title, kind: p.kind, time: p.time, endTime: p.endTime, lat: p.lat, lng: p.lng, image: p.image, place: p.place ?? ([p.from, p.to].filter(Boolean).join(" → ") || undefined), notes: p.notes, poi: p.poi, plan: p });
  }
  for (const { e, day } of events) {
    const time = e.hoursUnknown || e.eventType === "daily_attraction" ? undefined : formatEventTime(e.start, e.timeZone);
    put(whereOf(day, e.lat, e.lng), day, { key: `e${e.id}`, title: e.title, kind: "event", time, lat: e.lat || undefined, lng: e.lng || undefined, image: e.imageUrl, place: e.venueName, event: e });
  }
  for (const list of byStopDay.values()) list.sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.title.localeCompare(b.title));

  // ---- the scenes
  const add = (sc: Scene) => scenes.push(sc);
  const chapter = (c: Omit<Chapter, "first" | "count">) => chapters.push({ ...c, first: scenes.length, count: 0 });

  chapter({ key: "start", label: "Start" });
  add({ type: "intro", key: "intro", chapter: 0, ms: 5200 });

  const allDays = first && last ? daysOf(first.from, last.to) : [];
  let km = 0;
  stops.forEach((s, i) => {
    chapter({ key: `stop-${s.id}`, label: s.name, sub: `${fmt(s.from, { day: "numeric", month: "short" })} – ${fmt(s.to, { day: "numeric", month: "short" })}`, index: i });
    const ch = chapters.length - 1;
    if (i === 0) {
      if (arrive) add({ type: "leg", key: `leg-in`, chapter: ch, ms: 5200, to: s, plan: arrive });
    } else {
      const a = stops[i - 1];
      const d = haversineKm(a.lat, a.lng, s.lat, s.lng);
      km += d;
      add({ type: "leg", key: `leg-${a.id}-${s.id}`, chapter: ch, ms: legMs(d) + 1500, from: a, to: s, plan: between[i - 1], km: Math.round(d) });
    }
    const own = daysOf(s.from, s.to).filter((d) => owner(d) === i);
    const days = own.length ? own : [s.from];
    const stay = plans.find((p) => p.kind === "stay" && isScheduled(p) && p.day < s.to && (p.endDay ?? p.day) > s.from && (p.lat == null || near(p.lat, p.lng, s))) ?? plans.find((p) => p.kind === "stay" && isScheduled(p) && p.day === s.from);
    const planned = days.reduce((n, d) => n + (byStopDay.get(`${i}|${d}`)?.length ?? 0), 0);
    add({ type: "city", key: `city-${s.id}`, chapter: ch, ms: 4600, stop: s, index: i, stay, planned });
    for (const d of days) {
      const items = byStopDay.get(`${i}|${d}`) ?? [];
      const n = allDays.indexOf(d) + 1;
      add({ type: "day", key: `day-${s.id}-${d}`, chapter: ch, ms: items.length ? 3000 : 2300, stop: s, index: i, day: d, n, items });
      items.forEach((x, k) => add({ type: "item", key: `item-${x.key}`, chapter: ch, ms: itemMs(x), stop: s, index: i, day: d, item: x, n: k + 1, of: items.length }));
    }
    const wish = plans.filter((p) => !isScheduled(p) && near(p.lat, p.lng, s));
    if (wish.length) add({ type: "wish", key: `wish-${s.id}`, chapter: ch, ms: 3200 + 450 * Math.min(wish.length, 6), stop: s, index: i, places: wish });
    if (i === stops.length - 1 && home) add({ type: "leg", key: "leg-home", chapter: ch, ms: 4600, from: s, plan: home });
  });

  chapter({ key: "end", label: "The end" });
  add({ type: "outro", key: "outro", chapter: chapters.length - 1, ms: 0 });

  for (let c = 0; c < chapters.length; c++) chapters[c].count = (chapters[c + 1]?.first ?? scenes.length) - chapters[c].first;

  const nights = trip.start && trip.end ? nightsBetween(trip.start, trip.end) : first && last ? nightsBetween(first.from, last.to) : 0;
  return {
    scenes,
    chapters,
    stats: {
      cities: stops.length,
      nights,
      km: Math.round(km),
      countries: [...new Set(stops.map((s) => s.countryCode).filter((c): c is string => !!c))],
      planned: plans.filter((p) => isScheduled(p) && !isTravel(p.kind) && p.kind !== "stay").length,
      events: events.length,
      toSee: plans.filter((p) => !isScheduled(p)).length,
      days: allDays.length,
    },
  };
}

/** How far into the show a scene is (0–1), by time at normal speed. */
export function showProgress(scenes: Scene[], at: number): number {
  const total = scenes.reduce((n, s) => n + (s.ms || 3000), 0);
  const done = scenes.slice(0, at).reduce((n, s) => n + (s.ms || 3000), 0);
  return total ? done / total : 0;
}
