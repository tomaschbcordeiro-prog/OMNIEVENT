/**
 * Great-circle arcs for Night Flight: the shortest route over the planet between two places,
 * as a line with longitudes kept continuous across the antimeridian (170° → 190°, not → -170°),
 * so a flight over the Pacific draws as one stroke.
 */

type LngLat = [number, number];
const RAD = Math.PI / 180;

const toVec = ([lng, lat]: LngLat): [number, number, number] => [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];

/** Angular distance between two places, in radians. */
export function arcAngle(a: LngLat, b: LngLat): number {
  const [x1, y1, z1] = toVec(a);
  const [x2, y2, z2] = toVec(b);
  return Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2)));
}

/** `n + 1` points along the great circle from a to b (both included). */
export function greatCircle(a: LngLat, b: LngLat, n = 64): LngLat[] {
  const va = toVec(a);
  const vb = toVec(b);
  const w = arcAngle(a, b);
  const out: LngLat[] = [];
  if (w < 1e-9) return [a, b];
  const s = Math.sin(w);
  let prev = a[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Spherical linear interpolation; antipodal points (s ≈ 0) fall back to the straight blend.
    const ka = s > 1e-6 ? Math.sin((1 - t) * w) / s : 1 - t;
    const kb = s > 1e-6 ? Math.sin(t * w) / s : t;
    const x = ka * va[0] + kb * vb[0];
    const y = ka * va[1] + kb * vb[1];
    const z = ka * va[2] + kb * vb[2];
    const lat = Math.atan2(z, Math.hypot(x, y)) / RAD;
    let lng = Math.atan2(y, x) / RAD;
    // Keep each step within half a turn of the last one.
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    prev = lng;
    out.push([lng, lat]);
  }
  return out;
}

/** The point a fraction `t` (0–1) of the way along a line of evenly spaced points. */
export function along(line: LngLat[], t: number): LngLat {
  if (line.length < 2) return line[0];
  const f = Math.max(0, Math.min(1, t)) * (line.length - 1);
  const i = Math.min(line.length - 2, Math.floor(f));
  const k = f - i;
  return [line[i][0] + (line[i + 1][0] - line[i][0]) * k, line[i][1] + (line[i + 1][1] - line[i][1]) * k];
}

/** The centre of a set of places on the sphere (for framing a whole route). */
export function sphereCentre(points: LngLat[]): LngLat {
  let x = 0, y = 0, z = 0;
  for (const p of points) {
    const v = toVec(p);
    x += v[0];
    y += v[1];
    z += v[2];
  }
  if (Math.hypot(x, y, z) < 1e-9) return points[0] ?? [0, 0];
  return [Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD];
}
