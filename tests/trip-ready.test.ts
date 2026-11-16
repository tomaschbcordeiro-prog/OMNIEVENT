import { describe, expect, it } from "vitest";
import { phaseLabel, tripReady } from "@/lib/trip-ready";
import type { TripStop } from "@/lib/trip";
import type { TripPlan } from "@/lib/trip-plans";

const stops: TripStop[] = [
  { id: "s0", name: "Lisbon", countryCode: "PT", lat: 38.7223, lng: -9.1393, from: "2026-12-01", to: "2026-12-04" },
  { id: "s1", name: "Porto", countryCode: "PT", lat: 41.1579, lng: -8.6291, from: "2026-12-04", to: "2026-12-06" },
];
const P = (p: Partial<TripPlan> & Pick<TripPlan, "id" | "kind" | "title" | "day">): TripPlan => ({ createdAt: "", ...p });
const trip = (plans: TripPlan[]) => ({ start: "2026-12-01", end: "2026-12-06", stops, plans });

describe("how ready a trip is", () => {
  it("asks for a bed first, then the way between cities, then something to do", () => {
    const bare = tripReady(trip([]), [], "2026-11-16");
    expect(bare.phase).toBe("soon");
    expect(bare.daysTo).toBe(15);
    expect(bare.beds).toEqual({ have: 0, need: 2 });
    expect(bare.journeys).toEqual({ have: 0, need: 1 });
    expect(bare.next).toMatchObject({ kind: "stay", label: "A bed in Lisbon" });

    const beds = [P({ id: "h1", kind: "stay", title: "Memmo", day: "2026-12-01", endDay: "2026-12-04" }), P({ id: "h2", kind: "stay", title: "Torel", day: "2026-12-04", endDay: "2026-12-06" })];
    const r2 = tripReady(trip(beds), [], "2026-11-16");
    expect(r2.beds).toEqual({ have: 2, need: 2 });
    expect(r2.next).toMatchObject({ kind: "journey", label: "Getting to Porto", by: "train", leg: 1 });

    const train = P({ id: "t1", kind: "train", title: "Train to Porto", day: "2026-12-04", from: "Lisbon", to: "Porto" });
    const r3 = tripReady(trip([...beds, train]), [], "2026-11-16");
    expect(r3.journeys).toEqual({ have: 1, need: 1 });
    expect(r3.next).toMatchObject({ kind: "day", label: "Day 1 in Lisbon", day: "2026-12-01" });
    expect(r3.score).toBeGreaterThan(bare.score);
  });

  it("knows when it is", () => {
    expect(phaseLabel(tripReady(trip([]), [], "2026-12-03"))).toBe("Day 3 of 6");
    expect(phaseLabel(tripReady(trip([]), [], "2026-11-30"))).toBe("Tomorrow");
    expect(phaseLabel(tripReady(trip([]), [], "2026-11-20"))).toBe("In 11 days");
    expect(phaseLabel(tripReady(trip([]), [], "2026-10-01"))).toBe("In 2 months");
    const done = tripReady(trip([]), [], "2026-12-20");
    expect(phaseLabel(done)).toBe("Been there");
    expect(done.next).toBeNull();
  });

  it("while away, suggests a free day still to come", () => {
    const r = tripReady(trip([P({ id: "h1", kind: "stay", title: "A", day: "2026-12-01", endDay: "2026-12-06" }), P({ id: "t1", kind: "train", title: "Train", day: "2026-12-04", to: "Porto" })]), [], "2026-12-03");
    expect(r.next).toMatchObject({ kind: "day", day: "2026-12-03" });
  });
});
