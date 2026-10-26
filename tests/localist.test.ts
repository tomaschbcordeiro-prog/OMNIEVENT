import { describe, expect, it } from "vitest";
import { mapLocalistCategory, normalizeLocalist, type LocalistEvent } from "@/lib/providers/localist";
import rows from "./fixtures/localist.json";

const now = Date.parse("2026-10-26T12:00:00Z");
const host = { host: "events.stanford.edu", name: "Stanford University" };
const ev = (o: Partial<LocalistEvent> = {}): LocalistEvent => ({
  id: 1,
  title: "Stanford Symphony Orchestra",
  status: "live",
  experience: "inperson",
  private: false,
  free: true,
  location_name: "Bing Concert Hall",
  address: "327 Lasuen St, Stanford, CA 94305",
  venue_id: 9,
  localist_url: "https://events.stanford.edu/event/sso",
  geo: { latitude: "37.4325", longitude: "-122.1662", city: "Stanford", state: "CA", country: "US" },
  filters: { event_types: [{ name: "Performance" }], event_audience: [{ name: "Everyone" }] },
  event_instances: [{ event_instance: { id: 11, start: "2026-11-20T19:30:00-08:00", end: "2026-11-20T21:30:00-08:00", all_day: false } }],
  ...o,
});

describe("Localist calendars", () => {
  it("maps a real sample", () => {
    const out = normalizeLocalist(rows as unknown as LocalistEvent[], host, "x", now);
    expect(out.events.length).toBeGreaterThan(10);
    for (const v of out.venues) expect(v).toMatchObject({ countryCode: "US", timeZone: "America/Los_Angeles" });
  });
  it("reads an event with its venue, time zone and link", () => {
    const out = normalizeLocalist([ev()], host, "x", now);
    expect(out.events[0]).toMatchObject({ title: "Stanford Symphony Orchestra", categorySlug: "classical", start: "2026-11-21T03:30:00.000Z", isFree: true, officialUrl: "https://events.stanford.edu/event/sso" });
    expect(out.venues[0]).toMatchObject({ name: "Bing Concert Hall", city: "Stanford", timeZone: "America/Los_Angeles" });
  });
  it("joins occurrences of an event", () => {
    const second = ev({ event_instances: [{ event_instance: { id: 12, start: "2026-11-21T19:30:00-08:00", all_day: false } }] });
    const out = normalizeLocalist([ev(), second], host, "x", now);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ eventType: "recurring", schedule: ["2026-11-22T03:30:00.000Z"] });
  });
  it("leaves out online, private, internal, staff-only and unplaced entries", () => {
    const out = normalizeLocalist(
      [
        ev({ id: 2, experience: "virtual" }),
        ev({ id: 3, private: true }),
        ev({ id: 4, title: "Last day to drop classes" }),
        ev({ id: 5, filters: { event_audience: [{ name: "Faculty" }, { name: "Staff" }] } }),
        ev({ id: 6, geo: { latitude: null, longitude: null } }),
        ev({ id: 7, event_instances: [{ event_instance: { id: 70, start: "2026-01-01T10:00:00-08:00", all_day: false } }] }),
      ],
      host,
      "x",
      now,
    );
    expect(out.events).toHaveLength(0);
  });
  it("keeps paid events with their ticket link", () => {
    const out = normalizeLocalist([ev({ free: false, ticket_cost: "$15 general, $5 students", ticket_url: "https://tickets.stanford.edu/x" })], host, "x", now);
    expect(out.offers[0]).toMatchObject({ basePrice: 15, currency: "USD", provider: "tickets.stanford.edu" });
  });
  it("maps categories", () => {
    expect(mapLocalistCategory("Lecture/Presentation/Talk")).toBe("public-lectures");
    expect(mapLocalistCategory("Exhibition")).toBe("art-exhibitions");
    expect(mapLocalistCategory("Athletics Women's Basketball")).toBe("sports");
  });
});
