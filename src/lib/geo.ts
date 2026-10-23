/** Geographic maths shared by server (clustering, radius queries) and client (globe). */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
export const EARTH_RADIUS_KM = 6371;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * D2R;
  const dLng = (bLng - aLng) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * D2R) * Math.cos(bLat * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Lat/lng → Cartesian on a sphere, matching three.js SphereGeometry UV layout
 * (u=0 at -180°, u=0.5 at 0°), so markers line up exactly with the texture.
 */
export function latLngToVec3(lat: number, lng: number, r = 1): [number, number, number] {
  const phi = (lng + 180) * D2R;
  const theta = (90 - lat) * D2R;
  return [-r * Math.cos(phi) * Math.sin(theta), r * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta)];
}

export function vec3ToLatLng(x: number, y: number, z: number): { lat: number; lng: number } {
  const r = Math.sqrt(x * x + y * y + z * z) || 1;
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, y / r))) * R2D;
  let lng = Math.atan2(z, -x) * R2D - 180;
  if (lng < -180) lng += 360;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

/** Approximate sub-solar point for a UTC date (good to ~1°; used for the day/night terminator). */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (date.getTime() - start) / 86400000;
  const g = (2 * Math.PI * (dayOfYear - 1)) / 365.25;
  // Equation of time (minutes) and declination (degrees), NOAA approximation.
  const eot =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    (0.006918 -
      0.399912 * Math.cos(g) +
      0.070257 * Math.sin(g) -
      0.006758 * Math.cos(2 * g) +
      0.000907 * Math.sin(2 * g) -
      0.002697 * Math.cos(3 * g) +
      0.00148 * Math.sin(3 * g)) *
    R2D;
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  let lng = -((minutes + eot) / 4 - 180);
  lng = ((lng + 540) % 360) - 180;
  return { lat: decl, lng };
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

/**
 * Grid clustering in degree cells. Longitude cells widen towards the poles so
 * clusters stay roughly equal-area. `cellDeg = 0` means "group by exact key".
 */
export function gridKey(lat: number, lng: number, cellDeg: number): string {
  if (cellDeg <= 0) return `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const latCell = Math.floor((lat + 90) / cellDeg);
  const lngCellDeg = cellDeg / Math.max(0.25, Math.cos(lat * D2R));
  const lngCell = Math.floor((lng + 180) / lngCellDeg);
  return `${latCell}:${lngCell}`;
}

/** Pick a cluster cell size from camera altitude (globe radii above surface). */
export function cellForAltitude(alt: number): number {
  if (alt > 2.2) return 12;
  if (alt > 1.4) return 7;
  if (alt > 0.8) return 3.5;
  if (alt > 0.4) return 1.2;
  if (alt > 0.18) return 0.25;
  return 0; // venue level
}

/** Visible great-circle radius (km) for a camera at `alt` globe-radii above the surface. */
export function visibleRadiusKm(alt: number): number {
  const d = 1 + alt;
  const horizonAngle = Math.acos(1 / d); // radians from sub-camera point to horizon
  return Math.min(Math.PI / 2, horizonAngle * 1.05) * EARTH_RADIUS_KM;
}

export function bboxContains(
  b: { north: number; south: number; east: number; west: number },
  lat: number,
  lng: number,
): boolean {
  if (lat > b.north || lat < b.south) return false;
  if (b.west <= b.east) return lng >= b.west && lng <= b.east;
  return lng >= b.west || lng <= b.east; // crosses antimeridian
}
