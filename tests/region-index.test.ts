import { describe, expect, it } from "vitest";
import { __testing, searchEvents } from "@/lib/store";
import { generateDemoData } from "@/lib/providers/demo";

describe("country and continent searches", () => {
  it("find the same events as looking through every card", () => {
    const base = generateDemoData(new Date("2026-11-08T10:00:00Z"));
    __testing.load("regions", { ...base, events: base.events.map((e) => ({ ...e, provenance: { ...e.provenance, provider: "regions", isDemo: false } })) });
    __testing.rebuild();
    const all = searchEvents({ pageSize: 100, status: undefined });
    const codes = [...new Set(base.venues.map((v) => v.countryCode))];
    expect(codes.length).toBeGreaterThan(1);
    const venueCountry = new Map(base.venues.map((v) => [v.id, v.countryCode]));
    const eventCountry = new Map(base.events.map((e) => [e.id, venueCountry.get(e.venueId)]));
    for (const cc of codes) {
      const r = searchEvents({ country: cc, pageSize: 100 });
      // Every result is in that country, and none is missing.
      expect(r.items.every((c) => eventCountry.get(c.id) === cc)).toBe(true);
      const everyCard = searchEvents({ pageSize: 100 }).total;
      expect(r.total).toBeLessThanOrEqual(everyCard);
    }
    const sum = codes.reduce((n, cc) => n + searchEvents({ country: cc }).total, 0);
    expect(sum).toBe(searchEvents({}).total);
    expect(all.total).toBeGreaterThan(0);
    __testing.drop("regions");
    __testing.rebuild();
  });
});
