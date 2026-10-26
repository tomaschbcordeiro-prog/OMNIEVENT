import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, parseAmount, plainText, zonedDay } from "./common";

/**
 * Ajuntament de Barcelona open data: the city's cultural agenda (concerts, exhibitions,
 * talks, workshops, festes in every district) and its sports agenda, read through the
 * portal's datastore API. No key needed. The feed gives dates, the address and its
 * coordinates; the time is read from the timetable when there is a single one.
 * League football is left out (the football source has it).
 */

const API = "https://opendata-ajuntament.barcelona.cat/data/api/3/action/datastore_search";
const RESOURCES = ["3abb2414-1ee0-446e-9c25-380e938adb73", "ab2d47b7-8493-4ed5-9f63-49ed116135f9"];
const TZ = "Europe/Madrid";

export interface BcnRow {
  register_id?: string;
  name?: string;
  start_date?: string | null;
  end_date?: string | null;
  timetable?: string | null;
  addresses_road_name?: string | null;
  addresses_start_street_number?: number | string | null;
  addresses_neighborhood_name?: string | null;
  addresses_district_name?: string | null;
  addresses_zip_code?: number | string | null;
  geo_epgs_4326_lat?: number | string | null;
  geo_epgs_4326_lon?: number | string | null;
}

const MAP: [RegExp, string][] = [
  [/infantil|familiar|en família|contes|hora del conte|titelles/, "family-shows"],
  [/^taller|^curs|workshop/, "creative-workshops"], [/exposici|mostra d'art/, "art-exhibitions"], [/òpera/, "opera"],
  [/concert|recital|música/, "concerts"], [/teatre|monòleg/, "plays"], [/dansa|ball/, "dance"], [/cinema|cineclub|projecci|pel·lícula/, "cinema"],
  [/conferència|xerrada|presentaci|lectura|tertúlia|debat|col·loqui/, "public-lectures"], [/ruta|visita|itinerari|passejada/, "guided-tours"],
  [/festival/, "festivals"], [/festa|castanyada|correfoc|cavalcada|nadal|fira|mercat/, "street-festivals"],
  [/cursa|marató|bàsquet|handbol|hoquei|petanca|torneig|tennis|natació|waterpolo|rugby|atletisme|futbol/, "sports"],
];

export function mapBcnCategory(title: string): string {
  const t = title.toLowerCase();
  for (const [re, slug] of MAP) if (re.test(t)) return slug;
  return "culture";
}

/** "a les 19.00 h" once in the timetable → "19:00"; ranges and several times → undefined. */
export function bcnTime(timetable?: string | null): string | undefined {
  const text = plainText(timetable ?? "") ?? "";
  const all = [...text.matchAll(/a les (\d{1,2})[.:](\d{2})/g)];
  if (all.length !== 1 || /\bde \d{1,2}[.:]\d{2}/.test(text) || Number(all[0][1]) > 23) return undefined;
  return `${all[0][1].padStart(2, "0")}:${all[0][2]}`;
}

/** Pure mapping function — unit-tested in tests/barcelona.test.ts. */
export function normalizeBarcelona(rows: BcnRow[], syncedAt: string, now = Date.now()): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    // The feed's ids sometimes start with a byte-order mark.
    const rid = (r.register_id ?? "").replace(/\D/g, "");
    const title = plainText(r.name ?? "")?.replace(/\s*\*N(OU)?\*\s*/gi, " ").trim();
    const lat = Number(r.geo_epgs_4326_lat);
    const lng = Number(r.geo_epgs_4326_lon);
    if (!rid || !title || seen.has(rid) || r.geo_epgs_4326_lat == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < 41.2 || lat > 41.6 || lng < 1.9 || lng > 2.4) continue;
    if (/^futbol\b/i.test(title)) continue;
    const day0 = r.start_date?.slice(0, 10);
    const day1 = r.end_date?.slice(0, 10) || day0;
    if (!day0 || !day1 || day1 < day0) continue;
    const time = day1 === day0 ? bcnTime(r.timetable) : undefined;
    const start = zonedDay(day0, TZ, time);
    const end = zonedDay(day1, TZ, "23:59");
    if (start === undefined || end === undefined || end < now) continue;
    seen.add(rid);

    const street = [r.addresses_road_name?.trim(), r.addresses_start_street_number ?? undefined].filter(Boolean).join(", ");
    const area = r.addresses_neighborhood_name?.trim() || r.addresses_district_name?.trim();
    const name = street || area || "Barcelona";
    const venueKey = `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `bcn-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    const zip = r.addresses_zip_code ? String(r.addresses_zip_code).padStart(5, "0") : undefined;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-barcelona-${hueOf(venueKey)}`),
        name,
        address: [street, area, zip && `${zip} Barcelona`].filter(Boolean).join(", ") || undefined,
        city: "Barcelona",
        cityId: nearestCityId(lat, lng),
        country: "Spain",
        countryCode: "ES",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: "barcelona", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapBcnCategory(title);
    const prices = plainText(r.timetable?.match(/timetable-price[^>]*>([\s\S]*?)<\/td>/)?.[1] ?? "") ?? "";
    const isFree = /gratu[iï]t/i.test(prices) && !/€/.test(prices);
    const price = isFree ? undefined : parseAmount(prices);
    const multi = day1 !== day0;
    const id = `bcn-e-${rid}`;
    const url = `https://guia.barcelona.cat/ca/detall/${slugify(title).slice(0, 80)}_${rid}.html`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-barcelona-${rid.slice(-6)}`),
      title,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(end).toISOString() : undefined,
      hoursUnknown: !time || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      officialUrl: url,
      posterHue: hueOf(rid),
      participants: [],
      provenance: { provider: "barcelona", externalId: rid, sourceUrl: url, lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined)
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: "Guia Barcelona",
        providerType: "primary",
        ticketCategory: "standard",
        label: `Advertised: ${prices.slice(0, 80)}`,
        basePrice: price,
        currency: "EUR",
        availability: "unknown",
        purchaseUrl: url,
        priceObservedAt: syncedAt,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

export const barcelonaProvider: ProviderAdapter = {
  id: "barcelona",
  name: "Ajuntament de Barcelona agenda",
  isDemo: false,
  coverage: "Concerts, exhibitions, talks, workshops, festes and sports events across Barcelona's districts.",
  attribution: "Data: Ajuntament de Barcelona, Open Data BCN (CC BY 4.0).",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const rows: BcnRow[] = [];
    let failures = 0;
    let lastError = "";
    for (const id of RESOURCES) {
      try {
        const json = (await fetchJson("barcelona", `${API}?resource_id=${id}&limit=32000`, ctx, { revalidate: 0, timeoutMs: 120000 })) as { result?: { records?: BcnRow[] } };
        rows.push(...(json.result?.records ?? []));
      } catch (err) {
        failures++;
        lastError = String(err).slice(0, 160);
        ctx.log("barcelona resource failed", { id, err: lastError });
      }
    }
    const batch = normalizeBarcelona(rows, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? lastError : undefined } };
  },
};
