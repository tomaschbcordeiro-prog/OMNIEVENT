import { describe, it, expect } from "vitest";
import { parseQuery } from "@/lib/search/parse";

// Thursday 23 Oct 2026, noon UTC
const now = new Date("2026-10-22T12:00:00Z");
const P = (q: string) => parseQuery(q, { now, timeZone: "UTC" });

describe("natural-language query parser", () => {
  it("football in London this weekend", () => {
    const r = P("Football matches in London this weekend");
    expect(r.filters.categories).toEqual(["football"]);
    expect(r.filters.city).toBe("london");
    expect(r.filters.from).toBe("2026-10-23");
    expect(r.filters.to).toBe("2026-10-25");
    expect(r.filters.q).toBeUndefined();
  });
  it("concerts in Lisbon next month", () => {
    const r = P("Concerts in Lisbon next month");
    // "concerts" means live music in general → whole Music group
    expect(r.filters.categories).toEqual(["music"]);
    expect(r.filters.city).toBe("lisbon");
    expect([r.filters.from, r.filters.to]).toEqual(["2026-11-01", "2026-11-30"]);
  });
  it("formula racing in Europe → motorsport + continent", () => {
    const r = P("Formula racing events in Europe");
    expect(r.filters.categories).toEqual(["motorsport"]);
    expect(r.filters.continent).toBe("europe");
  });
  it("broadway musicals under $100", () => {
    const r = P("Broadway musicals under $100");
    expect(r.filters.categories).toEqual(["musicals"]);
    expect(r.filters.maxPrice).toBe(100);
    expect(r.filters.currency).toBe("USD");
  });
  it("explicit date range", () => {
    const r = P("Find football matches in London between November 10 and November 15");
    expect([r.filters.from, r.filters.to]).toEqual(["2026-11-10", "2026-11-15"]);
    expect(r.filters.city).toBe("london");
  });
  it("short range 'between November 10 and 15'", () => {
    const r = P("concerts between November 10 and 15");
    expect([r.filters.from, r.filters.to]).toEqual(["2026-11-10", "2026-11-15"]);
  });
  it("family activities in Paris under €50", () => {
    const r = P("Find family activities in Paris under €50");
    expect(r.filters.family).toBe(true);
    expect(r.filters.city).toBe("paris");
    expect(r.filters.maxPrice).toBe(50);
    expect(r.filters.currency).toBe("EUR");
  });
  it("festivals in Brazil next summer uses southern hemisphere", () => {
    const r = P("Festivals in Brazil next summer");
    expect(r.filters.country).toBe("BR");
    expect(r.filters.categories).toEqual(["festivals"]);
    expect(r.filters.from).toBe("2026-12-01");
    expect(r.filters.to).toBe("2027-02-28");
    expect(r.ambiguities.join(" ")).toMatch(/southern/);
  });
  it("events happening today in Paris", () => {
    const r = P("Events happening today in Paris");
    expect([r.filters.from, r.filters.to]).toEqual(["2026-10-22", "2026-10-22"]);
    expect(r.filters.city).toBe("paris");
    expect(r.filters.q).toBeUndefined();
  });
  it("typo tolerance flags the interpretation", () => {
    const r = P("concerts in Lisbn");
    expect(r.filters.city).toBe("lisbon");
    expect(r.ambiguities.some((a) => a.includes("Lisbon"))).toBe(true);
  });
  it("tickets I can buy → on sale", () => {
    const r = P("Show Formula racing events I can buy tickets for");
    expect(r.filters.status).toEqual(["on_sale"]);
    expect(r.filters.categories).toEqual(["motorsport"]);
  });
  it("museums and immersive experiences in Tokyo next week", () => {
    const r = P("Find museums and immersive experiences in Tokyo next week");
    expect(r.filters.city).toBe("tokyo");
    expect(r.filters.categories).toContain("exhibitions");
    expect(r.filters.categories).toContain("immersive-experiences");
    expect([r.filters.from, r.filters.to]).toEqual(["2026-10-26", "2026-11-01"]);
  });
  it("keeps free text as residual query", () => {
    const r = P("velvet orbits");
    expect(r.filters.q).toBe("velvet orbits");
  });
});
