import { describe, it, expect, beforeAll } from "vitest";
import { ensureFresh, searchEvents, clusterEvents, getEventView } from "@/lib/store";
import { descendantsOf, getCategory } from "@/lib/categories";
import { getDestination } from "@/lib/destinations";
import { convert } from "@/lib/currency";
import { localDateKey } from "@/lib/format";
import { haversineKm } from "@/lib/geo";
import type { EventCard, SearchFilters } from "@/lib/types";

/**
 * Whatever is filtered, only what was asked for comes back: every result of a search is
 * checked against each filter independently of the store's own matching.
 */

beforeAll(async () => {
  delete process.env.TICKETMASTER_API_KEY;
  process.env.DISABLED_PROVIDERS = "paris,madrid,lisbon,venue-calendars,football,bol,catalonia,euskadi,castilla-leon,cultura-portugal,openagenda,nyc-parks,zaragoza,helsinki,taiwan,montreal,berlin,barcelona,chicago,valencia-ivc,espoo,brisbane,localist,pt-municipios,livewhale,wikidata";
  await ensureFresh();
});

const DAY = 864e5;
const ymd = (t: number) => new Date(t).toISOString().slice(0, 10);
const today = ymd(Date.now());

function all(f: SearchFilters): EventCard[] {
  const out: EventCard[] = [];
  for (let page = 1; ; page++) {
    const r = searchEvents({ ...f, page, pageSize: 100 });
    out.push(...r.items);
    if (page >= r.pages) return out;
  }
}

/** The day shown on the card is inside the period, or the run shown is on during it. */
function inPeriod(c: EventCard, from: string, to: string): boolean {
  if (c.eventType === "daily_attraction") return true;
  if (c.ongoing) return !!c.until && localDateKey(c.until, c.timeZone) >= from && localDateKey(c.start, c.timeZone) < from;
  const d = localDateKey(c.start, c.timeZone);
  return d >= from && d <= to;
}

describe("filters only let through what was asked for", () => {
  const ranges: [string, string][] = [
    [today, today],
    [ymd(Date.now() + DAY), ymd(Date.now() + DAY)],
    [ymd(Date.now() + 3 * DAY), ymd(Date.now() + 9 * DAY)],
    [ymd(Date.now() + 20 * DAY), ymd(Date.now() + 80 * DAY)],
  ];
  it.each(ranges)("dates %s to %s: every card shows a day in the period", (from, to) => {
    const items = all({ from, to });
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) expect([c.title, c.start, c.until, inPeriod(c, from, to)]).toEqual([c.title, c.start, c.until, true]);
  });

  it("date order follows the dates shown", () => {
    const [from, to] = ranges[2];
    const items = all({ from, to, sort: "date" }).filter((c) => !c.ongoing && !c.hoursUnknown && c.eventType !== "daily_attraction");
    for (let i = 1; i < items.length; i++) expect(Date.parse(items[i].start)).toBeGreaterThanOrEqual(Date.parse(items[i - 1].start));
  });

  it("without dates, nothing that has already ended shows", () => {
    const now = Date.now();
    for (const c of all({})) {
      const e = getEventView(c.slug)!;
      const ends = [e.end ? Date.parse(e.end) : Date.parse(e.start) + (e.durationMinutes ?? 120) * 60000, ...(e.schedule ?? []).map((s) => Date.parse(s) + (e.durationMinutes ?? 120) * 60000)];
      if (e.eventType !== "daily_attraction") expect([c.title, Math.max(...ends) > now - 60000]).toEqual([c.title, true]);
    }
  });

  it("categories", () => {
    for (const g of [["music"], ["sports"], ["jazz"], ["theatre", "family"]]) {
      const allowed = new Set(g.flatMap((x) => [...descendantsOf(x)]));
      const items = all({ categories: g });
      expect(items.length).toBeGreaterThan(0);
      for (const c of items) expect([c.title, allowed.has(c.categorySlug) || allowed.has(c.groupSlug)]).toEqual([c.title, true]);
    }
  });

  it("city, country and radius", () => {
    const lisbon = getDestination("lisbon")!;
    for (const c of all({ city: "lisbon" })) expect(c.cityId === "lisbon" || haversineKm(c.lat, c.lng, lisbon.lat, lisbon.lng) <= 40).toBe(true);
    for (const c of all({ country: "ES" })) expect(getEventView(c.slug)!.venue.countryCode).toBe("ES");
    const near = { lat: 51.5074, lng: -0.1278, radiusKm: 12 };
    const items = all({ near });
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) expect(haversineKm(c.lat, c.lng, near.lat, near.lng)).toBeLessThanOrEqual(12);
  });

  it("price and free", () => {
    for (const c of all({ maxPrice: 25, currency: "EUR" })) expect(c.isFree || (c.fromPrice && convert(c.fromPrice.amount, c.fromPrice.currency, "EUR")! <= 25)).toBe(true);
    for (const c of all({ minPrice: 40, currency: "USD" })) expect(!c.isFree && !!c.fromPrice && convert(c.fromPrice.amount, c.fromPrice.currency, "USD")! >= 40).toBe(true);
    for (const c of all({ access: "free" })) expect(c.isFree || c.ticketAccess === "free").toBe(true);
    for (const c of all({ family: true })) expect(c.familyFriendly).toBe(true);
  });

  it("keywords match whole words, every one of them", () => {
    const items = all({ q: "jazz" });
    expect(items.length).toBeGreaterThan(0);
    for (const c of items) {
      const text = ` ${[c.title, ...c.people.map((p) => p.name), c.categorySlug, c.groupSlug, getCategory(c.categorySlug)?.name ?? "", c.venueName, c.city, c.country].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
      expect([c.title, / jazz/.test(text)]).toEqual([c.title, true]);
    }
    // "art" never matches inside another word, e.g. "party".
    for (const c of all({ q: "art" })) {
      const text = ` ${[c.title, ...c.people.map((p) => p.name), c.categorySlug, c.groupSlug, getCategory(c.categorySlug)?.name ?? "", c.venueName, c.city, c.country].join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ")}`;
      expect([c.title, c.categorySlug, c.venueName, text.includes(" art")]).toEqual([c.title, c.categorySlug, c.venueName, true]);
    }
  });

  it("combined filters, and the globe's counts agree with the list", () => {
    const [from, to] = ranges[2];
    const f: SearchFilters = { categories: ["music"], city: "lisbon", from, to };
    const items = all(f);
    const allowed = descendantsOf("music");
    for (const c of items) {
      expect(allowed.has(c.categorySlug) || allowed.has(c.groupSlug)).toBe(true);
      expect(inPeriod(c, from, to)).toBe(true);
    }
    expect(clusterEvents(f, { cellDeg: 12 }).total).toBe(items.length);
  });
});

describe("any of these places, any of these keywords", () => {
  it("places are alternatives", () => {
    const lisbon = all({ places: ["lisbon"] });
    const madrid = all({ places: ["madrid"] });
    const both = all({ places: ["lisbon", "madrid"] });
    expect(lisbon.length).toBeGreaterThan(0);
    expect(madrid.length).toBeGreaterThan(0);
    expect(both.length).toBe(lisbon.length + madrid.length);
    for (const c of both) expect(["lisbon", "madrid"]).toContain(c.cityId);
    for (const c of all({ places: ["es"] })) expect(getEventView(c.slug)!.venue.countryCode).toBe("ES");
  });
  it("keywords are alternatives, and combine with places", () => {
    const jazz = all({ anyOf: ["jazz"] });
    const comedy = all({ anyOf: ["comedy"] });
    const either = all({ anyOf: ["jazz", "comedy"] });
    expect(jazz.length).toBeGreaterThan(0);
    expect(either.length).toBe(new Set([...jazz, ...comedy].map((c) => c.id)).size);
    const lisbonOrMadridJazz = all({ places: ["lisbon", "madrid"], anyOf: ["jazz"] });
    const jazzSet = new Set(jazz.map((c) => c.id));
    for (const c of lisbonOrMadridJazz) {
      expect(["lisbon", "madrid"]).toContain(c.cityId);
      expect(jazzSet.has(c.id)).toBe(true);
    }
  });
  it("understands category names in other languages", () => {
    const teatro = all({ anyOf: ["teatro"] });
    expect(teatro.length).toBeGreaterThan(0);
    expect(teatro.length).toBe(all({ anyOf: ["theatre"] }).length);
  });
});
