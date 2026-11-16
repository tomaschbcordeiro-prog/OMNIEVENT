import { describe, expect, it } from "vitest";
import { findCountries, findPlaces, ideaFromKey, ideasPage, kmBetween, makeIdea, parseRouteParam, PLACES, planHref, routeParam, shareNights, THEMES } from "@/lib/travel/ideas";

describe("places to travel to", () => {
  it("are many, real-looking and themed", () => {
    expect(PLACES.length).toBeGreaterThan(900);
    const letters = new Set(THEMES.map((t) => t.key));
    for (const p of PLACES) {
      expect(Math.abs(p.lat)).toBeLessThanOrEqual(90);
      expect(Math.abs(p.lng)).toBeLessThanOrEqual(180);
      expect(p.themes.length).toBeGreaterThan(0);
      for (const t of p.themes) expect(letters.has(t as never)).toBe(true);
    }
    // A few we know.
    const lisbon = PLACES.find((p) => p.name === "Lisbon")!;
    expect(lisbon.cityId).toBe("lisbon");
    expect(kmBetween(lisbon, { lat: 38.72, lng: -9.14 })).toBeLessThan(10);
    expect(kmBetween(PLACES.find((p) => p.name === "Kyoto")!, { lat: 35.01, lng: 135.77 })).toBeLessThan(15);
  });

  it("can be searched by name and by country", () => {
    expect(findPlaces("sevil")[0]?.name).toBe("Seville");
    expect(findCountries("ital")[0]).toMatchObject({ cc: "IT" });
  });
});

describe("trip ideas", () => {
  it("are the same for the same seed and number", () => {
    expect(makeIdea("s1", 7)).toEqual(makeIdea("s1", 7));
    expect(makeIdea("s1", 7)?.key).not.toBe(makeIdea("s2", 7)?.key);
  });

  it("keep coming, never twice the same route", () => {
    const seen = new Set<string>();
    let from = 0;
    for (let page = 0; page < 8; page++) {
      const { ideas, next } = ideasPage("endless", from, 12, {}, seen);
      expect(ideas.length).toBe(12);
      for (const i of ideas) seen.add(i.key);
      from = next;
    }
    expect(seen.size).toBe(96);
  });

  it("make sense: near stops, nights shared out, a name", () => {
    const { ideas } = ideasPage("sense", 0, 60);
    for (const i of ideas) {
      expect(i.title.length).toBeGreaterThan(3);
      expect(i.title).not.toMatch(/\{|undefined/);
      expect(i.nights).toBe(i.stops.reduce((n, s) => n + s.nights, 0));
      for (const s of i.stops) expect(s.nights).toBeGreaterThanOrEqual(1);
      for (let k = 1; k < i.stops.length; k++) expect(kmBetween(i.stops[k - 1].place, i.stops[k].place)).toBeLessThan(1100);
    }
  });

  it("follow the filter", () => {
    const wine = ideasPage("f", 0, 10, { theme: "w", area: "europe" }).ideas;
    expect(wine.length).toBeGreaterThan(5);
    for (const i of wine) {
      expect(i.theme).toBe("w");
      expect(i.stops.every((s) => s.place.area === "europe")).toBe(true);
      expect(i.stops.some((s) => s.place.themes.includes("w"))).toBe(true);
    }
    const pt = ideasPage("f", 0, 8, { cc: "PT", length: "week" }).ideas;
    expect(pt.length).toBeGreaterThan(3);
    for (const i of pt) expect(i.countries).toEqual(["PT"]);
    const weekend = ideasPage("f", 0, 8, { length: "weekend" }).ideas;
    for (const i of weekend) expect(i.stops.length).toBeLessThanOrEqual(2);
    const near = ideasPage("f", 0, 6, { near: { lat: 41.39, lng: 2.17 } }).ideas;
    for (const i of near) expect(Math.min(...i.stops.map((s) => kmBetween(s.place, { lat: 41.39, lng: 2.17 })))).toBeLessThan(700);
  });

  it("run out quietly when the filter is too narrow", () => {
    const { ideas } = ideasPage("narrow", 0, 50, { cc: "MC" });
    expect(ideas.length).toBeLessThan(50);
  });

  it("open again from their address", () => {
    const idea = makeIdea("addr", 3)!;
    const again = ideaFromKey(idea.key)!;
    expect(again.stops.map((s) => [s.place.name, s.nights])).toEqual(idea.stops.map((s) => [s.place.name, s.nights]));
    expect(ideaFromKey("zz.3~q")).toBeNull();
    expect(ideaFromKey("nonsense")).toBeNull();
  });
});

describe("routes in an address", () => {
  it("go to the planner and back", () => {
    const stops = [
      { name: "Lisbon", cc: "PT", lat: 38.7223, lng: -9.1393, nights: 3, cityId: "lisbon" },
      { name: "Sintra, the hills", cc: "PT", lat: 38.8, lng: -9.38, nights: 1 },
    ];
    const back = parseRouteParam(routeParam(stops));
    expect(back).toEqual([
      { name: "Lisbon", countryCode: "PT", lat: 38.722, lng: -9.139, nights: 3, cityId: "lisbon" },
      { name: "Sintra  the hills", countryCode: "PT", lat: 38.8, lng: -9.38, nights: 1, cityId: undefined },
    ]);
    expect(parseRouteParam("x,PT,999,0,2;,,1,1,1;Ok,zz,1,2,abc,<b>")).toEqual([{ name: "Ok", countryCode: undefined, lat: 1, lng: 2, nights: 2, cityId: undefined }]);
    expect(planHref(makeIdea("p", 1)!)).toMatch(/^\/trips\/new\?route=/);
  });

  it("share nights by size", () => {
    expect(shareNights([3, 0, 1], 7).reduce((a, b) => a + b, 0)).toBe(7);
    expect(shareNights([3, 0], 4)[0]).toBeGreaterThan(shareNights([3, 0], 4)[1]);
    expect(shareNights([0, 0, 0], 3)).toEqual([1, 1, 1]);
  });
});
