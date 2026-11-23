import { describe, expect, it } from "vitest";
import { recapText, recapWorthShowing, yearRecap } from "@/lib/recap";
import type { SavedSnap, Trip } from "@/lib/user/store";

const snap = (start: string, categorySlug: string, extra: Partial<SavedSnap> = {}): SavedSnap => ({
  slug: start + categorySlug,
  title: "An event",
  start,
  timeZone: "Europe/Lisbon",
  eventType: "single",
  venueName: "A venue",
  categorySlug,
  ...extra,
});
const saved = (at: string, s: SavedSnap) => ({ id: s.slug, at, snap: s });
const NOW = new Date("2026-11-20T12:00:00Z");

describe("yearRecap", () => {
  it("counts this year's saves, the ones ahead, and the main kinds", () => {
    const r = yearRecap(
      {
        saved: [
          saved("2026-02-01T10:00:00Z", snap("2026-02-06T21:00:00Z", "concerts")),
          saved("2026-03-01T10:00:00Z", snap("2026-03-13T21:30:00Z", "concerts")),
          saved("2026-05-01T10:00:00Z", snap("2026-05-08T20:00:00Z", "plays")),
          saved("2026-11-01T10:00:00Z", snap("2026-12-04T22:00:00Z", "concerts")),
          // saved last year: not this year's
          saved("2025-12-01T10:00:00Z", snap("2026-01-02T21:00:00Z", "concerts")),
        ],
        trips: [],
      },
      NOW,
    );
    expect(r.saved).toBe(4);
    expect(r.ahead).toBe(1);
    expect(r.kinds[0].group).toBe("music");
    expect(r.kinds[0].share).toBeCloseTo(0.75);
    // All four start on a Friday evening, Lisbon time.
    expect(r.topDay).toBe("Friday");
    expect(r.dayPart).toBe("night");
    expect(recapWorthShowing(r)).toBe(true);
  });

  it("only names a busiest day or month when one stands out", () => {
    const r = yearRecap(
      {
        saved: [
          saved("2026-01-01T10:00:00Z", snap("2026-01-05T10:00:00Z", "plays")), // Monday
          saved("2026-01-01T10:00:00Z", snap("2026-02-10T10:00:00Z", "plays")), // Tuesday
          saved("2026-01-01T10:00:00Z", snap("2026-03-11T10:00:00Z", "plays")), // Wednesday
        ],
        trips: [],
      },
      NOW,
    );
    expect(r.topDay).toBeUndefined();
    expect(r.topMonth).toBeUndefined();
    expect(r.dayPart).toBeUndefined(); // too few with times
  });

  it("adds up this year's trips: nights, cities and countries", () => {
    const trip = (start: string, end: string, stops: { name: string; countryCode: string }[]): Trip =>
      ({ id: start, name: "Trip", start, end, eventIds: [], createdAt: start, stops: stops.map((s, i) => ({ id: String(i), name: s.name, countryCode: s.countryCode, lat: 0, lng: 0, from: start, to: end })) }) as unknown as Trip;
    const r = yearRecap({ saved: [], trips: [trip("2026-04-01", "2026-04-08", [{ name: "Lisbon", countryCode: "PT" }, { name: "Porto", countryCode: "PT" }]), trip("2026-07-10", "2026-07-13", [{ name: "Madrid", countryCode: "ES" }]), trip("2025-07-10", "2025-07-13", [{ name: "Rome", countryCode: "IT" }])] }, NOW);
    expect(r.trips).toBe(2);
    expect(r.nights).toBe(10);
    expect(r.cities).toBe(3);
    expect(r.countries.sort()).toEqual(["ES", "PT"]);
    expect(recapWorthShowing(r)).toBe(true);
    expect(recapText(r)).toContain("2 trips, 10 nights in 2 countries");
  });

  it("isn't worth showing with almost nothing in it", () => {
    expect(recapWorthShowing(yearRecap({ saved: [saved("2026-01-01T10:00:00Z", snap("2026-02-01T10:00:00Z", "plays"))], trips: [] }, NOW))).toBe(false);
  });
});
