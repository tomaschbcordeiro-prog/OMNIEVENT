import { describe, expect, it } from "vitest";
import { mapMunicipalCategory, normalizeCantanhede, normalizeMunicipalTribe, normalizeOurem, type CantanhedeRow, type OuremRow } from "@/lib/providers/pt-municipios";
import type { TribeEvent } from "@/lib/providers/venue-calendars";
import fx from "./fixtures/pt-municipios.json";

const now = Date.parse("2026-10-26T00:00:00Z");

describe("Portuguese municipal agendas", () => {
  it("reads Ourém at the municipality centre, saying so", () => {
    const out = normalizeOurem(fx.ourem as OuremRow[], "x", now);
    expect(out.events.length).toBeGreaterThan(3);
    expect(out.venues[0]).toMatchObject({ city: "Ourém", countryCode: "PT" });
    expect(out.venues[0].address).toMatch(/shown at the centre of Ourém/);
  });
  it("reads Cantanhede with its links", () => {
    const out = normalizeCantanhede(fx.cantanhede as CantanhedeRow[], "x", now);
    expect(out.events.length).toBeGreaterThan(10);
    for (const e of out.events) expect(e.officialUrl).toMatch(/^https:\/\/www\.cm-cantanhede\.pt\/mcsite\/evento\//);
  });
  it("reads a council's Events Calendar, using venue positions when given", () => {
    const out = normalizeMunicipalTribe("santiago-do-cacem", fx.santiago as unknown as TribeEvent[], "x", now);
    expect(out.events.length).toBeGreaterThan(3);
    expect(out.venues.some((v) => !/shown at the centre/.test(v.address ?? ""))).toBe(true);
    for (const v of out.venues) expect(v.lat).toBeLessThan(38.5);
  });
  it("skips past events and parses dd-mm-yyyy dates", () => {
    const past: CantanhedeRow = { urlExt: "https://www.cm-cantanhede.pt/mcsite/evento/1/x", title: "Feira", data: "01-01-2026", endDate: "02-01-2026" };
    const next: CantanhedeRow = { ...past, urlExt: "https://www.cm-cantanhede.pt/mcsite/evento/2/y", data: "07-11-2026", endDate: "07-11-2026" };
    const out = normalizeCantanhede([past, next], "x", now);
    expect(out.events).toHaveLength(1);
    expect(out.events[0]).toMatchObject({ start: "2026-11-07T00:00:00.000Z", categorySlug: "street-festivals", hoursUnknown: true });
  });
  it("maps categories", () => {
    expect(mapMunicipalCategory("Caminhos d'Ourém")).toBe("guided-tours");
    expect(mapMunicipalCategory("AR|Exposições")).toBe("art-exhibitions");
    expect(mapMunicipalCategory("Concerto de Natal")).toBe("concerts");
  });
});
