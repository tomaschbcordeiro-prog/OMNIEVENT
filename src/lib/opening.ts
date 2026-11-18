import { LAND_BITS, LAND_H, LAND_W } from "./intro-land";

/*
 * The opening scene's planet, as numbers: where the land dots and the city lights are, how a
 * point on Earth lands on the screen for a given view, and where the visitor probably is (from
 * their clock), so the lights come on from their side of the world first.
 */

const RAD = Math.PI / 180;

/** A point on the sphere, ready to turn: its latitude's sine and cosine, its longitude's. */
export interface SpherePoint {
  sinLat: number;
  cosLat: number;
  sinLng: number;
  cosLng: number;
}

export function spherePoint(lat: number, lng: number): SpherePoint {
  return { sinLat: Math.sin(lat * RAD), cosLat: Math.cos(lat * RAD), sinLng: Math.sin(lng * RAD), cosLng: Math.cos(lng * RAD) };
}

/** The view: the latitude and longitude at the middle of the disc, in degrees. */
export interface View {
  lat: number;
  lng: number;
}

/** Turns a view into the four numbers every point needs (no trigonometry per point per frame). */
export function viewTrig(v: View) {
  return { sinL: Math.sin(v.lng * RAD), cosL: Math.cos(v.lng * RAD), sinC: Math.sin(v.lat * RAD), cosC: Math.cos(v.lat * RAD) };
}

/**
 * Where a point is on the unit disc for a view (orthographic): x to the right, y up, z towards
 * the viewer (z > 0 is the visible half).
 */
export function project(p: SpherePoint, t: ReturnType<typeof viewTrig>): { x: number; y: number; z: number } {
  // Longitude relative to the middle of the view.
  const sinD = p.sinLng * t.cosL - p.cosLng * t.sinL;
  const cosD = p.cosLng * t.cosL + p.sinLng * t.sinL;
  const x = p.cosLat * sinD;
  const y0 = p.sinLat;
  const z0 = p.cosLat * cosD;
  // Then tilted so the middle latitude faces the viewer.
  return { x, y: y0 * t.cosC - z0 * t.sinC, z: y0 * t.sinC + z0 * t.cosC };
}

/** The angle between two points on the sphere, in radians. */
export function angleBetween(a: SpherePoint, b: SpherePoint): number {
  const dot = a.sinLat * b.sinLat + a.cosLat * b.cosLat * (a.cosLng * b.cosLng + a.sinLng * b.sinLng);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}

/** Every land cell's middle, as points (Antarctica left out: it would be a white band at the bottom). */
export function landPoints(): (SpherePoint & { lat: number; lng: number })[] {
  const bin = typeof atob === "function" ? atob(LAND_BITS) : Buffer.from(LAND_BITS, "base64").toString("binary");
  const out: (SpherePoint & { lat: number; lng: number })[] = [];
  const cell = 360 / LAND_W;
  for (let y = 0; y < LAND_H; y++) {
    const lat = 90 - (y + 0.5) * cell;
    if (lat < -58) continue;
    for (let x = 0; x < LAND_W; x++) {
      const i = y * LAND_W + x;
      if (!(bin.charCodeAt(i >> 3) & (1 << (i & 7)))) continue;
      const lng = -180 + (x + 0.5) * cell;
      out.push({ lat, lng, ...spherePoint(lat, lng) });
    }
  }
  return out;
}

/**
 * Where the visitor probably is, from the clock alone (nothing is asked or sent): a city in
 * their time zone when the site knows one, else the longitude their UTC offset points to.
 */
export function guessHome(cities: { lat: number; lng: number; timeZone?: string; name: string }[], timeZone: string | undefined, offsetMinutes: number): { lat: number; lng: number; name?: string } {
  const same = timeZone ? cities.find((c) => c.timeZone === timeZone) : undefined;
  if (same) return { lat: same.lat, lng: same.lng, name: same.name };
  // getTimezoneOffset() is minutes behind UTC: -60 in Paris in winter, 300 in New York.
  const lng = Math.max(-170, Math.min(170, (-offsetMinutes / 60) * 15));
  return { lat: 30, lng };
}

/**
 * Points along the great circle from a to b, lifted off the surface in the middle (an arc a
 * plane would fly), as unit-sphere coordinates times their height.
 */
export function arcPoints(a: { lat: number; lng: number }, b: { lat: number; lng: number }, steps = 40, lift = 0.18): { p: SpherePoint; h: number }[] {
  const toV = (lat: number, lng: number) => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
  const va = toV(a.lat, a.lng);
  const vb = toV(b.lat, b.lng);
  const omega = Math.acos(Math.max(-1, Math.min(1, va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2])));
  const out: { p: SpherePoint; h: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = Math.sin(omega) || 1;
    const ka = omega ? Math.sin((1 - t) * omega) / s : 1 - t;
    const kb = omega ? Math.sin(t * omega) / s : t;
    const v = [va[0] * ka + vb[0] * kb, va[1] * ka + vb[1] * kb, va[2] * ka + vb[2] * kb];
    const len = Math.hypot(v[0], v[1], v[2]) || 1;
    const lat = Math.asin(v[2] / len) / RAD;
    const lng = Math.atan2(v[1], v[0]) / RAD;
    out.push({ p: spherePoint(lat, lng), h: 1 + lift * Math.sin(Math.PI * t) * Math.min(1, omega / 0.8) });
  }
  return out;
}

/** Ease out with a little overshoot: the planet pops into place. */
export const easeOutBack = (t: number) => {
  const c = 1.4;
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** The shortest way round from one longitude to another, in degrees (-180 to 180). */
export function lngDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/**
 * Where the planet sits and how big it is. Side by side on a wide screen (the words on the left,
 * the planet on the right, as on a computer or a phone turned sideways); otherwise the planet
 * above and the words below, leaving room for the bar at the top.
 */
export function sceneLayout(W: number, H: number, splash = false, wordsHeight?: number): { cx: number; cy: number; R: number; side: boolean } {
  const side = !splash && W > H && (W >= 1000 || H < 520);
  if (side) {
    const short = H < 520;
    const R = Math.max(70, Math.min(H * (short ? 0.34 : 0.36), W * 0.24, 400));
    return { cx: W * (short ? 0.73 : 0.66), cy: short ? H / 2 - 6 : H / 2 + 12, R, side };
  }
  const top = 64;
  // The words' own height when it's known (measured on the page), else about what they take.
  const words = splash ? 90 : Math.max(wordsHeight ?? 0, W < 720 ? 268 : 290);
  const hint = splash ? 0 : 34;
  const room = Math.max(160, H - top - words - hint);
  const R = Math.max(80, Math.min(W < 720 ? W * 0.43 : W * 0.3, room / 2, 360));
  return { cx: W / 2, cy: top + room / 2, R, side };
}

/** "Good morning" to "Good night", by the visitor's own clock. */
export function greeting(hour: number): string {
  return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : hour < 22 ? "Good evening" : "Good night";
}

/** The point on the sphere under a spot on the disc (-1..1, y up), for a view; null off the planet. */
export function unproject(x: number, y: number, v: View): { lat: number; lng: number } | null {
  const r2 = x * x + y * y;
  if (r2 > 1) return null;
  const z = Math.sqrt(1 - r2);
  const c = v.lat * RAD;
  const y0 = y * Math.cos(c) + z * Math.sin(c);
  const z0 = -y * Math.sin(c) + z * Math.cos(c);
  const lat = Math.asin(Math.max(-1, Math.min(1, y0))) / RAD;
  const lng = v.lng + Math.atan2(x, z0) / RAD;
  return { lat, lng: ((((lng + 180) % 360) + 360) % 360) - 180 };
}
