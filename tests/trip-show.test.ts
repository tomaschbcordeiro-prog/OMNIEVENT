import { describe, expect, it } from "vitest";
import { buildShow } from "@/lib/trip-show";
import type { TripStop } from "@/lib/trip";
import type { TripPlan } from "@/lib/trip-plans";
import type { TripEvent } from "@/lib/trip-snap";

const stops: TripStop[] = [
  { id: "s0", name: "Lisbon", countryCode: "PT", lat: 38.7223, lng: -9.1393, from: "2026-12-01", to: "2026-12-04" } as TripStop,
  { id: "s1", name: "Porto", countryCode: "PT", lat: 41.1579, lng: -8.6291, from: "2026-12-04", to: "2026-12-06" } as TripStop,
];
const P = (p: Partial<TripPlan> & Pick<TripPlan, "id" | "kind" | "title" | "day">): TripPlan => ({ createdAt: "", ...p });
const plans: TripPlan[] = [
  P({ id: "f1", kind: "flight", title: "Flight to Lisbon", day: "2026-12-01", time: "09:40", from: "London", to: "Lisbon" }),
  P({ id: "h1", kind: "stay", title: "Memmo Alfama", day: "2026-12-01", endDay: "2026-12-04" }),
  P({ id: "v1", kind: "visit", title: "Jerónimos Monastery", day: "2026-12-02", time: "10:00", lat: 38.6979, lng: -9.2068, notes: "Tickets online" }),
  P({ id: "m1", kind: "meal", title: "Dinner", day: "2026-12-02", time: "20:30", place: "Ramiro" }),
  P({ id: "c1", kind: "meal", title: "Café A Brasileira", day: "2026-12-02", time: "16:00", lat: 38.7108, lng: -9.1424 }),
  P({ id: "t1", kind: "train", title: "Train to Porto", day: "2026-12-04", time: "08:00", from: "Lisbon", to: "Porto" }),
  P({ id: "w1", kind: "visit", title: "Belém Tower", day: "", lat: 38.6916, lng: -9.216 }),
  P({ id: "w2", kind: "visit", title: "Livraria Lello", day: "", lat: 41.1469, lng: -8.6148 }),
  P({ id: "x1", kind: "visit", title: "Ribeira", day: "2026-12-04", time: "15:00", lat: 41.1406, lng: -8.6132 }),
  P({ id: "f2", kind: "flight", title: "Flight home", day: "2026-12-06", time: "18:00", from: "Porto", to: "London" }),
];
const event = { id: "ev1", slug: "fado", title: "Fado night", start: "2026-12-03T21:00:00Z", timeZone: "Europe/Lisbon", venueName: "Clube de Fado", lat: 38.711, lng: -9.129, city: "Lisbon", groupSlug: "music" } as unknown as TripEvent;

describe("a trip as a show", () => {
  const show = buildShow({ trip: { plans, start: "2026-12-01", end: "2026-12-06" }, stops, events: [{ e: event, day: "2026-12-03" }] });
  const types = show.scenes.map((s) => s.type);

  it("goes start, in, each city with its days, between, home, the end", () => {
    expect(types[0]).toBe("intro");
    expect(types[1]).toBe("leg");
    expect(types[2]).toBe("city");
    expect(types.at(-1)).toBe("outro");
    expect(types.at(-2)).toBe("leg");
    expect(show.chapters.map((c) => c.label)).toEqual(["Start", "Lisbon", "Porto", "The end"]);
    // Chapters cover every scene once.
    expect(show.chapters.reduce((n, c) => n + c.count, 0)).toBe(show.scenes.length);
  });

  it("puts the journeys on the legs, not in the days", () => {
    const legs = show.scenes.filter((s) => s.type === "leg");
    expect(legs.map((l) => (l.type === "leg" ? l.plan?.id : null))).toEqual(["f1", "t1", "f2"]);
    const items = show.scenes.filter((s) => s.type === "item").map((s) => (s.type === "item" ? s.item.title : ""));
    expect(items).not.toContain("Train to Porto");
    expect(items).not.toContain("Memmo Alfama");
  });

  it("lists a day's plans and events in time order, in the city they're in", () => {
    const day2 = show.scenes.find((s) => s.type === "day" && s.day === "2026-12-02");
    expect(day2 && day2.type === "day" ? day2.items.map((x) => x.time) : []).toEqual(["10:00", "16:00", "20:30"]);
    const fado = show.scenes.find((s) => s.type === "item" && s.item.kind === "event");
    expect(fado && fado.type === "item" ? [fado.stop.name, fado.day, fado.item.time] : []).toEqual(["Lisbon", "2026-12-03", "21:00"]);
    // The afternoon in Porto on the day of the train is Porto's.
    const ribeira = show.scenes.find((s) => s.type === "item" && s.item.title === "Ribeira");
    expect(ribeira && ribeira.type === "item" ? ribeira.stop.name : "").toBe("Porto");
  });

  it("knows where you sleep, what's left to see, and the numbers", () => {
    const lisbon = show.scenes.find((s) => s.type === "city" && s.stop.name === "Lisbon");
    expect(lisbon && lisbon.type === "city" ? lisbon.stay?.title : "").toBe("Memmo Alfama");
    const wishes = show.scenes.filter((s) => s.type === "wish").map((s) => (s.type === "wish" ? `${s.stop.name}:${s.places.map((p) => p.title).join()}` : ""));
    expect(wishes).toEqual(["Lisbon:Belém Tower", "Porto:Livraria Lello"]);
    expect(show.stats).toMatchObject({ cities: 2, nights: 5, countries: ["PT"], planned: 4, events: 1, toSee: 2, days: 6 });
    expect(show.stats.km).toBeGreaterThan(270);
    expect(show.stats.km).toBeLessThan(290);
  });

  it("plays a trip with nothing planned yet", () => {
    const bare = buildShow({ trip: {}, stops: [stops[0]], events: [] });
    expect(bare.scenes.map((s) => s.type)).toEqual(["intro", "city", "day", "day", "day", "day", "outro"]);
    expect(buildShow({ trip: {}, stops: [], events: [] }).scenes.map((s) => s.type)).toEqual(["intro", "outro"]);
  });
});
