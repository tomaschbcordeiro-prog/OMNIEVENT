/**
 * Day and night on Earth at a given moment: where the sun is overhead, and the parts of the
 * planet where it is below the horizon (night), with the twilight bands in between.
 * Accurate to about a degree, which is plenty for a picture of the planet.
 */

const RAD = Math.PI / 180;

/** The point on Earth where the sun is straight overhead. */
export function subsolarPoint(date: Date): { lat: number; lng: number } {
  // Days since J2000.0 (12:00 UTC, 1 January 2000).
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  // The sun's mean longitude and anomaly, then its ecliptic longitude (degrees).
  const L = (280.46 + 0.9856474 * d) % 360;
  const g = ((357.528 + 0.9856003 * d) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const epsilon = (23.439 - 0.0000004 * d) * RAD;
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  // Greenwich mean sidereal time (degrees): the sun is overhead where it equals its right ascension.
  const gmst = (280.46061837 + 360.98564736629 * d) % 360;
  let lng = ra / RAD - gmst;
  lng = ((((lng + 180) % 360) + 360) % 360) - 180;
  return { lat: dec / RAD, lng };
}

/** How high the sun is (degrees above the horizon) at a place and moment. */
export function sunAltitude(lat: number, lng: number, date: Date): number {
  const s = subsolarPoint(date);
  const cos = Math.sin(lat * RAD) * Math.sin(s.lat * RAD) + Math.cos(lat * RAD) * Math.cos(s.lat * RAD) * Math.cos((lng - s.lng) * RAD);
  return 90 - Math.acos(Math.max(-1, Math.min(1, cos))) / RAD;
}

type Ring = [number, number][];

/**
 * The area where the sun is lower than `below` degrees (0 = the night side; -6, -12 and -18
 * the ends of civil, nautical and astronomical twilight): the circle around the point opposite
 * the sun. Drawn meridian by meridian: on each, the part inside the circle is one stretch of
 * latitude (reaching a pole when the circle takes one in); neighbouring meridians with a
 * stretch make one polygon. A circle across the date line comes out as two polygons.
 */
export function shadowRings(date: Date, below = 0, step = 2): Ring[] {
  const s = subsolarPoint(date);
  const cLat = -s.lat * RAD;
  const cLng = s.lng + 180;
  const C = Math.cos((90 + below) * RAD);
  const A = Math.sin(cLat);
  const runs: { lng: number; lo: number; hi: number }[][] = [];
  let run: { lng: number; lo: number; hi: number }[] | null = null;
  for (let lng = -180; lng <= 180 + 1e-9; lng += step) {
    const B = Math.cos(cLat) * Math.cos((lng - cLng) * RAD);
    const R = Math.hypot(A, B);
    let span: { lo: number; hi: number } | null = null;
    if (R > 1e-12 && C / R <= 1) {
      const half = Math.acos(Math.max(-1, C / R)) / RAD;
      const phi0 = Math.atan2(A, B) / RAD;
      // The stretch around phi0 (or its copy a turn away) that falls within -90..90.
      for (const p of [phi0, phi0 - 360, phi0 + 360]) {
        const lo = Math.max(-90, p - half);
        const hi = Math.min(90, p + half);
        if (lo <= hi) span = { lo, hi };
      }
    }
    if (span) (run ??= []).push({ lng, ...span });
    else if (run) {
      runs.push(run);
      run = null;
    }
  }
  if (run) runs.push(run);
  return runs
    .filter((r) => r.length > 1)
    .map((r) => {
      const ring: Ring = [...r.map((p): [number, number] => [p.lng, p.hi]), ...r.reverse().map((p): [number, number] => [p.lng, p.lo])];
      ring.push(ring[0]);
      return ring;
    });
}
