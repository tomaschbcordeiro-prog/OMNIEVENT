import { describe, expect, it } from "vitest";
import { addDays, bestOrder, codeOf, daysOf, extendFor, fitOf, fitSpan, flagOf, moveBoundary, nightsBetween, REGIONS, routeKm, splitNights, stopOn, suggestName, withNights, type TripStop } from "@/lib/trip";

const benelux = REGIONS.find((r) => r.id === "benelux")!.places;
const stops = (start: string, nights: number[]): TripStop[] => withNights(benelux.map((p, i) => ({ ...p, id: `s${i}`, from: "", to: "" })), start, nights);

describe("dates and nights", () => {
  it("counts nights and days", () => {
    expect(nightsBetween("2027-06-01", "2027-06-08")).toBe(7);
    expect(nightsBetween("2027-06-01", "2027-06-01")).toBe(0);
    expect(daysOf("2027-06-30", "2027-07-02")).toEqual(["2027-06-30", "2027-07-01", "2027-07-02"]);
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
  });

  it("shares a trip's nights between its stops, the first ones getting any extra", () => {
    expect(splitNights("2027-06-01", "2027-06-08", 3)).toEqual([
      { from: "2027-06-01", to: "2027-06-04" },
      { from: "2027-06-04", to: "2027-06-06" },
      { from: "2027-06-06", to: "2027-06-08" },
    ]);
  });

  it("moves nights between neighbouring stops, never below one", () => {
    expect(moveBoundary([3, 2, 2], 0, 1)).toEqual([4, 1, 2]);
    expect(moveBoundary([3, 2, 2], 0, 5)).toEqual([4, 1, 2]);
    expect(moveBoundary([3, 2, 2], 1, -1)).toEqual([3, 1, 3]);
    expect(moveBoundary([1, 2], 0, -1)).toEqual([1, 2]);
    expect(moveBoundary([3, 2], 1, 1)).toEqual([3, 2]);
  });

  it("finds the stop for each day", () => {
    const s = stops("2027-06-01", [3, 2, 2]);
    expect(stopOn(s, "2027-06-02")?.name).toBe("Amsterdam");
    expect(stopOn(s, "2027-06-04")?.name).toBe("Brussels");
    expect(stopOn(s, "2027-06-08")?.name).toBe("Luxembourg");
    expect(stopOn(s, "2027-06-09")).toBeUndefined();
  });
});

describe("route", () => {
  it("visits the stops in the shortest order, starting where the trip starts", () => {
    const zigzag = [benelux[0], benelux[2], benelux[1]];
    const best = bestOrder(zigzag);
    expect(best.map((p) => p.name)).toEqual(["Amsterdam", "Brussels", "Luxembourg"]);
    expect(routeKm(best)).toBeLessThan(routeKm(zigzag));
  });
});

describe("where an event fits", () => {
  const s = stops("2027-06-01", [3, 2, 2]);
  it("on a day spent near a stop", () => {
    const fit = fitOf(s, { lat: 50.84, lng: 4.36, day: "2027-06-05" });
    expect(fit.ok && fit.stop.name).toBe("Brussels");
  });
  it("says why it doesn't", () => {
    expect(fitOf(s, { lat: 50.84, lng: 4.36, day: "2027-06-02" })).toMatchObject({ ok: false, why: "wrong-days" });
    expect(fitOf(s, { lat: 50.84, lng: 4.36, day: "2027-05-20" })).toMatchObject({ ok: false, why: "before" });
    expect(fitOf(s, { lat: 49.61, lng: 6.13, day: "2027-06-12" })).toMatchObject({ ok: false, why: "after" });
    expect(fitOf(s, { lat: 38.72, lng: -9.14, day: "2027-06-02" })).toMatchObject({ ok: false, why: "elsewhere" });
  });
});

describe("names and labels", () => {
  it("names a trip after its region, country or city", () => {
    expect(suggestName(benelux, "2027-06-01")).toBe("Benelux 2027");
    expect(suggestName(REGIONS.find((r) => r.id === "japan")!.places, "2027-04-03")).toBe("Japan, April 2027");
    expect(suggestName(REGIONS.find((r) => r.id === "iberia")!.places, "2027-09-10")).toBe("Iberia 2027");
    expect(suggestName([benelux[0]], "2027-06-01")).toBe("Amsterdam, June 2027");
    expect(suggestName([{ name: "Paris", country: "France", countryCode: "FR" }, { name: "Rome", country: "Italy", countryCode: "IT" }], "2027-05-01")).toBe("France & Italy 2027");
    expect(suggestName([], undefined)).toBe("My trip");
  });

  it("flags and codes", () => {
    expect(flagOf("nl")).toBe("🇳🇱");
    expect(flagOf(undefined)).toBe("");
    expect(codeOf("São Paulo")).toBe("SAO");
  });

  it("ready-made routes are in a sensible order already", () => {
    for (const r of REGIONS) expect(routeKm(bestOrder(r.places))).toBeGreaterThanOrEqual(routeKm(r.places) * 0.8);
  });
});

describe("stretching a trip for an event just outside it", () => {
  const s = stops("2027-06-01", [3, 2, 2]);
  const paris = { name: "Paris", country: "France", countryCode: "FR", lat: 48.8566, lng: 2.3522 };
  it("keeps the last city longer, or adds the event's city at the end", async () => {
    const lux = extendFor(s, { lat: 49.61, lng: 6.13, day: "2027-06-10", place: { name: "Luxembourg", lat: 49.61, lng: 6.13 } });
    expect(lux?.stops.at(-1)).toMatchObject({ name: "Luxembourg", to: "2027-06-10" });
    const p = extendFor(s, { lat: paris.lat, lng: paris.lng, day: "2027-06-10", place: paris });
    expect(p?.stops.at(-1)).toMatchObject({ name: "Paris", from: "2027-06-08", to: "2027-06-11" });
    expect(p?.label).toMatch(/Add Paris after Luxembourg/);
  });
  it("starts earlier, or begins in the event's city", () => {
    const ams = extendFor(s, { lat: 52.37, lng: 4.9, day: "2027-05-29", place: { name: "Amsterdam", lat: 52.37, lng: 4.9 } });
    expect(ams?.stops[0]).toMatchObject({ name: "Amsterdam", from: "2027-05-29" });
    const p = extendFor(s, { lat: paris.lat, lng: paris.lng, day: "2027-05-28", place: paris });
    expect(p?.stops[0]).toMatchObject({ name: "Paris", from: "2027-05-28", to: "2027-06-01" });
  });
  it("leaves trips alone for events within their dates", () => {
    expect(extendFor(s, { lat: paris.lat, lng: paris.lng, day: "2027-06-03", place: paris })).toBeNull();
  });
});

describe("events that run for days", () => {
  const s = stops("2027-06-01", [3, 2, 2]);
  it("fit on any of their days spent nearby", () => {
    const expo = { lat: 50.84, lng: 4.36, day: "2027-05-01", until: "2027-06-05" };
    expect(fitOf(s, expo)).toMatchObject({ ok: false, why: "before" });
    const f = fitSpan(s, expo);
    expect(f.ok && f.stop.name).toBe("Brussels");
  });
  it("say why they don't", () => {
    expect(fitSpan(s, { lat: 50.84, lng: 4.36, day: "2027-05-01", until: "2027-05-20" })).toMatchObject({ ok: false, why: "before" });
    expect(fitSpan(s, { lat: 50.84, lng: 4.36, day: "2027-05-01", until: "2027-06-02" })).toMatchObject({ ok: false, why: "wrong-days" });
    expect(fitSpan(s, { lat: 38.72, lng: -9.14, day: "2027-05-01", until: "2027-07-01" })).toMatchObject({ ok: false, why: "elsewhere" });
  });
});

describe("an event's days, for a trip", () => {
  const base = { lat: 50.84, lng: 4.36, start: "2027-06-04T19:00:00.000Z", timeZone: "Europe/Brussels" };
  it("a single evening, a run, and a place open every day", async () => {
    const { spanOf } = await import("@/lib/trip-snap");
    expect(spanOf({ ...base, eventType: "single" })).toEqual({ lat: 50.84, lng: 4.36, day: "2027-06-04", until: undefined });
    expect(spanOf({ ...base, eventType: "multi_day", until: "2027-06-20T18:00:00.000Z" }).until).toBe("2027-06-20");
    const daily = spanOf({ ...base, start: "2026-01-01T09:00:00.000Z", eventType: "daily_attraction" });
    const f = fitSpan(stops("2027-06-01", [3, 2, 2]), daily);
    expect(f.ok && f.stop.name).toBe("Brussels");
  });
});
