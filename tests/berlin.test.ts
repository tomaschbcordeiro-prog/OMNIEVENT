import { describe, expect, it } from "vitest";
import { mapBerlinCategory, normalizeBerlin, type BerlinEvent } from "@/lib/providers/berlin";
import ROWS from "./fixtures/berlin.json";

describe("kulturdaten.berlin", () => {
  const rows = ROWS as unknown as BerlinEvent[];
  const table = Object.fromEntries(rows.map((r, i) => [r.locations![0].referenceId!, i % 2 ? null : { lat: 52.5 + i / 1000, lng: 13.4 }]));
  const out = normalizeBerlin(rows, "x", Date.parse("2026-10-01T00:00:00Z"), table);
  it("keeps located events in Berlin time and skips unplaced ones", () => {
    expect(out.unplaced).toBeGreaterThan(0);
    for (const v of out.venues) expect(v).toMatchObject({ countryCode: "DE", timeZone: "Europe/Berlin", city: "Berlin" });
    expect(out.events.length + out.unplaced).toBeLessThanOrEqual(rows.length);
  });
  it("maps categories and leaves non-cultural entries out", () => {
    expect(mapBerlinCategory("Gruselwoche: Ausstellung - Skurrile Tiere")).toBe("art-exhibitions");
    expect(mapBerlinCategory("Kinderkonzert im Park")).toBe("family-shows");
    const police = normalizeBerlin([{ identifier: "E_X", attractions: [{ referenceLabel: { de: "Standort der mobilen Wache" } }], locations: [{ referenceId: "L1" }], schedule: { startDate: "2026-12-01" } }], "x", 0, { L1: { lat: 52.5, lng: 13.4 } });
    expect(police.events).toHaveLength(0);
  });
});
