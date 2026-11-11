/**
 * The town or city at a point, for a trip's stop: from what a reverse geocoder says is there
 * (an address in Liverpool → "Liverpool"). Pure, so it can be tested; the lookups are in
 * geocode.ts.
 */

export interface Town {
  name: string;
  country?: string;
  countryCode?: string;
  /** The site's own city, when the point is in one. */
  cityId?: string;
  lat: number;
  lng: number;
}

/** OpenStreetMap places that are somewhere people live (a "locality" is a named field or crossroads). */
const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "municipality"]);

/** Photon (OpenStreetMap): the settlement itself, or the one an address, street or landmark is in. */
export function townFromPhoton(p: Record<string, unknown>): Pick<Town, "name" | "country" | "countryCode"> | null {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const value = str(p.osm_value);
  const own = p.osm_key === "place" && value && SETTLEMENT.has(value) ? str(p.name) : undefined;
  const name = own ?? str(p.city) ?? (p.type === "city" ? str(p.name) : undefined) ?? str(p.district) ?? str(p.county) ?? str(p.state) ?? str(p.name);
  if (!name) return null;
  const cc = str(p.countrycode);
  return { name, country: str(p.country), countryCode: cc ? cc.toUpperCase() : undefined };
}

type MtFeature = { text: string; place_type?: string[]; properties?: { country_code?: string } };
const MT_ORDER = ["municipality", "locality", "place", "joint_municipality", "municipal_district", "county", "subregion", "region"];

/** MapTiler: the most local settlement among the places round a point. */
export function townFromMapTiler(features: MtFeature[]): Pick<Town, "name" | "country" | "countryCode"> | null {
  const country = features.find((f) => f.place_type?.includes("country"));
  for (const kind of MT_ORDER) {
    const f = features.find((x) => x.place_type?.includes(kind));
    if (f?.text) return { name: f.text, country: country?.text, countryCode: country?.properties?.country_code?.toUpperCase() };
  }
  return null;
}

/** "Belfast City" (a council's name) → "Belfast", when a settlement of that name is right there. */
export function plainCityName(name: string, nearby: string[]): string {
  const m = name.match(/^(.+) City$/);
  return m && nearby.includes(m[1]) ? m[1] : name;
}
