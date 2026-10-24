import { describe, it, expect } from "vitest";
import { normalizeTmEvents, mapCategory, mapStatus, crawlCatalogue, type TmEvent } from "@/lib/providers/ticketmaster";

// Hand-written fixture in the shape of a Discovery API v2 response (not real data).
const fixture: TmEvent[] = [
  {
    id: "FIXTURE1",
    name: "Fixture Band — Fixture Tour",
    url: "https://www.ticketmaster.com/event/FIXTURE1",
    dates: { start: { dateTime: "2026-11-20T20:00:00Z" }, timezone: "Europe/London", status: { code: "onsale" } },
    classifications: [{ segment: { name: "Music" }, genre: { name: "Rock" } }],
    priceRanges: [{ type: "standard", currency: "GBP", min: 45, max: 95 }, { type: "standard including fees", currency: "GBP", min: 52.5, max: 110 }],
    _embedded: {
      venues: [{ id: "V1", name: "Fixture Arena", city: { name: "London" }, country: { name: "Great Britain", countryCode: "GB" }, location: { latitude: "51.5", longitude: "-0.12" }, timezone: "Europe/London" }],
      attractions: [{ id: "A1", name: "Fixture Band" }],
    },
  },
  // No coordinates → must be skipped rather than guessed.
  { id: "FIXTURE2", name: "No Location", dates: { start: { dateTime: "2026-11-21T20:00:00Z" } }, _embedded: { venues: [{ id: "V2" }] } },
];

describe("ticketmaster adapter", () => {
  const b = normalizeTmEvents(fixture, "2026-10-22T00:00:00Z");
  it("normalises an event and skips unplaceable ones", () => {
    expect(b.events).toHaveLength(1);
    const e = b.events[0];
    expect(e.categorySlug).toBe("rock-metal");
    expect(e.groupSlug).toBe("music");
    expect(e.status).toBe("on_sale");
    expect(e.provenance).toMatchObject({ provider: "ticketmaster", externalId: "FIXTURE1", isDemo: false });
    expect(b.venues[0]).toMatchObject({ lat: 51.5, lng: -0.12, cityId: "london" });
  });
  it("never claims fees are included unless the price type says so", () => {
    const [plain, incl] = b.offers;
    expect(plain.feesIncluded).toBeUndefined();
    expect(plain.totalPrice).toBeUndefined();
    expect(incl.feesIncluded).toBe(true);
    expect(incl.totalPrice).toBe(52.5);
    expect(plain.availability).toBe("unknown");
  });
  it("lists the official link without inventing a price when no price ranges exist", () => {
    const b2 = normalizeTmEvents([{ ...fixture[0], id: "NOPRICE", priceRanges: undefined }], "2026-10-22T00:00:00Z");
    expect(b2.offers).toHaveLength(1);
    expect(b2.offers[0].purchaseUrl).toBe("https://www.ticketmaster.com/event/FIXTURE1");
    expect(b2.offers[0].basePrice).toBeUndefined();
    expect(b2.offers[0].totalPrice).toBeUndefined();
  });
  it("maps classifications and statuses", () => {
    expect(mapCategory({ segment: { name: "Sports" }, genre: { name: "Soccer" } })).toBe("football");
    expect(mapCategory({ segment: { name: "Arts & Theatre" }, genre: { name: "Musical" } })).toBe("musicals");
    expect(mapCategory({})).toBe("other");
    expect(mapStatus("cancelled")).toBe("cancelled");
    expect(mapStatus("weird")).toBe("unknown");
  });
});

describe("full-catalogue crawl", () => {
  // A fake Discovery API: 4,500 events in "US" spread over 300 days (with a busy day), 120 in "PT".
  const from = Date.parse("2026-10-24T00:00:00Z");
  const to = from + 730 * 864e5;
  const make = (cc: string, n: number, spreadDays: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `${cc}${i}`, t: from + Math.floor((i / n) * spreadDays * 864e5) }));
  const db: Record<string, { id: string; t: number }[]> = {
    US: [...make("US", 4500, 300), ...Array.from({ length: 900 }, (_, i) => ({ id: `USbusy${i}`, t: from + 40 * 864e5 + (i % 20) * 3600000 }))],
    PT: make("PT", 120, 500),
  };
  let maxSeen = 0;
  const fetchPage = async (p: Record<string, string>) => {
    const all = (db[p.countryCode] ?? []).filter((e) => e.t >= Date.parse(p.startDateTime) && e.t < Date.parse(p.endDateTime));
    const size = Number(p.size);
    const page = Number(p.page);
    if ((page + 1) * size > 1000) throw new Error("deep paging beyond 1,000");
    maxSeen = Math.max(maxSeen, Math.min(all.length, 1000));
    const slice = all.slice(page * size, page * size + size).map((e) => ({ id: e.id, name: e.id }));
    return { _embedded: { events: slice }, page: { totalElements: all.length, totalPages: Math.ceil(all.length / size) } };
  };

  it("collects every event without ever paging past 1,000", async () => {
    const got = new Set<string>();
    const r = await crawlCatalogue(fetchPage, ["US", "PT", "XX"], { from, to, maxCalls: 1000, onEvents: (l) => l.forEach((e) => got.add(e.id)) });
    expect(got.size).toBe(4500 + 900 + 120);
    expect(r.complete).toBe(true);
    expect(r.truncated).toBe(0);
    expect(maxSeen).toBeLessThanOrEqual(1000);
    expect(r.calls).toBeLessThan(80);
  });
  it("stops at the call budget and reports it", async () => {
    const r = await crawlCatalogue(fetchPage, ["US"], { from, to, maxCalls: 5, onEvents: () => {} });
    expect(r.complete).toBe(false);
    expect(r.calls).toBeLessThanOrEqual(8);
  });
});
