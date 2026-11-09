import { shadowRings } from "./daylight";

/**
 * Day/night shading as GeoJSON polygons, so it renders correctly in both the globe and Web
 * Mercator projections. Four nested bands (sun below 0°, −6°, −12° and −18°) give a soft,
 * physically placed twilight instead of a hard edge; drawn one over another, the night deepens
 * towards the side facing away from the sun. The geometry (and its tests) is in daylight.ts.
 */
export function nightGeoJSON(date = new Date()): GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, { altitude: number }> {
  return {
    type: "FeatureCollection",
    features: [0, -6, -12, -18].map((altitude) => ({ type: "Feature", properties: { altitude }, geometry: { type: "MultiPolygon", coordinates: shadowRings(date, altitude).map((r) => [r]) } })),
  };
}
