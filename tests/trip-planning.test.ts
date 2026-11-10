import { describe, expect, it } from "vitest";
import { addDays, bestOrder, codeOf, daysOf, fitOf, flagOf, moveBoundary, nightsBetween, REGIONS, routeKm, splitNights, stopOn, suggestName, withNights, type TripStop } from "@/lib/trip";

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
