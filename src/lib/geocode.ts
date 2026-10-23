import "server-only";
import { log } from "./log";

/**
 * Geocoding (place search) and reverse geocoding, server-side only.
 * Provider: MapTiler Geocoding when MAPTILER_KEY is set, otherwise Photon by Komoot
 * (OpenStreetMap data, fair-use public API; heavy production use should self-host or use a key).
 * Results are cached in memory and the API routes are rate limited.
 */

export interface Place {
  id: string;
  name: string;
  /** Human context, e.g. "Baixa, Lisboa, Portugal". */
  context: string;
  kind: string;
  lat: number;
  lng: number;
  /** [west, south, east, north] */
  bbox?: [number, number, number, number];
  countryCode?: string;
}

export interface ReversePlace {
  lat: number;
  lng: number;
  /** Most specific first: address/street → neighbourhood → city → region → country. */
  hierarchy: { kind: string; name: string }[];
  label: string;
}

const KEY = process.env.MAPTILER_KEY || process.env.NEXT_PUBLIC_MAPTILER_KEY || "";
export const GEOCODER = KEY ? "MapTiler Geocoding" : "Photon (OpenStreetMap)";
const UA = "OMNIEVENT/1.0 (event discovery; https://omnievent.vercel.app)";

const cache = new Map<string, { at: number; value: unknown }>();
const TTL = 24 * 3600 * 1000;
function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  return undefined;
}
function store(key: string, value: unknown) {
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value!);
}

/** "38.71, -9.14" or "38.71 -9.14" → coordinates (lat, lng order, as people type them). */
export function parseCoordinates(q: string): { lat: number; lng: number } | null {
  const m = q.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = +m[1], lng = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  return res.json();
}

const PHOTON_KIND: Record<string, string> = { house: "address", street: "street", locality: "locality", district: "district", city: "city", county: "county", state: "state", country: "country", other: "poi" };

type PhotonFeature = { geometry: { coordinates: [number, number] }; properties: Record<string, string | number | number[] | undefined> };

function photonPlace(f: PhotonFeature): Place {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const type = String(p.type ?? "other");
  const kind = p.osm_key === "place" && typeof p.osm_value === "string" && ["city", "town", "village", "suburb", "neighbourhood", "quarter", "hamlet"].includes(p.osm_value) ? p.osm_value : PHOTON_KIND[type] ?? "poi";
  const name = String(p.name ?? (p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : p.city ?? p.country ?? "Unnamed place"));
  const ctx = [p.street && p.name !== p.street ? `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}` : null, p.district, p.city !== p.name ? p.city : null, p.state !== p.name ? p.state : null, p.country !== p.name ? p.country : null]
    .filter((x) => typeof x === "string" && x)
    .join(", ");
  const ext = Array.isArray(p.extent) && p.extent.length === 4 ? (p.extent as number[]) : undefined;
  return {
    id: `osm-${p.osm_type}${p.osm_id}`,
    name,
    context: ctx,
    kind,
    lat,
    lng,
    // Photon extent is [minLon, maxLat, maxLon, minLat]
    bbox: ext ? [ext[0], ext[3], ext[2], ext[1]] : undefined,
    countryCode: typeof p.countrycode === "string" ? p.countrycode : undefined,
  };
}

type MtFeature = { id: string; text: string; place_name: string; place_type: string[]; center: [number, number]; bbox?: [number, number, number, number]; properties?: { country_code?: string } };

function mtPlace(f: MtFeature): Place {
  const kind = f.place_type?.[0] ?? "poi";
  return {
    id: `mt-${f.id}`,
    name: f.text,
    context: f.place_name.replace(new RegExp(`^${f.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")},?\\s*`), ""),
    kind: kind === "municipality" ? "city" : kind === "neighbourhood" ? "neighbourhood" : kind,
    lat: f.center[1],
    lng: f.center[0],
    bbox: f.bbox,
    countryCode: f.properties?.country_code?.toUpperCase(),
  };
}

export async function geocode(q: string, opts: { lat?: number; lng?: number; limit?: number; lang?: string } = {}): Promise<Place[]> {
  const limit = Math.min(10, opts.limit ?? 6);
  const coords = parseCoordinates(q);
  if (coords) return [{ id: `coord-${coords.lat},${coords.lng}`, name: `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`, context: "Coordinates", kind: "coordinates", ...coords }];
  const bias = opts.lat != null && opts.lng != null ? `${opts.lat.toFixed(2)},${opts.lng.toFixed(2)}` : "";
  const key = `f|${q.toLowerCase()}|${bias}|${limit}|${opts.lang ?? ""}`;
  const hit = cached<Place[]>(key);
  if (hit) return hit;
  let places: Place[];
  if (KEY) {
    const u = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`);
    u.searchParams.set("key", KEY);
    u.searchParams.set("limit", String(limit));
    u.searchParams.set("autocomplete", "true");
    if (opts.lang) u.searchParams.set("language", opts.lang);
    if (bias) u.searchParams.set("proximity", `${opts.lng},${opts.lat}`);
    const j = (await getJson(u.toString())) as { features: MtFeature[] };
    places = j.features.map(mtPlace);
  } else {
    const u = new URL("https://photon.komoot.io/api/");
    u.searchParams.set("q", q);
    u.searchParams.set("limit", String(limit));
    if (opts.lang && ["en", "de", "fr"].includes(opts.lang)) u.searchParams.set("lang", opts.lang);
    if (bias) {
      u.searchParams.set("lat", String(opts.lat));
      u.searchParams.set("lon", String(opts.lng));
    }
    const j = (await getJson(u.toString())) as { features: PhotonFeature[] };
    places = j.features.map(photonPlace);
  }
  // Collapse exact duplicates (same name and nearly the same spot).
  const seen = new Set<string>();
  places = places.filter((p) => {
    const k = `${p.name}|${p.lat.toFixed(2)}|${p.lng.toFixed(2)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  store(key, places);
  return places;
}

export async function reverseGeocode(lat: number, lng: number, lang?: string): Promise<ReversePlace> {
  const key = `r|${lat.toFixed(4)}|${lng.toFixed(4)}|${lang ?? ""}`;
  const hit = cached<ReversePlace>(key);
  if (hit) return hit;
  const hierarchy: { kind: string; name: string }[] = [];
  if (KEY) {
    const u = new URL(`https://api.maptiler.com/geocoding/${lng},${lat}.json`);
    u.searchParams.set("key", KEY);
    if (lang) u.searchParams.set("language", lang);
    const j = (await getJson(u.toString())) as { features: MtFeature[] };
    for (const f of j.features) {
      const k = f.place_type?.[0] ?? "place";
      hierarchy.push({ kind: k === "municipality" ? "city" : k, name: f.text });
    }
  } else {
    const u = new URL("https://photon.komoot.io/reverse");
    u.searchParams.set("lat", String(lat));
    u.searchParams.set("lon", String(lng));
    const j = (await getJson(u.toString())) as { features: PhotonFeature[] };
    const p = j.features[0]?.properties ?? {};
    const push = (kind: string, v: unknown) => typeof v === "string" && v && !hierarchy.some((h) => h.name === v) && hierarchy.push({ kind, name: v });
    if (p.type !== "street" && p.type !== "house" && p.name) push(p.osm_key === "building" ? "building" : "poi", p.name);
    if (p.street) push("street", `${p.street}${p.housenumber ? ` ${p.housenumber}` : ""}`);
    else if (p.type === "street") push("street", p.name);
    push("district", p.district);
    push("city", p.city);
    push("state", p.state);
    push("country", p.country);
  }
  const value: ReversePlace = { lat, lng, hierarchy, label: hierarchy.slice(0, 3).map((h) => h.name).join(", ") || "Unnamed location" };
  store(key, value);
  return value;
}

export function geocodeError(err: unknown) {
  log("warn", "geocoder failed", { provider: GEOCODER, err: String(err) });
}
