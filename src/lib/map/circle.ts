/**
 * Geodesic circle: points at exactly `km` great-circle distance from the centre.
 * Longitudes are unwrapped around the centre so circles crossing ±180° stay continuous.
 */
const R = 6371;
const D2R = Math.PI / 180;

export function geodesicCircle(lat: number, lng: number, km: number, steps = 128): [number, number][] {
  const d = km / R;
  const φ1 = lat * D2R;
  const λ1 = lng * D2R;
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    let lon = λ2 / D2R;
    while (lon - lng > 180) lon -= 360;
    while (lon - lng < -180) lon += 360;
    pts.push([lon, Math.max(-85, Math.min(85, φ2 / D2R))]);
  }
  return pts;
}

/** [west, south, east, north]; west/east may exceed ±180 for circles crossing the antimeridian. */
export function circleBounds(lat: number, lng: number, km: number): [number, number, number, number] {
  const pts = geodesicCircle(lat, lng, km, 64);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

export const RADIUS_PRESETS = [1, 5, 10, 25, 50, 100, 250, 500];
export const RADIUS_MIN = 0.5;
export const RADIUS_MAX = 2000;

/** Slider position (0–1000) ↔ km on a log scale, so small radii stay precise. */
export const sliderToKm = (v: number) => {
  const km = RADIUS_MIN * Math.pow(RADIUS_MAX / RADIUS_MIN, v / 1000);
  return km < 10 ? Math.round(km * 2) / 2 : km < 100 ? Math.round(km) : Math.round(km / 5) * 5;
};
export const kmToSlider = (km: number) => Math.round((1000 * Math.log(km / RADIUS_MIN)) / Math.log(RADIUS_MAX / RADIUS_MIN));
export const formatKm = (km: number) => (km < 10 && km % 1 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString("en")} km`);
