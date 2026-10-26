import { describe, expect, it } from "vitest";
import { ESPOO, normalizeHelsinki, mapHelCategory, type HelEvent } from "@/lib/providers/helsinki";
import { normalizeTaiwan, type TwEvent } from "@/lib/providers/taiwan";
import { normalizeMontreal, mapMtlCategory, type MtlProps } from "@/lib/providers/montreal";
import HEL from "./fixtures/helsinki.json";
import ESP from "./fixtures/espoo.json";
import TW from "./fixtures/taiwan.json";
import MTL from "./fixtures/montreal.json";

const NOW = Date.parse("2026-10-26T00:00:00Z");

describe("Helsinki Linked Events", () => {
  it("normalises real events with venue coordinates in Finland", () => {
    const out = normalizeHelsinki(HEL as unknown as HelEvent[], "x", NOW);
    expect(out.events.length).toBeGreaterThan(0);
    const v = out.venues[0];
    expect(v).toMatchObject({ countryCode: "FI", timeZone: "Europe/Helsinki" });
    expect(v.lat).toBeGreaterThan(59);
    expect(mapHelCategory(["Lastenkulttuuri", "teatteri"])).toBe("family-shows");
    expect(mapHelCategory(["konsertit"])).toBe("concerts");
  });
  it("reads Espoo's own instance with its event pages", () => {
    const out = normalizeHelsinki(ESP as unknown as HelEvent[], "x", NOW, ESPOO);
    expect(out.events.length).toBeGreaterThan(5);
    expect(out.events[0].provenance).toMatchObject({ provider: "espoo" });
    expect(out.events[0].provenance.sourceUrl).toMatch(/^https:\/\/www\.espoo\.fi\/en\/events\/espooevents:/);
    expect(out.venues[0]).toMatchObject({ countryCode: "FI", provenance: { provider: "espoo" } });
  });
});

describe("Taiwan Ministry of Culture", () => {
  it("makes one event per venue with its sessions, in Taipei time", () => {
    const out = normalizeTaiwan(TW as unknown as TwEvent[], "x", NOW);
    expect(out.events.length).toBeGreaterThan(0);
    for (const v of out.venues) expect(v).toMatchObject({ countryCode: "TW", timeZone: "Asia/Taipei" });
    const e = out.events[0];
    expect(Date.parse(e.start)).toBeGreaterThan(NOW - 86400000 * 400);
  });
});

describe("Montréal public events", () => {
  it("keeps public activities and leaves council meetings out", () => {
    const rows = MTL as unknown as MtlProps[];
    const out = normalizeMontreal(rows, "x", NOW);
    const council = rows.filter((r) => /conseil/i.test(r.type_evenement ?? "")).length;
    expect(council).toBeGreaterThan(0);
    expect(out.events.some((e) => /conseil/i.test(e.title) && /séance/i.test(e.title))).toBe(false);
    expect(out.venues[0]).toMatchObject({ countryCode: "CA", city: "Montréal" });
    expect(out.events.every((e) => e.hoursUnknown)).toBe(true);
    expect(mapMtlCategory("Heure du conte")).toBe("family-shows");
  });
});
