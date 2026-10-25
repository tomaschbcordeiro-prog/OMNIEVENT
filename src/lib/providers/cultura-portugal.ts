import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, plainText, zonedDay } from "./common";
import VENUES from "./data/cultura-portugal-venues.json";

/**
 * culturaportugal.gov.pt, the Portuguese government's culture portal (GEPAC): exhibitions,
 * concerts, theatre and talks at national museums, monuments and theatres, including the
 * Azores. Its feed gives a placeholder position for every event, so venues were located by
 * name (data/cultura-portugal-venues.json, scripts/fetch-cultura-portugal-venues.mjs);
 * venues we couldn't place, and events in several places, are shown at the town centre and
 * say so. The feed's times are when the entry was made, so only dates are used.
 */

const API = "https://culturaportugal.gov.pt/umbraco/api/eventsapi/GetEvents";
const TZ = "Europe/Lisbon";

export interface CpEvent {
  Name?: string;
  Type?: string;
  Theme?: string;
  StartDate?: string | null;
  EndDate?: string | null;
  Location?: string;
  Where?: string;
  Price?: string;
  Info?: string;
  Text?: string;
  Url?: string;
  ImageUrl?: string;
  Permanent?: boolean;
}

type Geo = { lat: number; lng: number } | null;

const TYPE: [RegExp, string][] = [
  [/exposi/i, "art-exhibitions"], [/concert|m[uú]sica/i, "concerts"], [/teatro/i, "plays"], [/dan[cç]a/i, "dance"],
  [/confer|semin|col[oó]quio|debate|palestra/i, "public-lectures"], [/oficina|workshop|forma[cç]/i, "creative-workshops"],
  [/visita/i, "guided-tours"], [/cinema|filme/i, "cinema"], [/festival/i, "festivals"], [/[oó]pera/i, "opera"],
];

export function mapCpCategory(e: Pick<CpEvent, "Type" | "Theme">): string {
  for (const [re, slug] of TYPE) if (re.test(e.Type ?? "")) return slug;
  for (const [re, slug] of TYPE) if (re.test(e.Theme ?? "")) return slug;
  return "culture";
}

const firstLine = (h?: string) => (h ?? "").replace(/<[^>]+>/g, "\n").split("\n").map((s) => s.trim()).filter(Boolean)[0]?.normalize("NFKC") ?? "";

/** Pure mapping function — unit-tested in tests/cultura-portugal.test.ts. */
export function normalizeCp(items: CpEvent[], syncedAt: string, now = Date.now(), table: Record<string, unknown> = VENUES): ProviderBatch {
  const towns = (table.__towns ?? {}) as Record<string, Geo>;
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  for (const e of items) {
    const town = (e.Location ?? "").trim();
    const where = firstLine(e.Where);
    if (!e.Name || !e.Url || !town || /^online$/i.test(where)) continue;
    const placed = (table[`${where}|${town}`] as Geo | undefined) ?? null;
    const centre = towns[town];
    const geo = placed ?? centre;
    if (!geo) continue;
    const day0 = e.StartDate?.slice(0, 10);
    const day1 = (e.EndDate ?? e.StartDate)?.slice(0, 10);
    if (!day0 || !day1) continue;
    const start = zonedDay(day0, TZ);
    const endDay = zonedDay(day1, TZ, "23:59");
    if (start === undefined || endDay === undefined || endDay < now) continue;
    const multi = day1 !== day0;

    const name = where || town;
    const several = /\/|v[aá]ri[oa]s/i.test(name);
    const venueKey = `${name}|${town}`;
    const venueId = `cp-v-${hueOf(venueKey)}-${slugify(name).slice(0, 40)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${town}-${hueOf(venueKey)}`),
        name,
        address: placed ? undefined : several ? `Several venues; shown at the centre of ${town}` : `Exact location not found; shown at the centre of ${town}`,
        city: town,
        cityId: nearestCityId(geo.lat, geo.lng),
        country: "Portugal",
        countryCode: "PT",
        lat: geo.lat,
        lng: geo.lng,
        timeZone: TZ,
        provenance: { provider: "cultura-portugal", externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const cat = mapCpCategory(e);
    const priceText = plainText(e.Price) ?? "";
    const isFree = /gratu|entrada livre|livre/i.test(priceText);
    const id = `cp-e-${hueOf(e.Url)}-${slugify(e.Name).slice(0, 30)}`;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${e.Name}-${town}-${hueOf(e.Url)}`),
      title: plainText(e.Name) ?? e.Name,
      description: [plainText(e.Text)?.slice(0, 1400), priceText && `Price: ${priceText}`].filter(Boolean).join("\n\n") || undefined,
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: multi ? new Date(endDay).toISOString() : undefined,
      hoursUnknown: true,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: /fam[ií]lia|crian/i.test(`${e.Name} ${(e as { Who?: string }).Who ?? ""}`),
      officialUrl: e.Info?.match(/href="(https?:\/\/[^"]+)"/)?.[1] ?? e.Url,
      imageUrl: e.ImageUrl?.replace(/^http:/, "https:"),
      posterHue: hueOf(e.Url),
      participants: [],
      provenance: { provider: "cultura-portugal", externalId: e.Url, sourceUrl: e.Url, lastSyncedAt: syncedAt, isDemo: false },
    });
  }
  return { events, venues: [...venues.values()], participants: [], offers: [] };
}

export const culturaPortugalProvider: ProviderAdapter = {
  id: "cultura-portugal",
  name: "Cultura Portugal (government culture portal)",
  isDemo: false,
  coverage: "Exhibitions, concerts, theatre and talks at Portugal's national museums, monuments and theatres, including the Azores.",
  attribution: "Data: culturaportugal.gov.pt (GEPAC).",
  isConfigured: () => true,
  refreshIntervalMs: 6 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const items = (await fetchJson("cultura-portugal", API, ctx, { revalidate: 0, timeoutMs: 40000 })) as CpEvent[];
    const batch = normalizeCp(items, syncedAt);
    return { batch, run: { imported: batch.events.length, updated: 0, failures: 0, rateLimited: false, ok: true, finishedAt: new Date().toISOString() } };
  },
};
