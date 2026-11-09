import { describe, expect, it } from "vitest";
import { shadowRings, subsolarPoint, sunAltitude } from "@/lib/map/daylight";
import { nightGeoJSON } from "@/lib/map/night";

/** Whether a point is inside a ring drawn on the plain longitude/latitude plane. */
function inside(ring: [number, number][], lng: number, lat: number): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

describe("day and night", () => {
  it("puts the sun over the equator at the equinox and over the tropic at the solstice", () => {
    const equinox = subsolarPoint(new Date(Date.UTC(2026, 2, 20, 12)));
    expect(Math.abs(equinox.lat)).toBeLessThan(0.6);
    // Overhead near Greenwich at noon UTC (within the equation of time, a few degrees).
    expect(Math.abs(equinox.lng)).toBeLessThan(3);
    const solstice = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12)));
    expect(solstice.lat).toBeGreaterThan(23.2);
    expect(solstice.lat).toBeLessThan(23.5);
    const december = subsolarPoint(new Date(Date.UTC(2026, 11, 21, 12)));
    expect(december.lat).toBeLessThan(-23.2);
  });

  it("has the sun straight overhead at the subsolar point", () => {
    const d = new Date(Date.UTC(2026, 10, 9, 18, 30));
    const s = subsolarPoint(d);
    expect(sunAltitude(s.lat, s.lng, d)).toBeGreaterThan(89.9);
    expect(sunAltitude(-s.lat, s.lng + 180, d)).toBeLessThan(-89.9);
  });

  it("draws the night where the sun is below the horizon, and the twilight bands inside it", () => {
    let seed = 11;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (const d of [new Date(Date.UTC(2026, 2, 20, 6)), new Date(Date.UTC(2026, 5, 21, 0)), new Date(Date.UTC(2026, 10, 9, 18, 30)), new Date(Date.UTC(2026, 11, 21, 15))]) {
      for (const below of [0, -6, -12, -18]) {
        const rings = shadowRings(d, below, 1);
        let checked = 0;
        for (let i = 0; i < 600; i++) {
          const lat = -85 + rnd() * 170;
          const lng = -179 + rnd() * 358;
          const alt = sunAltitude(lat, lng, d);
          // Points right at the edge depend on the drawing's resolution.
          if (Math.abs(alt - below) < 1.5) continue;
          checked++;
          expect(rings.some((ring) => inside(ring, lng, lat)), `${d.toISOString()} below ${below} at ${lat.toFixed(1)},${lng.toFixed(1)} (sun ${alt.toFixed(1)}°)`).toBe(alt < below);
        }
        expect(checked).toBeGreaterThan(500);
      }
    }
  });

  it("gives four bands as GeoJSON", () => {
    const g = nightGeoJSON(new Date(Date.UTC(2026, 10, 9, 12)));
    expect(g.features.map((f) => f.properties.altitude)).toEqual([0, -6, -12, -18]);
    for (const f of g.features) {
      expect(f.geometry.coordinates.length).toBeGreaterThan(0);
      for (const [ring] of f.geometry.coordinates) {
        expect(ring[0]).toEqual(ring[ring.length - 1]);
        expect(ring.every(([x, y]) => x >= -180 && x <= 180 && y >= -90 && y <= 90)).toBe(true);
      }
    }
  });
});
