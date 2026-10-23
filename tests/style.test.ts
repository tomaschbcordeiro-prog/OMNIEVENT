import { describe, it, expect } from "vitest";
import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import { buildStyle, layerVisibility, DEFAULT_LAYERS } from "@/lib/map/style";

describe("map style", () => {
  it("passes MapLibre style validation", () => {
    const errs = validateStyleMin(buildStyle() as never).map((e) => e.message);
    expect(errs).toEqual([]);
  });
  it("satellite and map bases show disjoint base layers", () => {
    const st = buildStyle();
    const sat = layerVisibility(st, "satellite", DEFAULT_LAYERS);
    const map = layerVisibility(st, "map", DEFAULT_LAYERS);
    expect(sat.satellite).toBe(true);
    expect(map.satellite).toBe(false);
    expect(map.water).toBe(true);
    expect(sat.water).toBe(false);
  });
  it("layer toggles hide their groups", () => {
    const vis = layerVisibility(buildStyle(), "satellite", { ...DEFAULT_LAYERS, labels: false, buildings: false });
    expect(vis["label-city"]).toBe(false);
    expect(vis["buildings-3d"]).toBe(false);
    expect(vis["border-country"]).toBe(true);
  });
});
