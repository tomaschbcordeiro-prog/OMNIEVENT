/**
 * How far along a trip's planning is, for its card on the trips page: when it is (counting
 * down, under way, behind you), where you still need a bed, which journeys between cities have
 * no transport yet, how many days have something on, and the one thing worth adding next.
 */
import { buildShow } from "./trip-show";
import { daysOf, nightsBetween, type TripStop } from "./trip";
import { haversineKm } from "./geo";
import type { TripPlan } from "./trip-plans";
import type { TripEvent } from "./trip-snap";

export type TripPhase = "undated" | "soon" | "now" | "past";

export type NextStep =
  | { kind: "stay"; stop: TripStop; label: string }
  | { kind: "journey"; from: TripStop; to: TripStop; leg: number; by: "flight" | "train"; label: string }
  | { kind: "day"; stop: TripStop; day: string; label: string };

export interface TripReady {
  phase: TripPhase;
  /** Days until it starts ("soon"), or the day you're on ("now", from 1). */
  daysTo: number;
  day: number;
  days: number;
  beds: { have: number; need: number };
  journeys: { have: number; need: number };
  planned: { have: number; need: number };
  /** 0 to 1: beds, journeys and days together. */
  score: number;
  next: NextStep | null;
}

const DAY = 86_400_000;
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);

export function tripReady(trip: { start?: string; end?: string; plans?: TripPlan[]; stops?: TripStop[] }, events: { e: TripEvent; day: string }[], today: string): TripReady {
  const stops = trip.stops ?? [];
  const { start, end } = trip;
  const phase: TripPhase = !start || !end ? "undated" : today < start ? "soon" : today > end ? "past" : "now";
  const daysTo = start && phase === "soon" ? Math.round((at(start) - at(today)) / DAY) : 0;
  const all = start && end ? daysOf(start, end) : [];
  const day = phase === "now" ? all.indexOf(today) + 1 : 0;

  const show = buildShow({ trip, stops, events });
  // A bed for every city you spend a night in.
  const cities = show.scenes.filter((s) => s.type === "city");
  const sleep = cities.filter((s) => nightsBetween(s.stop.from, s.stop.to) > 0);
  const beds = { have: sleep.filter((s) => s.stay).length, need: sleep.length };
  // A way to get between each pair of cities.
  const legs = show.scenes.filter((s) => s.type === "leg" && s.from && s.to);
  const journeys = { have: legs.filter((s) => s.type === "leg" && s.plan).length, need: legs.length };
  // Something on each day you're there.
  const dayScenes = show.scenes.filter((s) => s.type === "day");
  const planned = { have: dayScenes.filter((s) => s.type === "day" && s.items.length > 0).length, need: dayScenes.length };

  const parts = [beds, journeys, planned].filter((x) => x.need > 0);
  const score = parts.length ? parts.reduce((n, x) => n + x.have / x.need, 0) / parts.length : 0;

  // What to add next, in the order a trip gets booked: beds, then journeys, then the days.
  let next: NextStep | null = null;
  if (phase !== "past") {
    // While away, only what's still ahead (or where you are now).
    const bed = sleep.find((s) => !s.stay && s.stop.to > today);
    const leg = legs.find((s) => s.type === "leg" && !s.plan && !!s.from && s.from.to >= today);
    const free = dayScenes.find((s) => s.type === "day" && !s.items.length && (phase !== "now" || s.day >= today));
    if (bed?.type === "city") next = { kind: "stay", stop: bed.stop, label: `A bed in ${bed.stop.name}` };
    else if (leg?.type === "leg" && leg.from && leg.to) {
      const km = haversineKm(leg.from.lat, leg.from.lng, leg.to.lat, leg.to.lng);
      next = { kind: "journey", from: leg.from, to: leg.to, leg: stops.indexOf(leg.to), by: km > 800 ? "flight" : "train", label: `Getting to ${leg.to.name}` };
    } else if (free?.type === "day") next = { kind: "day", stop: free.stop, day: free.day, label: `Day ${free.n} in ${free.stop.name}` };
  }
  return { phase, daysTo, day, days: all.length, beds, journeys, planned, score, next };
}

/** "In 20 days", "Tomorrow", "Day 2 of 6", "Done". */
export function phaseLabel(r: Pick<TripReady, "phase" | "daysTo" | "day" | "days">): string {
  if (r.phase === "undated") return "No dates yet";
  if (r.phase === "past") return "Been there";
  if (r.phase === "now") return `Day ${r.day} of ${r.days}`;
  if (r.daysTo === 1) return "Tomorrow";
  if (r.daysTo < 14) return `In ${r.daysTo} days`;
  if (r.daysTo < 60) return `In ${Math.round(r.daysTo / 7)} weeks`;
  return `In ${Math.round(r.daysTo / 30)} months`;
}
