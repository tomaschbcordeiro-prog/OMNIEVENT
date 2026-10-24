import { describe, it, expect } from "vitest";
import { latLngToVec3, vec3ToLatLng, haversineKm, subsolarPoint } from "@/lib/geo";

describe("geo", () => {
  it("round-trips lat/lng ↔ vec3", () => {
    for (const [lat, lng] of [[38.72, -9.14], [-33.87, 151.21], [0, 0], [60, 179.9], [-45, -179.9]]) {
      const [x, y, z] = latLngToVec3(lat, lng);
      const r = vec3ToLatLng(x, y, z);
      expect(r.lat).toBeCloseTo(lat, 6);
      expect(r.lng).toBeCloseTo(lng, 6);
    }
  });
  it("puts 0,0 on +x (texture centre)", () => {
    const [x, y, z] = latLngToVec3(0, 0);
    expect([x, y, z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([1, 0, 0]);
  });
  it("haversine London–Paris ≈ 344 km", () => {
    expect(haversineKm(51.5072, -0.1276, 48.8566, 2.3522)).toBeGreaterThan(335);
    expect(haversineKm(51.5072, -0.1276, 48.8566, 2.3522)).toBeLessThan(350);
  });
  it("subsolar point near equinox noon UTC is close to 0,0", () => {
    const p = subsolarPoint(new Date("2026-03-20T12:00:00Z"));
    expect(Math.abs(p.lat)).toBeLessThan(1.5);
    expect(Math.abs(p.lng)).toBeLessThan(3);
  });
  it("June solstice declination ≈ +23.4", () => {
    expect(subsolarPoint(new Date("2026-06-21T12:00:00Z")).lat).toBeGreaterThan(23);
  });
});

import { nightGeoJSON } from "@/lib/map/night";
describe("day/night bands", () => {
  const inPoly = (lng: number, lat: number, ring: number[][]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const iso of ["2026-03-20T12:00:00Z", "2026-06-21T12:00:00Z", "2026-12-21T00:00:00Z"]) {
    it(`marks the antisolar point as night and the subsolar point as day (${iso.slice(0, 10)})`, () => {
      const night = nightGeoJSON(new Date(iso)).features[0].geometry.coordinates[0];
      const noonLng = iso.endsWith("12:00:00Z") ? 0 : 180;
      const midnightLng = noonLng === 0 ? 179 : 1;
      expect(inPoly(noonLng === 180 ? 179 : 1, 0, night)).toBe(false);
      expect(inPoly(midnightLng, 0, night)).toBe(true);
    });
  }
  it("puts the winter pole in night and the summer pole in day in June", () => {
    const night = nightGeoJSON(new Date("2026-06-21T12:00:00Z")).features[0].geometry.coordinates[0];
    expect(inPoly(10, -85, night)).toBe(true);
    expect(inPoly(10, 85, night)).toBe(false);
  });
});

import { geodesicCircle, sliderToKm, kmToSlider } from "@/lib/map/circle";
describe("geodesic radius circle", () => {
  it("every vertex is exactly the radius away, at any latitude", () => {
    for (const [lat, lng, km] of [[38.72, -9.14, 10], [64.1, -21.9, 250], [-33.9, 151.2, 500], [0, 179.9, 100]]) {
      for (const [lo, la] of geodesicCircle(lat, lng, km, 32)) expect(haversineKm(lat, lng, la, lo)).toBeCloseTo(km, 3);
    }
  });
  it("stays continuous across the antimeridian", () => {
    const pts = geodesicCircle(-17.8, 179.5, 300, 64);
    for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i][0] - pts[i - 1][0])).toBeLessThan(10);
  });
  it("slider maps round-trip within rounding", () => {
    for (const km of [1, 5, 10, 25, 100, 500]) expect(Math.abs(sliderToKm(kmToSlider(km)) - km) / km).toBeLessThan(0.05);
  });
});
