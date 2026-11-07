import "server-only";
import { cookies, headers } from "next/headers";
import { cityStats } from "./store";
import { CITIES, getDestination } from "./destinations";
import { haversineKm } from "./geo";
import { HERE_COOKIE, NOWHERE, parseHereCookie, type Here, type HereCity } from "./here-shared";

/** A city needs this many upcoming events to open the site on it. */
const MIN_EVENTS = 15;
/** And to be this close to the visitor. */
const MAX_KM = 80;

function toHereCity(id: string, n: number): HereCity | null {
  const d = getDestination(id);
  if (!d || d.kind !== "city") return null;
  return { id: d.id, name: d.name, country: d.country ?? "", lat: d.lat, lng: d.lng, tz: d.timeZone ?? "UTC", n };
}

/**
 * The city with events nearest to a point, within reach. A much busier city a little further
 * away wins over a quiet one next door (Lisbon over a suburb).
 */
export function nearestCity(lat: number, lng: number, maxKm = MAX_KM): HereCity | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const stats = cityStats();
  let best: { id: string; n: number; score: number } | undefined;
  for (const c of CITIES) {
    const n = stats[c.id]?.total ?? 0;
    if (n < MIN_EVENTS) continue;
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d > maxKm) continue;
    const score = d - 12 * Math.log10(n);
    if (!best || score < best.score) best = { id: c.id, n, score };
  }
  return best ? toHereCity(best.id, best.n) : null;
}

/** A city by id, with its event count (null when there is no such city). */
export function hereCityById(id: string): HereCity | null {
  return toHereCity(id, cityStats()[id]?.total ?? 0);
}

/** Where the visitor's connection is, by the hosting network's city-level lookup. */
export async function ipPoint(): Promise<{ lat: number; lng: number } | null> {
  const h = await headers();
  const lat = Number(h.get("x-vercel-ip-latitude"));
  const lng = Number(h.get("x-vercel-ip-longitude"));
  if (!h.get("x-vercel-ip-latitude") || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * Where this visitor is, for the site to open on: their choice (or device location) from the
 * cookie, else the city nearest their connection, else nowhere in particular. Call after the
 * event data is loaded (ensureFresh), so cities have their counts.
 */
export async function getHere(): Promise<Here> {
  const saved = parseHereCookie((await cookies()).get(HERE_COOKIE)?.value);
  if (saved === "any") return { city: null, source: "any" };
  if (saved) {
    const city = hereCityById(saved.id);
    if (city) return { city, source: saved.source };
  }
  const p = await ipPoint();
  const city = p ? nearestCity(p.lat, p.lng) : null;
  return city ? { city, source: "ip" } : NOWHERE;
}
