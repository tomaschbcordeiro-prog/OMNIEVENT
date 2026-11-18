import { describe, expect, it } from "vitest";
import { angleBetween, arcPoints, greeting, guessHome, landPoints, lngDelta, project, sceneLayout, spherePoint, unproject, viewTrig } from "@/lib/opening";

describe("the opening scene's planet", () => {
  it("has land where land is (Lisbon, Nairobi, Denver) and not in the oceans", () => {
    const land = landPoints();
    expect(land.length).toBeGreaterThan(2000);
    const near = (lat: number, lng: number) => land.some((p) => Math.abs(p.lat - lat) < 2 && Math.abs(p.lng - lng) < 2);
    expect(near(39.5, -8)).toBe(true); // Portugal
    expect(near(-1.3, 36.8)).toBe(true); // Kenya
    expect(near(39.7, -104.9)).toBe(true); // Colorado
    expect(near(30, -40)).toBe(false); // mid-Atlantic
    expect(near(-20, -120)).toBe(false); // south Pacific
  });

  it("puts the middle of the view in the middle of the disc, facing us", () => {
    const q = project(spherePoint(38.7, -9.1), viewTrig({ lat: 38.7, lng: -9.1 }));
    expect(q.x).toBeCloseTo(0, 6);
    expect(q.y).toBeCloseTo(0, 6);
    expect(q.z).toBeCloseTo(1, 6);
    // The other side of the planet is hidden.
    expect(project(spherePoint(-38.7, 170.9), viewTrig({ lat: 38.7, lng: -9.1 })).z).toBeLessThan(0);
  });

  it("finds the point under a tap (the inverse of drawing it)", () => {
    const v = { lat: 25, lng: 40 };
    for (const [lat, lng] of [[48.85, 2.35], [35.68, 139.69], [-1.29, 36.82], [40.71, -74.0]]) {
      const q = project(spherePoint(lat, lng), viewTrig(v));
      if (q.z <= 0) continue;
      const back = unproject(q.x, q.y, v)!;
      expect(back.lat).toBeCloseTo(lat, 4);
      expect(back.lng).toBeCloseTo(lng, 4);
    }
    expect(unproject(0.9, 0.9, v)).toBeNull();
  });

  it("guesses the visitor's side of the world from their clock only", () => {
    const cities = [{ name: "Lisbon", lat: 38.7, lng: -9.1, timeZone: "Europe/Lisbon" }];
    expect(guessHome(cities, "Europe/Lisbon", 0)).toMatchObject({ name: "Lisbon" });
    expect(guessHome(cities, "America/New_York", 300).lng).toBeCloseTo(-75, 0);
    expect(guessHome(cities, undefined, -540).lng).toBeCloseTo(135, 0);
  });

  it("flies arcs along the great circle, lifted in the middle", () => {
    const pts = arcPoints({ lat: 38.7, lng: -9.1 }, { lat: 40.7, lng: -74 });
    expect(angleBetween(pts[0].p, spherePoint(38.7, -9.1))).toBeLessThan(1e-6);
    expect(angleBetween(pts[pts.length - 1].p, spherePoint(40.7, -74))).toBeLessThan(1e-6);
    expect(pts[20].h).toBeGreaterThan(pts[0].h);
  });

  it("turns the short way round, and leaves room for the words", () => {
    expect(lngDelta(170, -170)).toBe(20);
    expect(lngDelta(-170, 170)).toBe(-20);
    const phone = sceneLayout(390, 664);
    expect(phone.side).toBe(false);
    expect(phone.cy + phone.R).toBeLessThan(664 - 268);
    expect(phone.cy - phone.R).toBeGreaterThan(40);
    // Side by side on a phone turned sideways and on a computer: the planet on the right.
    expect(sceneLayout(844, 390).side).toBe(true);
    const pc = sceneLayout(1440, 900);
    expect(pc.side).toBe(true);
    expect(pc.cx - pc.R).toBeGreaterThan(1440 * 0.42);
    expect(pc.R).toBeLessThanOrEqual(400);
    expect(sceneLayout(768, 1024).side).toBe(false);
    // Taller words (measured): a smaller planet, still clear of them.
    const tall = sceneLayout(390, 664, false, 330);
    expect(tall.cy + tall.R).toBeLessThanOrEqual(664 - 330 - 34 + 1);
    // A phone on its side: the planet and the line under it fit in the height.
    const side = sceneLayout(844, 390);
    expect(side.cy + side.R + 30).toBeLessThan(390);
  });

  it("says hello by the visitor's own clock", () => {
    expect(greeting(8)).toBe("Good morning");
    expect(greeting(14)).toBe("Good afternoon");
    expect(greeting(20)).toBe("Good evening");
    expect(greeting(23)).toBe("Good night");
  });
});
