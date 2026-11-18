import { shadowRings } from "./daylight";

/** The sun's heights (degrees below the horizon) where a band of shade begins: every 2° down to
 * astronomical night, so the twilight darkens smoothly instead of in a few visible steps. */
export const NIGHT_BANDS = [0, -2, -4, -6, -8, -10, -12, -14, -16, -18];

/**
 * Day/night shading as GeoJSON polygons, so it renders correctly in both the globe and Web
 * Mercator projections. Ten nested bands (the sun 0° to 18° below the horizon) give a soft,
 * physically placed twilight; drawn one over another, the night deepens towards the side facing
 * away from the sun. The geometry (and its tests) is in daylight.ts.
 */
export function nightGeoJSON(date = new Date()): GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, { altitude: number }> {
  return {
    type: "FeatureCollection",
    features: NIGHT_BANDS.map((altitude) => ({ type: "Feature", properties: { altitude }, geometry: { type: "MultiPolygon", coordinates: shadowRings(date, altitude).map((r) => [r]) } })),
  };
}
