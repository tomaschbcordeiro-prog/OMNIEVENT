import { describe, expect, it } from "vitest";
import { __testing, searchEvents } from "@/lib/store";
import { generateDemoData } from "@/lib/providers/demo";

describe("country and continent searches", () => {
  it("find the same events as looking through every card", () => {
    const base = generateDemoData(new Date("2026-11-08T10:00:00Z"));
    __testing.load("regions", { ...base, events: base.events.map((e) => ({ ...e, provenance: { ...e.provenance, provider: "regions", isDemo: false } })) });
    __testing.rebuild();
    const all = searchEvents({ pageSize: 100, status: undefined });
    const codes = [...new Set(base.venues.map((v) => v.countryCode))];
    expect(codes.length).toBeGreaterThan(1);
    const venueCountry = new Map(base.venues.map((v) => [v.id, v.countryCode]));
    const eventCountry = new Map(base.events.map((e) => [e.id, venueCountry.get(e.venueId)]));
    for (const cc of codes) {
      const r = searchEvents({ country: cc, pageSize: 100 });
      // Every result is in that country, and none is missing.
      expect(r.items.every((c) => eventCountry.get(c.id) === cc)).toBe(true);
      const everyCard = searchEvents({ pageSize: 100 }).total;
      expect(r.total).toBeLessThanOrEqual(everyCard);
    }
    const sum = codes.reduce((n, cc) => n + searchEvents({ country: cc }).total, 0);
    expect(sum).toBe(searchEvents({}).total);
    expect(all.total).toBeGreaterThan(0);
    __testing.drop("regions");
    __testing.rebuild();
  });
});

describe("soonest events by categories", () => {
  it("match one search per list of categories", async () => {
    const { soonestByCategories } = await import("@/lib/store");
    const base = generateDemoData(new Date("2026-11-08T10:00:00Z"));
    __testing.load("rows", { ...base, events: base.events.map((e) => ({ ...e, provenance: { ...e.provenance, provider: "rows", isDemo: false } })) });
    __testing.rebuild();
    const lists = [["festivals", "culture", "food-drink"], ["sports"], ["exhibitions", "attractions"], ["family"], ["music"]];
    for (const f of [{}, { country: base.venues[0].countryCode }, { city: "lisbon" }]) {
      const rows = soonestByCategories(f, lists, 4);
      lists.forEach((cats, i) => {
        expect(rows[i].map((c) => c.id)).toEqual(searchEvents({ ...f, categories: cats, pageSize: 4 }).items.map((c) => c.id));
      });
    }
    __testing.drop("rows");
    __testing.rebuild();
  });
});

describe("first results in order", () => {
  it("are what a full stable sort puts first", async () => {
    const { firstInOrder } = await import("@/lib/store");
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const n of [0, 1, 50, 1000, 20000]) {
      const keys = Array.from({ length: n }, () => Math.floor(rnd() * 40)); // many ties
      const cmp = (a: number, b: number) => keys[a] - keys[b];
      for (const k of [1, 24, 48, 300]) {
        const want = Array.from({ length: n }, (_, i) => i).sort(cmp).slice(0, k);
        expect(firstInOrder(n, k, cmp)).toEqual(want);
      }
    }
  });
});

describe("zoomed-in globe views", () => {
  it("group the same events whether they look at nearby map cells or at every card", async () => {
    const { clusterEvents } = await import("@/lib/store");
    const base = generateDemoData(new Date("2026-11-08T10:00:00Z"));
    __testing.load("globe", { ...base, events: base.events.map((e) => ({ ...e, provenance: { ...e.provenance, provider: "globe", isDemo: false } })) });
    __testing.rebuild();
    const views = base.venues.slice(0, 12).flatMap((v, i) => [
      { lat: v.lat + 0.05, lng: v.lng - 0.05, radiusKm: [5, 40, 300, 790][i % 4], cellDeg: [0, 0.25, 1, 2][i % 4] },
      { lat: v.lat, lng: v.lng, radiusKm: 120, cellDeg: 0.5, mergeDeg: 0.2 },
    ]);
    let seen = 0;
    for (const view of views)
      for (const f of [{}, { categories: ["music"] }]) {
        __testing.around(true);
        const fast = clusterEvents(f, view);
        __testing.around(false);
        const slow = clusterEvents(f, view);
        seen += fast.inView;
        expect({ total: fast.total, inView: fast.inView, clusters: fast.clusters.map((c) => [c.id, c.count, c.live]) }).toEqual({ total: slow.total, inView: slow.inView, clusters: slow.clusters.map((c) => [c.id, c.count, c.live]) });
      }
    expect(seen).toBeGreaterThan(50);
    __testing.around(true);
    __testing.drop("globe");
    __testing.rebuild();
  });
});
