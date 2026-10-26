import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseLocal, plainText } from "./common";

/**
 * NYC Parks public events for the next 14 days (NYC Open Data): free concerts, tours,
 * festivals, film screenings, kids' activities and nature programs in the city's parks,
 * with coordinates. Recurring fitness classes are left out.
 */

const API = "https://data.cityofnewyork.us/resource/w3wp-dpdi.json";
const TZ = "America/New_York";

export interface NycRow {
  guid: string;
  title?: string;
  link?: { url?: string } | string;
  description?: string;
  starttime?: string;
  endtime?: string;
  location?: string;
  parknames?: string;
  coordinates?: string;
  categories?: string;
  registration_url?: { url?: string } | string;
  image?: { url?: string } | string;
}

const url = (v?: { url?: string } | string) => (typeof v === "string" ? v : v?.url);

const MAP: [RegExp, string][] = [
  [/concert|music|jazz/, "concerts"], [/film|movie/, "outdoor-cinema"], [/festival/, "street-festivals"],
  [/theater|theatre|performance/, "plays"], [/dance/, "dance"], [/best for kids|kids|family|\bstory/, "kids-festivals"],
  [/tour|walk|history/, "guided-tours"], [/nature|birding|wildlife|gardening/, "hiking"], [/art\b|arts/, "creative-workshops"],
  [/talk|lecture/, "public-lectures"], [/astronomy|stargazing/, "stargazing"],
];

export function mapNycCategory(cats: string): string | undefined {
  const c = cats.toLowerCase();
  // Classes that run every week are not events people plan around.
  if (/shape up nyc|fitness|exercise|yoga|running\/jogging/.test(c) && !/festival|concert|tour/.test(c)) return undefined;
  for (const [re, slug] of MAP) if (re.test(c)) return slug;
  return "culture";
}

/** Pure mapping function — unit-tested in tests/nyc-parks.test.ts. */
export function normalizeNycParks(rows: NycRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  for (const r of rows) {
    const [lat, lng] = (r.coordinates ?? "").split(",").map((s) => Number(s.trim()));
    if (!r.guid || !r.title || !Number.isFinite(lat) || !Number.isFinite(lng) || lat === 0) continue;
    if (lat < 40.4 || lat > 41 || lng < -74.3 || lng > -73.6) continue;
    const cat = mapNycCategory(r.categories ?? "");
    if (!cat) continue;
    const start = parseLocal(r.starttime, TZ);
    const end = parseLocal(r.endtime, TZ);
    if (start === undefined || (end ?? start) < now) continue;

    const name = (r.location ?? r.parknames ?? "NYC park").replace(/\s*\(in [^)]*\)\s*$/, "").trim();
    const park = r.parknames?.split(",")[0]?.trim();
    const venueKey = `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `nyc-v-${keyOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${keyOf(venueKey)}`),
        name,
        address: park && park !== name ? park : undefined,
        city: "New York",
        cityId: nearestCityId(lat, lng),
        country: "United States",
        countryCode: "US",
        lat,
        lng,
        timeZone: TZ,
        venueType: "park",
        indoor: false,
        provenance: { provider: "nyc-parks", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });
    const id = `nyc-e-${r.guid}`;
    const link = url(r.link);
    const registration = url(r.registration_url);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${r.title}-${r.guid}`),
      title: plainText(r.title) ?? r.title,
      description: plainText(r.description)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: "single",
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined && end > start ? new Date(end).toISOString() : undefined,
      timeZone: TZ,
      status: "free_entry",
      ticketAccess: registration ? "registration" : "free",
      isFree: true,
      registrationRequired: !!registration,
      online: false,
      familyFriendly: /kids|family/i.test(r.categories ?? ""),
      officialUrl: link?.replace(/^http:/, "https:"),
      imageUrl: url(r.image),
      posterHue: hueOf(r.guid),
      participants: [],
      provenance: { provider: "nyc-parks", externalId: r.guid, sourceUrl: link, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

export const nycParksProvider: ProviderAdapter = {
  id: "nyc-parks",
  name: "NYC Parks events",
  isDemo: false,
  coverage: "Free public events in New York City parks over the next two weeks.",
  attribution: "Data: NYC Parks via NYC Open Data.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const rows = (await fetchJson("nyc-parks", `${API}?$limit=5000`, ctx, { revalidate: 0, timeoutMs: 40000 })) as NycRow[];
    const batch = normalizeNycParks(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
