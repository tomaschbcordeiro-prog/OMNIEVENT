import { describe, expect, it } from "vitest";
import { mapBneCategory, normalizeBrisbane, type BneSession } from "@/lib/providers/brisbane";
import rows from "./fixtures/brisbane.json";

const now = Date.parse("2026-10-26T12:00:00Z");
const link = (q: string, text: string) => `<a href="http://maps.google.com/?q=${q}" target="_blank" rel="noopener">${text}</a>`;
const s = (o: Partial<BneSession> = {}): BneSession => ({
  eventID: "1",
  title: "Mums and bubs yoga",
  startDateTime: "2026-11-07T09:30:00",
  endDateTime: "2026-11-07T10:30:00",
  startTimeZoneOffset: "+1000",
  endTimeZoneOffset: "+1000",
  allDay: "False",
  canceled: "False",
  permaLinkUrl: "https://www.brisbane.qld.gov.au/trumba?trumbaEmbed=view%3Devent%26eventid%3D1",
  categoryCalendar: "Brisbane's calendar|Active parks",
  customFields: [
    { label: "Venue", value: "Teralba Park, Everton Park" },
    { label: "Venue address", value: link("-27.403471,152.980156(Teralba+Park)", "Teralba Park, 120 Pullen Road, Everton Park") },
    { label: "Cost", value: "Free" },
    { label: "Event type", value: "Fitness &amp; well-being, Free" },
  ],
  ...o,
});

describe("Brisbane City Council", () => {
  it("maps a real sample", () => {
    const out = normalizeBrisbane(rows as BneSession[], "x", now);
    expect(out.events.length).toBeGreaterThan(15);
    for (const v of out.venues) expect(v.lat).toBeLessThan(-26.9);
  });
  it("reads coordinates from the map link and Brisbane time", () => {
    const out = normalizeBrisbane([s()], "x", now, {});
    expect(out.events[0]).toMatchObject({ start: "2026-11-06T23:30:00.000Z", categorySlug: "family-shows", isFree: true, eventType: "single" });
    expect(out.venues[0]).toMatchObject({ name: "Teralba Park, Everton Park", lat: -27.403471, countryCode: "AU", address: "Teralba Park, 120 Pullen Road, Everton Park" });
  });
  it("joins sessions of an activity at a venue", () => {
    const out = normalizeBrisbane([s(), s({ eventID: "2", startDateTime: "2026-11-14T09:30:00", endDateTime: "2026-11-14T10:30:00" })], "x", now, {});
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ eventType: "recurring", schedule: ["2026-11-13T23:30:00.000Z"] });
  });
  it("uses the located-venue table, else skips the venue", () => {
    const noLink = s({ customFields: [{ label: "Venue", value: "Chermside Library" }, { label: "Venue address", value: link("375+Hamilton+Rd", "Chermside Library, 375 Hamilton Road") }] });
    expect(normalizeBrisbane([noLink], "x", now, { "Chermside Library": { lat: -27.386, lng: 153.035 } }).events).toHaveLength(1);
    const out = normalizeBrisbane([noLink], "x", now, {});
    expect(out.events).toHaveLength(0);
    expect(out.unplaced).toBe(1);
  });
  it("skips cancelled, past and mobile library stops", () => {
    const out = normalizeBrisbane(
      [s({ canceled: "True" }), s({ eventID: "3", startDateTime: "2026-01-01T09:00:00", endDateTime: "2026-01-01T10:00:00" }), s({ eventID: "4", title: "Brighton mobile library" })],
      "x",
      now,
      {},
    );
    expect(out.events).toHaveLength(0);
  });
  it("maps categories", () => {
    expect(mapBneCategory("Markets Jan Powers Farmers Market")).toBe("street-festivals");
    expect(mapBneCategory("Planetarium show")).toBe("science-exhibitions");
    expect(mapBneCategory("Active parks Bootcamp")).toBe("sports");
  });
});
