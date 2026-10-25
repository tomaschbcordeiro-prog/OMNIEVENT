import { describe, expect, it } from "vitest";
import { mapNycCategory, normalizeNycParks, type NycRow } from "@/lib/providers/nyc-parks";
import ROWS from "./fixtures/nyc-parks.json";

describe("NYC Parks", () => {
  it("leaves out weekly fitness classes", () => {
    expect(mapNycCategory("Fitness | Shape Up NYC | Exercise Classes")).toBeUndefined();
    expect(mapNycCategory("Arts & Crafts | Games | Best for Kids")).toBe("kids-festivals");
    expect(mapNycCategory("Art | History | Tours | Waterfront")).toBe("guided-tours");
  });
  it("normalises real rows in New York time", () => {
    const out = normalizeNycParks(ROWS as NycRow[], "x", Date.parse("2026-10-20T00:00:00Z"));
    expect(out.events).toHaveLength(2);
    const e = out.events[0];
    expect(e).toMatchObject({ isFree: true, timeZone: "America/New_York" });
    expect(out.venues[0]).toMatchObject({ countryCode: "US", city: "New York" });
  });
});
