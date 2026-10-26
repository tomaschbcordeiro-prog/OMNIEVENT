import { describe, expect, it } from "vitest";
import { mapWdCategory, normalizeWikidata, type WdItem } from "@/lib/providers/wikidata";

const now = Date.parse("2026-10-26T12:00:00Z");
const item = (o: Partial<WdItem> = {}): WdItem => ({
  id: "Q115000000",
  label: "2027 Portuguese Grand Prix",
  types: ["Formula One Grand Prix"],
  place: "Autódromo Internacional do Algarve",
  lat: 37.227,
  lng: -8.6267,
  cc: "PT",
  url: "https://en.wikipedia.org/wiki/2027_Portuguese_Grand_Prix",
  start: "2027-06-17T00:00:00Z",
  end: "2027-06-19T00:00:00Z",
  ...o,
});

describe("Wikidata big events", () => {
  it("reads a dated event at its venue, by date only", () => {
    const out = normalizeWikidata([item()], "x", now);
    expect(out.events[0]).toMatchObject({ title: "2027 Portuguese Grand Prix", categorySlug: "sports", eventType: "multi_day", hoursUnknown: true, timeZone: "Europe/Lisbon", start: "2027-06-16T23:00:00.000Z" });
    expect(out.venues[0]).toMatchObject({ name: "Autódromo Internacional do Algarve", countryCode: "PT", country: "Portugal" });
  });
  it("keeps only event kinds people attend, with a day-precise date", () => {
    const out = normalizeWikidata(
      [
        item({ id: "Q1", start: undefined }),
        item({ id: "Q2", types: ["sports season"] }),
        item({ id: "Q3", types: ["election"] }),
        item({ id: "Q4", label: "Q4" }),
        item({ id: "Q5", start: "2026-01-01T00:00:00Z", end: undefined }),
      ],
      "x",
      now,
    );
    expect(out.events).toHaveLength(0);
  });
  it("maps categories", () => {
    expect(mapWdCategory(["Summer Olympic Games edition"], "2028 Summer Olympics")).toBe("sports");
    expect(mapWdCategory(["concert"], "Arirang World Tour - Sydney")).toBe("concerts");
    expect(mapWdCategory(["world's fair"], "Expo 2030")).toBe("art-exhibitions");
  });
});
