import { describe, it, expect } from "vitest";
import { greatCircle, along, arcAngle, sphereCentre } from "@/lib/map/arc";
import { haversineKm } from "@/lib/geo";

describe("great-circle arcs", () => {
  it("starts and ends at the two places, and every point lies on the shortest route", () => {
    const lis: [number, number] = [-9.14, 38.72];
    const nyc: [number, number] = [-74.0, 40.71];
    const line = greatCircle(lis, nyc, 32);
    expect(line).toHaveLength(33);
    expect(line[0][0]).toBeCloseTo(lis[0], 6);
    expect(line[32][1]).toBeCloseTo(nyc[1], 6);
    const total = haversineKm(lis[1], lis[0], nyc[1], nyc[0]);
    let sum = 0;
    for (let i = 1; i < line.length; i++) sum += haversineKm(line[i - 1][1], line[i - 1][0], line[i][1], line[i][0]);
    expect(sum).toBeCloseTo(total, 0);
    // The route bends north of both cities, as a real transatlantic flight does.
    expect(Math.max(...line.map((p) => p[1]))).toBeGreaterThan(41);
  });
  it("crosses the Pacific in one continuous stroke", () => {
    const line = greatCircle([139.69, 35.68], [-122.42, 37.77], 48);
    for (let i = 1; i < line.length; i++) expect(Math.abs(line[i][0] - line[i - 1][0])).toBeLessThan(20);
    expect(line.at(-1)![0]).toBeCloseTo(-122.42 + 360, 4);
  });
  it("finds points along a line and the centre of a route", () => {
    expect(along([[0, 0], [10, 0]], 0.25)).toEqual([2.5, 0]);
    expect(arcAngle([0, 0], [90, 0])).toBeCloseTo(Math.PI / 2, 9);
    const c = sphereCentre([[-10, 0], [10, 0]]);
    expect(c[0]).toBeCloseTo(0, 9);
    expect(c[1]).toBeCloseTo(0, 9);
  });
});
