import { describe, it, expect, beforeAll } from "vitest";
import { ensureFresh, searchEvents, matchingCards, getEventView } from "@/lib/store";
import { haversineKm } from "@/lib/geo";
import { windowIntervals, overlaps, todayIn } from "@/lib/time";
import { localDateKey } from "@/lib/format";

beforeAll(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol";
  await ensureFresh();
});

const LISBON = { lat: 38.7223, lng: -9.1393 };

describe("radius search", () => {
  it("returns only events inside the circle, measured on the sphere", () => {
    for (const r of [1, 5, 10, 25]) {
      const items = matchingCards({ near: { ...LISBON, radiusKm: r } });
      for (const c of items) expect(haversineKm(LISBON.lat, LISBON.lng, c.lat, c.lng)).toBeLessThanOrEqual(r);
    }
  });
  it("a larger radius never finds fewer events", () => {
    const n = [1, 5, 10, 25, 100, 500].map((r) => matchingCards({ near: { ...LISBON, radiusKm: r } }).length);
    for (let i = 1; i < n.length; i++) expect(n[i]).toBeGreaterThanOrEqual(n[i - 1]);
    expect(n.at(-1)).toBeGreaterThan(n[0]);
  });
  it("works across the antimeridian (Auckland/Fiji)", () => {
    const items = matchingCards({ near: { lat: -36.85, lng: 179.9, radiusKm: 900 } });
    expect(items.length).toBeGreaterThan(0); // Auckland is ~420 km from 179.9°E
    for (const c of items) expect(haversineKm(-36.85, 179.9, c.lat, c.lng)).toBeLessThanOrEqual(900);
  });
  it("reports distance and can sort by it", () => {
    const r = searchEvents({ near: { ...LISBON, radiusKm: 25 }, sort: "distance", pageSize: 50 });
    const d = r.items.map((c) => c.distanceKm!);
    expect(d.every((x) => x != null)).toBe(true);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
  });
});

describe("local date and time windows", () => {
  const day = todayIn("Europe/Lisbon");
  const plusDays = (n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

  it("keeps exactly the events whose schedule overlaps the window in their own time zone", () => {
    const from = plusDays(1), to = plusDays(7);
    const f = { from, to, tFrom: "18:00", tTo: "23:00" };
    const hits = new Set(matchingCards(f).map((c) => c.id));
    const all = matchingCards({ from, to });
    expect(hits.size).toBeGreaterThan(0);
    expect(hits.size).toBeLessThan(all.length);
    for (const c of all.filter((x) => x.eventType === "single").slice(0, 400)) {
      const e = getEventView(c.id)!;
      const s = Date.parse(e.start);
      const iv: [number, number] = [s, e.end ? Date.parse(e.end) : s + (e.durationMinutes ?? 120) * 60000];
      const dayBefore = new Date(Date.parse(`${from}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
      const expected = windowIntervals(dayBefore, to, e.timeZone, "18:00", "23:00").filter((w) => localDateKey(new Date(w[0]), e.timeZone) >= from).some((w) => overlaps(w, iv));
      expect(hits.has(c.id), `${e.title} @ ${e.start} ${e.timeZone}`).toBe(expected);
    }
  });
  it("uses each venue's zone: the same local window selects different UTC instants in Tokyo and New York", () => {
    const d = plusDays(3);
    const tokyo = matchingCards({ from: d, to: d, tFrom: "19:00", tTo: "22:00", city: "tokyo" });
    const ny = matchingCards({ from: d, to: d, tFrom: "19:00", tTo: "22:00", city: "new-york" });
    for (const c of [...tokyo, ...ny].filter((x) => x.eventType === "single")) {
      const e = getEventView(c.id)!;
      const s = Date.parse(e.start);
      const end = e.end ? Date.parse(e.end) : s + (e.durationMinutes ?? 120) * 60000;
      const [w] = windowIntervals(d, d, e.timeZone, "19:00", "22:00");
      expect(overlaps(w, [s, end])).toBe(true);
    }
  });
  it("radius + date + time + category combine", () => {
    const r = searchEvents({ near: { ...LISBON, radiusKm: 25 }, from: plusDays(0), to: plusDays(30), tFrom: "18:00", tTo: "23:00", categories: ["music"], pageSize: 100 });
    for (const c of r.items) {
      expect(c.groupSlug).toBe("music");
      expect(haversineKm(LISBON.lat, LISBON.lng, c.lat, c.lng)).toBeLessThanOrEqual(25);
    }
  });
});
