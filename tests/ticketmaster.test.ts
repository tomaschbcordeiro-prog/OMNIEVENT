import { describe, it, expect } from "vitest";
import { normalizeTmEvents, mapCategory, mapStatus, type TmEvent } from "@/lib/providers/ticketmaster";

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
  it("maps classifications and statuses", () => {
    expect(mapCategory({ segment: { name: "Sports" }, genre: { name: "Soccer" } })).toBe("football");
    expect(mapCategory({ segment: { name: "Arts & Theatre" }, genre: { name: "Musical" } })).toBe("musicals");
    expect(mapCategory({})).toBe("other");
    expect(mapStatus("cancelled")).toBe("cancelled");
    expect(mapStatus("weird")).toBe("unknown");
  });
});
