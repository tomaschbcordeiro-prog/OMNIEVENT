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
