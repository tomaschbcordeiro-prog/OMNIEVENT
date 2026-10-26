import { describe, expect, it } from "vitest";
import { mapChicagoCategory, normalizeChicago, type CpdRow, type CplRow } from "@/lib/providers/chicago";
import fixture from "./fixtures/chicago.json";

const now = Date.parse("2026-10-26T12:00:00Z");
const lib = (o: Partial<CplRow> = {}): CplRow => ({
  event_id: "abc",
  title: "Story Time",
  event_types: "Storytimes",
  event_audiences: "Kids",
  event_page: { url: "https://chipublib.bibliocommons.com/events/abc" },
  location_name: "West Pullman",
  location_address: "830 W. 119th Street",
  location_zip: "60643",
  location: { coordinates: [-87.643279, 41.677937] },
  start: "2026-11-11T13:00:00.000",
  end: "2026-11-11T14:00:00.000",
  registration_status: "NOT REQUIRED",
  ...o,
});
const park = (o: Partial<CpdRow> = {}): CpdRow => ({
  activity_id: "1",
  type: "Program",
  activity_type: "Open",
  title: "Basketball - Open at Rosenblum",
  start_date: "2026-09-12T12:00:00.000",
  end_date: "2026-12-12T14:00:00.000",
  date_notes: "Each Saturday from 12pm to 2pm",
  location_facility: "Rosenblum (J. Leslie) Park",
  category: "Sports - Basketball",
  fee: "0",
  address: "7547 S. Euclid Ave.",
  zip: "60649",
  latitude: "41.7579221",
  longitude: "-87.5788199",
  ...o,
});

describe("Chicago", () => {
  it("maps a real sample, leaving out paid courses", () => {
    const out = normalizeChicago(fixture.library as CplRow[], fixture.parks as CpdRow[], "x", now);
    expect(out.events.filter((e) => e.id.startsWith("chi-lib-")).length).toBeGreaterThan(10);
    expect(out.events.filter((e) => e.id.startsWith("chi-park-"))).toHaveLength(12);
  });
  it("reads a library event in Chicago time", () => {
    const out = normalizeChicago([lib()], [], "x", now);
    expect(out.events[0]).toMatchObject({ title: "Story Time", start: "2026-11-11T19:00:00.000Z", categorySlug: "family-shows", isFree: true, ticketAccess: "free" });
    expect(out.venues[0]).toMatchObject({ name: "West Pullman Library", city: "Chicago", countryCode: "US" });
  });
  it("keeps park events and drop-ins as runs of days", () => {
    const out = normalizeChicago([], [park(), park({ activity_id: "2", type: "Event", activity_type: undefined, title: "Halloween Fest", start_date: "2026-10-31T12:00:00.000", end_date: "2026-10-31T15:00:00.000" })], "x", now);
    expect(out.events[0]).toMatchObject({ eventType: "multi_day", categorySlug: "sports", hoursUnknown: true });
    expect(out.events[1]).toMatchObject({ eventType: "single", title: "Halloween Fest" });
  });
  it("skips cancelled, past, unplaced and paid classes", () => {
    const out = normalizeChicago(
      [lib({ cancelled: true }), lib({ event_id: "2", start: "2026-01-01T10:00:00.000", end: "2026-01-01T11:00:00.000" }), lib({ event_id: "3", location: null })],
      [park({ activity_type: "Instruction" }), park({ activity_id: "5", latitude: undefined })],
      "x",
      now,
    );
    expect(out.events).toHaveLength(0);
  });
  it("maps categories", () => {
    expect(mapChicagoCategory("Author Talk")).toBe("public-lectures");
    expect(mapChicagoCategory("Crafts, Games and Play")).toBe("creative-workshops");
    expect(mapChicagoCategory("Aquatics - Swim")).toBe("sports");
  });
});
