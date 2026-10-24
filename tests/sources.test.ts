import { describe, it, expect } from "vitest";
import { normalizeMadrid, mapMadridType, type MadridEvent } from "@/lib/providers/madrid";
import { normalizeParis, parseOccurrences, mapParisTags, type ParisRecord } from "@/lib/providers/paris";
import { normalizeSeatGeek, type SgEvent } from "@/lib/providers/seatgeek";
import { normalizeSkiddle, mapSkiddle, type SkEvent } from "@/lib/providers/skiddle";
import { parseLocal, parseAmount } from "@/lib/providers/common";
import { activeProviders } from "@/lib/providers/registry";

// Hand-written fixtures in the shape of each source's response (not real data).
const NOW = Date.parse("2026-10-24T10:00:00Z");
const SYNC = "2026-10-24T10:00:00Z";

describe("common helpers", () => {
  it("reads wall-clock times in the given zone", () => {
    expect(new Date(parseLocal("2026-11-02 18:00", "Europe/Madrid")!).toISOString()).toBe("2026-11-02T17:00:00.000Z");
    expect(new Date(parseLocal("2026-07-02T18:00:00+02:00", "UTC")!).toISOString()).toBe("2026-07-02T16:00:00.000Z");
    expect(parseLocal("soon", "UTC")).toBeUndefined();
  });
  it("parses free-text prices", () => {
    expect(parseAmount("3 euros")).toBe(3);
    expect(parseAmount("Desde 15,75 euros")).toBe(15.75);
    expect(parseAmount("£10.00")).toBe(10);
    expect(parseAmount("Entrada libre")).toBeUndefined();
  });
  it("can switch sources off", () => {
    process.env.DISABLED_PROVIDERS = "paris, madrid";
    expect(activeProviders().map((p) => p.id)).not.toContain("paris");
    delete process.env.DISABLED_PROVIDERS;
    expect(activeProviders().map((p) => p.id)).toContain("madrid");
  });
});

describe("madrid adapter", () => {
  const raw: MadridEvent[] = [
    { id: "1", "@type": "https://datos.madrid.es/egob/kos/actividades/Musica", title: "Concierto", free: 0, price: "3 euros", dtstart: "2026-11-02 00:00:00.0", dtend: "2026-11-02 23:59:00.0", time: "19:30", link: "https://www.madrid.es/x", "event-location": "Centro Cultural", location: { latitude: 40.41, longitude: -3.7 } },
    { id: "2", "@type": "https://datos.madrid.es/egob/kos/actividades/Exposiciones", title: "Expo", free: 1, dtstart: "2026-09-01 00:00:00.0", dtend: "2026-12-31 23:59:00.0", time: "", location: { latitude: 40.42, longitude: -3.69 } },
    { id: "3", title: "No location", dtstart: "2026-11-02 00:00:00.0" },
    { id: "4", title: "Over", dtstart: "2026-10-01 00:00:00.0", dtend: "2026-10-01 23:59:00.0", location: { latitude: 40.4, longitude: -3.7 } },
  ];
  const b = normalizeMadrid(raw, SYNC, NOW);
  it("keeps placeable, upcoming events only", () => {
    expect(b.events.map((e) => e.id)).toEqual(["mad-e-1", "mad-e-2"]);
  });
  it("reads times in Madrid and maps categories", () => {
    const [c, x] = b.events;
    expect(c.start).toBe("2026-11-02T18:30:00.000Z");
    expect(c.categorySlug).toBe("concerts");
    expect(x.eventType).toBe("multi_day");
    expect(x.isFree).toBe(true);
    expect(x.statusNote).toMatch(/Running since/);
    expect(Date.parse(x.start)).toBeGreaterThanOrEqual(NOW - 864e5);
    expect(mapMadridType("…/CuentacuentosTiteresMarionetas")).toBe("kids-theatre");
  });
  it("lists the official page with the advertised price and no fee claims", () => {
    const o = b.offers.find((o) => o.eventId === "mad-e-1")!;
    expect(o).toMatchObject({ basePrice: 3, currency: "EUR", purchaseUrl: "https://www.madrid.es/x" });
    expect(o.feesIncluded).toBeUndefined();
    expect(b.offers.find((o) => o.eventId === "mad-e-2")).toBeUndefined(); // no link, no offer
  });
});

describe("paris adapter", () => {
  const raw: ParisRecord[] = [
    { id: "10", title: "Concert", url: "https://www.paris.fr/e/10", qfap_tags: "Concert;Jazz", lat_lon: { lat: 48.86, lon: 2.35 }, price_type: "payant", access_type: "obligatoire", access_link: "https://tickets.example/10", occurrences: "2026-10-01T20:00:00+02:00_2026-10-01T22:00:00+02:00;2026-11-05T20:00:00+01:00_2026-11-05T22:00:00+01:00;2026-11-06T20:00:00+01:00_2026-11-06T22:00:00+01:00" },
    { id: "11", title: "Expo", url: "https://www.paris.fr/e/11", qfap_tags: "Expo", lat_lon: { lat: 48.87, lon: 2.34 }, price_type: "gratuit", date_start: "2026-01-01T00:00:00+00:00", date_end: "2027-01-31T23:59:59+00:00", occurrences: null },
    { id: "12", title: "Past", lat_lon: { lat: 48.8, lon: 2.3 }, occurrences: "2026-01-01T20:00:00+01:00_2026-01-01T22:00:00+01:00" },
    { id: "13", title: "Nowhere", occurrences: "2026-12-01T20:00:00+01:00_2026-12-01T22:00:00+01:00" },
  ];
  const b = normalizeParis(raw, SYNC, NOW);
  it("uses the next session and lists the later ones", () => {
    expect(b.events.map((e) => e.id)).toEqual(["par-e-10", "par-e-11"]);
    const c = b.events[0];
    expect(c.start).toBe("2026-11-05T19:00:00.000Z");
    expect(c.eventType).toBe("recurring");
    expect(c.schedule).toEqual(["2026-11-06T19:00:00.000Z"]);
    expect(c.durationMinutes).toBe(120);
    expect(c.categorySlug).toBe("jazz");
    expect(c.registrationRequired).toBe(true);
  });
  it("lists date-range events from today", () => {
    const x = b.events[1];
    expect(x.eventType).toBe("multi_day");
    expect(x.isFree).toBe(true);
    expect(x.start).toBe("2026-10-23T22:00:00.000Z"); // midnight in Paris
  });
  it("links to the official booking page without inventing prices", () => {
    const o = b.offers.find((o) => o.eventId === "par-e-10")!;
    expect(o.purchaseUrl).toBe("https://tickets.example/10");
    expect(o.basePrice).toBeUndefined();
    expect(parseOccurrences("bad")).toEqual([]);
    expect(mapParisTags("Loisirs;Sport")).toBe("sports");
  });
});

describe("seatgeek adapter", () => {
  const raw: SgEvent[] = [
    { id: 1, title: "Home vs Away", url: "https://seatgeek.com/e/1", type: "nba", datetime_utc: "2026-11-10T00:30:00", taxonomies: [{ name: "sports" }, { name: "nba" }], performers: [{ id: 5, name: "Home", home_team: true, primary: true }, { id: 6, name: "Away", away_team: true }], venue: { id: 9, name: "Arena", city: "New York", state: "NY", country: "US", timezone: "America/New_York", location: { lat: 40.75, lon: -73.99 } }, stats: { lowest_price: 89, highest_price: 900, listing_count: 120 } },
    { id: 2, title: "TBD", datetime_utc: "2026-12-01T03:30:00", datetime_tbd: true, venue: { id: 9, location: { lat: 40.75, lon: -73.99 } } },
  ];
  const b = normalizeSeatGeek(raw, SYNC);
  it("normalises events, treating timestamps as UTC", () => {
    expect(b.events).toHaveLength(1);
    const e = b.events[0];
    expect(e.start).toBe("2026-11-10T00:30:00.000Z");
    expect(e.categorySlug).toBe("basketball");
    expect(e.timeZone).toBe("America/New_York");
    expect(e.participants.map((p) => p.role)).toEqual(["team_home", "team_away"]);
    expect(b.venues[0]).toMatchObject({ countryCode: "US", cityId: "new-york" });
  });
  it("shows the lowest listing as a marketplace price without fee claims", () => {
    expect(b.offers[0]).toMatchObject({ providerType: "marketplace", basePrice: 89, currency: "USD", availability: "available" });
    expect(b.offers[0].feesIncluded).toBeUndefined();
  });
});

describe("skiddle adapter", () => {
  const raw: SkEvent[] = [
    { id: "100", EventCode: "CLUB", eventname: "Warehouse Night", link: "https://www.skiddle.com/e/100", startdate: "2026-11-07T22:00:00+00:00", enddate: "2026-11-08T04:00:00+00:00", entryprice: "£15.00", ticketpricing: { minPrice: 12.5, maxPrice: 20 }, tickets: true, minage: "18", genres: [{ name: "Techno" }], venue: { id: 7, name: "The Warehouse", town: "Manchester", country: "England", latitude: 53.47, longitude: -2.24 }, artists: [{ artistid: 3, name: "DJ Fixture" }] },
    { id: "101", EventCode: "LIVE", eventname: "Dublin gig", link: "https://www.skiddle.com/e/101", date: "2026-11-08", openingtimes: { doorsopen: "19:00" }, entryprice: "Free", venue: { id: 8, name: "Pub", town: "Dublin", country: "Ireland", latitude: "53.34", longitude: "-6.26" } },
    { id: "102", eventname: "No venue" },
  ];
  const b = normalizeSkiddle(raw, SYNC);
  it("normalises events and maps genres", () => {
    expect(b.events.map((e) => e.id)).toEqual(["sk-e-100", "sk-e-101"]);
    const [club, gig] = b.events;
    expect(club.categorySlug).toBe("electronic");
    expect(club.ageRestriction?.minAge).toBe(18);
    expect(gig.start).toBe("2026-11-08T19:00:00.000Z"); // Dublin is on GMT in November
    expect(gig.isFree).toBe(true);
    expect(b.venues[1].countryCode).toBe("IE");
    expect(mapSkiddle("COMEDY")).toBe("stand-up");
  });
  it("uses the advertised minimum price in the right currency", () => {
    expect(b.offers[0]).toMatchObject({ basePrice: 12.5, maxPrice: 20, currency: "GBP", providerType: "primary" });
    expect(b.offers[0].feesIncluded).toBeUndefined();
    expect(b.offers[1]).toMatchObject({ label: "Free entry", currency: "" });
  });
});

describe("listings without hours", () => {
  it("are flagged so time-of-day searches skip them", () => {
    const m = normalizeMadrid([
      { id: "9", title: "Día", dtstart: "2026-11-02 00:00:00.0", dtend: "2026-11-02 23:59:00.0", time: "", location: { latitude: 40.4, longitude: -3.7 } },
      { id: "8", title: "Midnight placeholder", dtstart: "2026-10-08 00:00:00.0", dtend: "2027-05-31 23:59:00.0", time: "00:00", location: { latitude: 40.4, longitude: -3.7 } },
    ], SYNC, NOW);
    expect(m.events.map((e) => e.hoursUnknown)).toEqual([true, true]);
    const p = normalizeParis([{ id: "1", title: "Expo", lat_lon: { lat: 48.8, lon: 2.3 }, date_start: "2026-10-01T00:00:00+00:00", date_end: "2026-12-01T23:59:59+00:00" }], SYNC, NOW);
    expect(p.events[0].hoursUnknown).toBe(true);
    const q = normalizeParis([{ id: "2", title: "Day", lat_lon: { lat: 48.8, lon: 2.3 }, occurrences: "2026-11-03T00:00:00+01:00_2026-11-03T23:59:00+01:00" }], SYNC, NOW);
    expect(q.events[0].hoursUnknown).toBe(true);
  });
});
