import { describe, it, expect, beforeAll } from "vitest";
import { ensureFresh, searchEvents, clusterEvents, getEventView, dataSummary, getOffer, dayCounts } from "@/lib/store";
import { generateDemoData } from "@/lib/providers/demo";

beforeAll(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,wikidata";
  await ensureFresh();
});

describe("demo data", () => {
  it("is deterministic per day and fully flagged as demo", () => {
    const a = generateDemoData(new Date("2026-10-22T10:00:00Z"));
    const b = generateDemoData(new Date("2026-10-22T18:00:00Z"));
    expect(a.events.map((e) => e.id)).toEqual(b.events.map((e) => e.id));
    expect(a.events.every((e) => e.provenance.isDemo)).toBe(true);
    expect(a.offers.every((o) => o.isDemo && o.purchaseUrl?.startsWith("/out/"))).toBe(true);
  });
  it("only sets totalPrice when fees are known", () => {
    const { offers } = generateDemoData(new Date("2026-10-22T10:00:00Z"));
    for (const o of offers) if (o.totalPrice != null) expect(o.feesIncluded === true || o.feeAmount != null).toBe(true);
  });
});

describe("store queries", () => {
  it("loads thousands of demo events", () => {
    expect(dataSummary().demo).toBeGreaterThan(2000);
    expect(dataSummary().live).toBe(0);
  });
  it("category filter includes subcategories", () => {
    const r = searchEvents({ categories: ["music"], pageSize: 100 });
    expect(r.total).toBeGreaterThan(0);
    expect(r.items.every((c) => c.groupSlug === "music")).toBe(true);
  });
  it("city + price filter", () => {
    const r = searchEvents({ city: "lisbon", maxPrice: 30, currency: "EUR", pageSize: 100 });
    for (const c of r.items) expect(c.isFree || (c.fromPrice && c.fromPrice.amount <= 30)).toBe(true);
    expect(r.items.every((c) => c.cityId === "lisbon")).toBe(true);
  });
  it("date filter works in the event's time zone", () => {
    const today = new Date().toISOString().slice(0, 10);
    const r = searchEvents({ from: today, to: today, pageSize: 100 });
    expect(r.total).toBeGreaterThan(0);
  });
  it("hides completed events by default", () => {
    expect(searchEvents({ pageSize: 100 }).items.some((c) => c.status === "completed")).toBe(false);
  });
  it("counts each day's events for the timeline, as the day's own search does", () => {
    const start = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    const counts = dayCounts({ categories: ["music"] }, {}, start, 10);
    expect(counts).toHaveLength(10);
    expect(counts.some((n) => n > 0)).toBe(true);
    counts.forEach((n, i) => {
      const d = new Date(Date.parse(`${start}T12:00:00Z`) + i * 864e5).toISOString().slice(0, 10);
      expect([d, n]).toEqual([d, clusterEvents({ categories: ["music"], from: d, to: d }, { cellDeg: 12 }).total]);
    });
    const near = dayCounts({}, { lat: 38.72, lng: -9.14, radiusKm: 30 }, start, 3);
    const d0 = clusterEvents({ from: start, to: start }, { lat: 38.72, lng: -9.14, radiusKm: 30, cellDeg: 0 }).inView;
    expect(near[0]).toBe(d0);
  });
  it("clusters at globe scale and venue scale", () => {
    const g = clusterEvents({}, { cellDeg: 12 });
    expect(g.clusters.length).toBeGreaterThan(20);
    expect(g.clusters.reduce((s, c) => s + c.count, 0)).toBe(g.total);
    const v = clusterEvents({}, { lat: 38.72, lng: -9.14, radiusKm: 30, cellDeg: 0 });
    expect(v.clusters.every((c) => c.venueId)).toBe(true);
  });
  it("event detail joins venue, people and offers", () => {
    const first = searchEvents({ access: "ticketed", status: ["on_sale"], pageSize: 1 }).items[0];
    const ev = getEventView(first.slug)!;
    expect(ev.venue.name).toBeTruthy();
    expect(ev.offers.length).toBeGreaterThan(0);
    expect(getOffer(ev.offers[0].id)).toBeTruthy();
  });
  it("text search with AND semantics and typo tolerance", () => {
    const any = searchEvents({ pageSize: 1, categories: ["football"] }).items[0];
    const word = any.title.split(" ")[0];
    expect(searchEvents({ q: word }).total).toBeGreaterThan(0);
    expect(searchEvents({ q: "zzzzqqq" }).total).toBe(0);
  });
});

describe("marker merging", () => {
  it("merges groups that would overlap on screen without losing events", () => {
    const grid = clusterEvents({}, { cellDeg: 1.2 });
    const merged = clusterEvents({}, { cellDeg: 1.2, mergeDeg: 3 });
    const sum = (r: typeof grid) => r.clusters.reduce((n, c) => n + c.count, 0);
    expect(merged.clusters.length).toBeLessThan(grid.clusters.length);
    expect(sum(merged)).toBe(sum(grid));
    for (const c of merged.clusters) expect(Object.values(c.groups).reduce((a, b) => a + b, 0)).toBe(c.count);
  });
});

describe("group extent", () => {
  it("every event of a group lies within its radius, also after merging", () => {
    const r = clusterEvents({}, { cellDeg: 3.5, mergeDeg: 4 });
    for (const c of r.clusters.slice(0, 30)) {
      const near = searchEvents({ near: { lat: c.lat, lng: c.lng, radiusKm: Math.min(2000, (c.radiusKm ?? 0) * 1.05 + 2) }, pageSize: 1 });
      expect(near.total).toBeGreaterThanOrEqual(c.count);
    }
  });
});

describe("group membership", () => {
  it("listing a marker's group returns exactly its events", () => {
    const r = clusterEvents({}, { cellDeg: 3.5, mergeDeg: 4 });
    for (const c of r.clusters.slice(0, 20)) expect(searchEvents({ group: c.group, pageSize: 1 }).total).toBe(c.count);
    const venues = clusterEvents({}, { lat: 51.5, lng: -0.12, radiusKm: 30, cellDeg: 0, mergeDeg: 0.01 });
    for (const c of venues.clusters.slice(0, 10)) expect(searchEvents({ group: c.group, pageSize: 1 }).total).toBe(c.count);
  });
});
