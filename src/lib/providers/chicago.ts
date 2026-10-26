import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseLocal, plainText } from "./common";

/**
 * City of Chicago open data (Socrata), no key needed:
 * - Chicago Public Library events: talks, crafts, story times, films, clubs in every branch.
 * - Chicago Park District activities: park events, plus drop-in ("Open") sessions and
 *   tournaments. Paid courses and classes ("Instruction", camps, leagues) are left out:
 *   they're enrolments rather than events.
 */

const CPL = "https://data.cityofchicago.org/resource/vsdy-d8k7.json?$limit=50000";
const CPD = "https://data.cityofchicago.org/resource/tn7v-6rnw.json?$limit=50000";
const TZ = "America/Chicago";

type Point = { coordinates?: number[] } | null;
export interface CplRow {
  event_id?: string;
  title?: string;
  description?: string;
  event_types?: string;
  event_audiences?: string;
  event_page?: { url?: string };
  location_name?: string;
  location_address?: string;
  location_zip?: string;
  location?: Point;
  start?: string;
  end?: string;
  cancelled?: boolean;
  registration_status?: string;
}
export interface CpdRow {
  activity_id?: string;
  type?: string;
  title?: string;
  start_date?: string;
  end_date?: string;
  date_notes?: string;
  location_facility?: string;
  activity_type?: string;
  category?: string;
  fee?: string;
  information_link?: { url?: string };
  address?: string;
  zip?: string;
  latitude?: string;
  longitude?: string;
}

const MAP: [RegExp, string][] = [
  [/story ?time|kids|children|family|teen/, "family-shows"], [/concert|music/, "concerts"], [/film|movie/, "cinema"],
  [/author|book|lecture|talk|history|discussion/, "public-lectures"], [/craft|diy|art|maker|workshop|decorative/, "creative-workshops"],
  [/theat|drama/, "plays"], [/dance/, "dance"], [/festival/, "festivals"], [/tour|walk|nature/, "guided-tours"],
  [/sport|basketball|soccer|swim|aquatic|fitness|tennis|skating|tournament|baseball|volleyball|run/, "sports"],
];

export function mapChicagoCategory(text: string): string {
  const t = text.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

const inChicago = (lat: number, lng: number) => lat > 41.6 && lat < 42.1 && lng > -88 && lng < -87.5;

function venueOf(venues: Map<string, Venue>, name: string, address: string | undefined, zip: string | undefined, lat: number, lng: number, kind: string, syncedAt: string): string {
  const key = `${kind}|${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
  const id = `chi-v-${hueOf(key)}-${slugify(name).slice(0, 40)}`;
  if (!venues.has(id))
    venues.set(id, {
      id,
      slug: slugify(`${name}-chicago-${hueOf(key)}`),
      name,
      address: [address, zip && `Chicago, IL ${zip}`].filter(Boolean).join(", ") || undefined,
      city: "Chicago",
      cityId: nearestCityId(lat, lng),
      country: "United States",
      countryCode: "US",
      lat,
      lng,
      timeZone: TZ,
      provenance: { provider: "chicago", externalId: key, lastSyncedAt: syncedAt, isDemo: false },
    });
  return id;
}

/** Pure mapping function — unit-tested in tests/chicago.test.ts. */
export function normalizeChicago(library: CplRow[], parks: CpdRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const seen = new Set<string>();

  for (const r of library) {
    const title = plainText(r.title);
    const [lng, lat] = r.location?.coordinates ?? [NaN, NaN];
    if (!r.event_id || !title || r.cancelled || !Number.isFinite(lat) || !inChicago(lat, lng)) continue;
    const start = parseLocal(r.start, TZ);
    const endRaw = parseLocal(r.end, TZ);
    const end = endRaw !== undefined && start !== undefined && endRaw > start ? endRaw : undefined;
    if (start === undefined || (end ?? start) < now) continue;
    const id = `chi-lib-${r.event_id}-${start}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const branch = r.location_name?.trim() || "Chicago Public Library";
    const name = /library/i.test(branch) ? branch : `${branch} Library`;
    const venueId = venueOf(venues, name, r.location_address, r.location_zip, lat, lng, "lib", syncedAt);
    const cat = mapChicagoCategory(`${r.event_types ?? ""} ${r.event_audiences ?? ""} ${title}`);
    const url = r.event_page?.url || "https://chipublib.bibliocommons.com/events";
    const registration = !!r.registration_status && !/not required/i.test(r.registration_status);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${branch}-${hueOf(id)}`),
      title,
      description: plainText(r.description)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: "single",
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      timeZone: TZ,
      status: "free_entry",
      ticketAccess: registration ? "registration" : "free",
      isFree: true,
      registrationRequired: registration,
      online: false,
      familyFriendly: cat === "family-shows" || /kids|children|famil/i.test(r.event_audiences ?? ""),
      officialUrl: url,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "chicago", externalId: r.event_id, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
  }

  for (const r of parks) {
    const title = plainText(r.title)?.replace(/&amp;/g, "&");
    const lat = Number(r.latitude);
    const lng = Number(r.longitude);
    if (!r.activity_id || !title || !Number.isFinite(lat) || !Number.isFinite(lng) || !inChicago(lat, lng)) continue;
    if (r.type !== "Event" && !/^(open|tournament)$/i.test(r.activity_type ?? "")) continue;
    const start = parseLocal(r.start_date, TZ);
    const endRaw = parseLocal(r.end_date, TZ);
    if (start === undefined || endRaw === undefined || endRaw < now) continue;
    const id = `chi-park-${r.activity_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const multi = endRaw - start > 36 * 3600000;
    const venueId = venueOf(venues, r.location_facility?.trim() || "Chicago Park District", r.address, r.zip, lat, lng, "park", syncedAt);
    const cat = mapChicagoCategory(`${r.category ?? ""} ${title}`);
    const fee = Number(r.fee);
    const isFree = r.fee === undefined || fee === 0;
    const url = r.information_link?.url || "https://www.chicagoparkdistrict.com/events";
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-chicago-${r.activity_id}`),
      title,
      description: r.date_notes?.trim() || undefined,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: new Date(endRaw).toISOString(),
      hoursUnknown: multi || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : "registration",
      isFree,
      registrationRequired: !isFree,
      online: false,
      familyFriendly: cat === "family-shows" || /kids|youth|family|tot/i.test(title),
      officialUrl: url,
      posterHue: hueOf(id),
      participants: [],
      provenance: { provider: "chicago", externalId: r.activity_id, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

export const chicagoProvider: ProviderAdapter = {
  id: "chicago",
  name: "City of Chicago (libraries and parks)",
  isDemo: false,
  coverage: "Chicago Public Library events in every branch, and Chicago Park District events, drop-in sessions and tournaments.",
  attribution: "Data: City of Chicago open data portal.",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const [lib, parks] = await Promise.allSettled([
      fetchJson("chicago", CPL, ctx, { revalidate: 0, timeoutMs: 90000 }) as Promise<CplRow[]>,
      fetchJson("chicago", CPD, ctx, { revalidate: 0, timeoutMs: 90000 }) as Promise<CpdRow[]>,
    ]);
    const failed = [lib, parks].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    for (const f of failed) ctx.log("chicago dataset failed", { err: String(f.reason).slice(0, 160) });
    const batch = normalizeChicago(lib.status === "fulfilled" ? lib.value : [], parks.status === "fulfilled" ? parks.value : [], syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: failed.length, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failed.length ? String(failed[0].reason).slice(0, 160) : undefined } };
  },
};
