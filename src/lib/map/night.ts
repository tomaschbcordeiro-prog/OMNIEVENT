import { subsolarPoint } from "../geo";

/**
 * Day/night shading as GeoJSON polygons, so it renders correctly in both the globe
 * and Web Mercator projections. Three nested bands (sun below 0°, −6°, −12°) give a
 * soft, physically placed twilight instead of a hard edge.
 */
const D2R = Math.PI / 180;

function band(sunLat: number, sunLng: number, altitudeDeg: number): GeoJSON.Feature<GeoJSON.Polygon> {
  // A point is in this band when the sun is below `altitudeDeg` there, i.e. its angular
  // distance from the subsolar point exceeds 90° − altitude.
  const cosR = Math.cos((90 - altitudeDeg) * D2R);
  const sinS = Math.sin(sunLat * D2R);
  const cosS = Math.cos(sunLat * D2R);
  const isNight = (lat: number, lng: number) =>
    Math.sin(lat * D2R) * sinS + Math.cos(lat * D2R) * cosS * Math.cos((lng - sunLng) * D2R) < cosR;
  // Along any meridian the night side is one contiguous latitude interval [lo, hi]
  // (it may or may not reach a pole). The polygon follows `hi` west→east, then `lo` back.
  const fallback = sunLat >= 0 ? -89.9 : 89.9;
  const hi: [number, number][] = [];
  const lo: [number, number][] = [];
  for (let lng = -180; lng <= 180; lng += 2) {
    let a = Infinity, b = -Infinity;
    for (let lat = -89.9; lat <= 89.9; lat += 0.5) {
      if (isNight(lat, lng)) {
        if (lat < a) a = lat;
        b = lat;
      }
    }
    if (a === Infinity) a = b = fallback;
    hi.push([lng, b]);
    lo.push([lng, a]);
  }
  const coords: [number, number][] = [...hi, ...lo.reverse(), hi[0]];
  return { type: "Feature", properties: { altitude: altitudeDeg }, geometry: { type: "Polygon", coordinates: [coords] } };
}

export function nightGeoJSON(date = new Date()): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const s = subsolarPoint(date);
  return { type: "FeatureCollection", features: [band(s.lat, s.lng, 0), band(s.lat, s.lng, -6), band(s.lat, s.lng, -12)] };
}
