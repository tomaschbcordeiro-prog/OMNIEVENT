import { describe, expect, it } from "vitest";
import { normalizeLiveWhale, type LwEvent } from "@/lib/providers/livewhale";
import rows from "./fixtures/livewhale.json";

const now = Date.parse("2026-10-26T06:00:00Z");
const host = { host: "events.uchicago.edu", name: "University of Chicago" };
const ev = (o: Partial<LwEvent> = {}): LwEvent => ({
  id: 1,
  title: "Chamber Music Recital",
  url: "https://events.uchicago.edu/live/events/1-recital",
  date_iso: "2026-11-20T19:30:00-06:00",
  date2_iso: "2026-11-20T21:00:00-06:00",
  timezone: "America/Chicago",
  location_title: "Logan Center",
  location: "915 E 60th St",
  location_latitude: "41.7856",
  location_longitude: "-87.6036",
  event_types: ["Arts"],
  event_types_audience: ["Public"],
  cost: "Free",
  ...o,
});

describe("LiveWhale calendars", () => {
  it("maps a real sample", () => {
    const out = normalizeLiveWhale(rows as unknown as LwEvent[], host, "x", now);
    expect(out.events.length).toBeGreaterThan(3);
    for (const v of out.venues) expect(v).toMatchObject({ countryCode: "US", timeZone: "America/Chicago" });
  });
  it("reads an event with its venue and time", () => {
    const out = normalizeLiveWhale([ev()], host, "x", now);
    expect(out.events[0]).toMatchObject({ categorySlug: "classical", start: "2026-11-21T01:30:00.000Z", isFree: true });
    expect(out.venues[0]).toMatchObject({ name: "Logan Center", address: "915 E 60th St", lat: 41.7856 });
  });
  it("joins occurrences that share a parent", () => {
    const out = normalizeLiveWhale([ev({ parent: 9 }), ev({ id: 2, parent: 9, date_iso: "2026-11-27T19:30:00-06:00", date2_iso: null })], host, "x", now);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ eventType: "recurring", schedule: ["2026-11-28T01:30:00.000Z"] });
  });
  it("leaves out cancelled, online-only, internal, non-public and unplaced events", () => {
    const out = normalizeLiveWhale(
      [
        ev({ id: 3, is_canceled: 1 }),
        ev({ id: 4, is_online: 1, online_type: "only" }),
        ev({ id: 5, title: "Registration deadline" }),
        ev({ id: 6, event_types_audience: ["Staff", "Graduate Student"] }),
        ev({ id: 7, location_latitude: null }),
      ],
      host,
      "x",
      now,
    );
    expect(out.events).toHaveLength(0);
  });
  it("records an advertised price", () => {
    const out = normalizeLiveWhale([ev({ cost: "$20 general admission" })], host, "x", now);
    expect(out.offers[0]).toMatchObject({ basePrice: 20, currency: "USD" });
  });
});
