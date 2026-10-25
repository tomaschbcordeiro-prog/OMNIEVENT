import { describe, expect, it } from "vitest";
import { mapCpCategory, normalizeCp, type CpEvent } from "@/lib/providers/cultura-portugal";
import ROWS from "./fixtures/cultura-portugal.json";

describe("Cultura Portugal", () => {
  const table = {
    __towns: { Lisboa: { lat: 38.7077, lng: -9.1366 }, Sintra: { lat: 38.8029, lng: -9.3817 } },
    "Sala Branca do Panteão Nacional|Lisboa": { lat: 38.715, lng: -9.1249 },
    "Universidade Lusófona|Lisboa": null,
    "Sintra (vários espaços)|Sintra": null,
  };
  const out = normalizeCp(ROWS as CpEvent[], "2026-10-25T08:00:00Z", Date.parse("2026-10-25T08:00:00Z"), table);
  const venueOf = (t: string) => out.venues.find((v) => v.id === out.events.find((e) => e.title.startsWith(t))!.venueId)!;

  it("uses located venues, otherwise the town centre with a note", () => {
    expect(venueOf("Lisboa Barroca")).toMatchObject({ name: "Sala Branca do Panteão Nacional", lat: 38.715 });
    expect(venueOf("Conferência").address).toMatch(/not found; shown at the centre of Lisboa/);
    expect(venueOf("FLIS").address).toMatch(/Several venues/);
  });

  it("uses dates only, and reads free entry and type", () => {
    const e = out.events.find((x) => x.title === "Lisboa Barroca")!;
    expect(e).toMatchObject({ hoursUnknown: true, isFree: true, eventType: "single" });
    expect(mapCpCategory({ Type: "Conferências" })).toBe("public-lectures");
    expect(mapCpCategory({ Type: "Exposições" })).toBe("art-exhibitions");
  });
});
