import { groupOf } from "../categories";
import { slugify } from "../destinations";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, nearestCityId, plainText, sleep } from "./common";
import KNOWN_VENUES from "./data/lisbon-venues.json";

/**
 * Venue calendars published with The Events Calendar's public REST API
 * (/wp-json/tribe/events/v1/events), which venues expose so their programme can be shared.
 *
 * - Each source is one venue; its location comes from our hand-checked venue table.
 * - Sessions of the same show share a URL (…/evento/<show>/<date>/), so they are grouped
 *   into one event with a schedule.
 * - School-only sessions are left out: they aren't open to the public.
 */

const UA = "OMNIEVENT/1.0 (+https://omnievent.vercel.app)";
const TZ = "Europe/Lisbon";

interface Source {
  id: string;
  name: string;
  base: string;
  venueSlug: keyof typeof KNOWN_VENUES;
  /** Category slugs whose sessions are not open to the public. */
  exclude?: string[];
}

export const SOURCES: Source[] = [
  { id: "ccb", name: "Centro Cultural de Belém", base: "https://www.ccb.pt", venueSlug: "centro-cultural-de-belem", exclude: ["escolas", "schools", "projetos-de-mediacao"] },
  { id: "chapito", name: "Chapitô", base: "https://chapito.org", venueSlug: "chapito" },
];

export interface TribeEvent {
  id: number | string;
  url?: string;
  title?: string;
  description?: string;
  excerpt?: string;
  image?: { url?: string } | false;
  all_day?: boolean;
  start_date?: string;
  end_date?: string;
  utc_start_date?: string;
  utc_end_date?: string;
  timezone?: string;
  cost?: string;
  cost_details?: { currency_code?: string; values?: (string | number)[] };
  website?: string;
  categories?: { slug?: string; name?: string }[];
}

// First match wins, so specific slugs come before general ones.
const CATEGORY_MAP: [string, string][] = [
  ["opera", "opera"], ["jazz", "jazz"], ["fado", "traditional"], ["danca", "dance"], ["teatro", "plays"],
  ["circo", "circus"], ["cinema", "cinema"], ["musica", "concerts"], ["festival", "festivals"],
  ["conferencias-conversas", "public-lectures"], ["centro-arquitetura", "design-exhibitions"], ["instalacao", "art-exhibitions"],
  ["exposicoes", "art-exhibitions"], ["exhibitions", "art-exhibitions"], ["mac-ccb", "art-exhibitions"],
  ["fabrica-das-artes", "family-shows"], ["familias", "family-shows"], ["performance", "plays"], ["espetaculos", "plays"],
  ["atividades", "creative-workshops"],
];

export function mapTribeCategory(slugs: string[]): string {
  for (const [slug, cat] of CATEGORY_MAP) if (slugs.includes(slug)) return cat;
  return "culture";
}

/** UTC timestamps from the API look like "2026-10-24 20:00:00". */
const utc = (s?: string) => (s ? Date.parse(`${s.replace(" ", "T")}Z`) : NaN);

/** Pure mapping function — unit-tested with fixtures in tests/venue-calendars.test.ts. */
export function normalizeTribe(source: Source, raw: TribeEvent[], syncedAt: string, now = Date.now()): ProviderBatch {
  const loc = KNOWN_VENUES[source.venueSlug];
  const venueId = `vc-v-${source.id}`;
  const venue: Venue = {
    id: venueId,
    slug: slugify(`${loc.name}-lisboa`),
    name: loc.name,
    city: "Lisbon",
    cityId: nearestCityId(loc.lat, loc.lng) ?? "lisbon",
    country: "Portugal",
    countryCode: "PT",
    lat: loc.lat,
    lng: loc.lng,
    timeZone: TZ,
    url: source.base,
    provenance: { provider: "venue-calendars", externalId: source.id, sourceUrl: source.base, lastSyncedAt: syncedAt, isDemo: false },
  };

  // Group sessions of the same show by their URL without the trailing date.
  const shows = new Map<string, TribeEvent[]>();
  for (const r of raw) {
    const slugs = (r.categories ?? []).map((c) => c.slug ?? "");
    if (source.exclude?.some((x) => slugs.includes(x))) continue;
    const start = utc(r.utc_start_date);
    if (!r.title || !Number.isFinite(start)) continue;
    const end = utc(r.utc_end_date);
    if ((Number.isFinite(end) ? end : start) < now - 3600000) continue;
    const key = (r.url ?? String(r.id)).replace(/\/\d{4}-\d{2}-\d{2}\/?$/, "");
    shows.set(key, [...(shows.get(key) ?? []), r]);
  }

  const events: OmniEvent[] = [];
  const offers: TicketOffer[] = [];
  for (const [key, list] of shows) {
    list.sort((a, b) => utc(a.utc_start_date) - utc(b.utc_start_date));
    const first = list[0];
    const start = utc(first.utc_start_date);
    const end = utc(first.utc_end_date);
    const slugs = [...new Set(list.flatMap((r) => (r.categories ?? []).map((c) => c.slug ?? "")))];
    const cat = mapTribeCategory(slugs);
    const group = groupOf(cat);
    const extId = `${source.id}:${key.replace(/^https?:\/\/[^/]+/, "")}`;
    const id = `vc-e-${slugify(extId)}`;
    const durationMinutes = Number.isFinite(end) && end > start ? Math.round((end - start) / 60000) : undefined;
    const allDay = !!first.all_day;
    const values = (first.cost_details?.values ?? []).map(Number).filter((n) => Number.isFinite(n));
    const isFree = /gr[áa]tis|gratuit|free|entrada livre/i.test(first.cost ?? "") || (values.length > 0 && Math.max(...values) === 0);
    const min = values.length && !isFree ? Math.min(...values) : undefined;
    const max = values.length > 1 && !isFree ? Math.max(...values) : undefined;
    const title = plainText(first.title) ?? first.title!;
    const link = first.website || first.url || source.base;
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${source.id}-${hueOf(key)}`),
      title,
      description: plainText(first.description)?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: group,
      eventType: list.length > 1 ? "recurring" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: list.length === 1 && Number.isFinite(end) && end > start ? new Date(end).toISOString() : undefined,
      durationMinutes: list.length > 1 ? durationMinutes : undefined,
      schedule: list.length > 1 ? list.slice(1, 500).map((r) => new Date(utc(r.utc_start_date)).toISOString()) : undefined,
      hoursUnknown: allDay || undefined,
      timeZone: TZ,
      status: isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : first.cost || values.length ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: group === "family" || slugs.includes("familias") || slugs.includes("fabrica-das-artes"),
      accessibility: slugs.includes("programacao-acessivel") ? ["Accessible programme (see the venue's page for details)."] : undefined,
      officialUrl: first.url,
      imageUrl: first.image && typeof first.image === "object" ? first.image.url : undefined,
      posterHue: hueOf(key),
      participants: [],
      provenance: { provider: "venue-calendars", externalId: extId, sourceUrl: first.url, lastSyncedAt: syncedAt, isDemo: false },
    });
    offers.push({
      id: `${id}-venue`,
      eventId: id,
      provider: source.name,
      providerType: "box_office",
      ticketCategory: "standard",
      label: isFree ? "Free entry, details on the venue's site" : min !== undefined ? "Advertised price at the venue" : "Tickets and prices on the venue's site",
      basePrice: min,
      maxPrice: max !== undefined && min !== undefined && max > min ? max : undefined,
      currency: min !== undefined ? "EUR" : "",
      availability: "unknown",
      purchaseUrl: link,
      priceObservedAt: min !== undefined ? syncedAt : undefined,
      isDemo: false,
    });
  }
  return { events, venues: events.length ? [venue] : [], participants: [], offers };
}

export const venueCalendarsProvider: ProviderAdapter = {
  id: "venue-calendars",
  name: "Lisbon venue calendars (CCB, Chapitô)",
  isDemo: false,
  coverage: "Full programmes published by Lisbon venues on their own public calendars.",
  attribution: "Programme data from each venue's public calendar.",
  isConfigured: () => true,
  refreshIntervalMs: 3 * 3600000,
  async sync(ctx) {
    const syncedAt = new Date().toISOString();
    const batches: ProviderBatch[] = [];
    let failures = 0;
    let lastError = "";
    for (const source of SOURCES) {
      const raw: TribeEvent[] = [];
      for (let page = 1; page <= 40; page++) {
        const url = new URL(`${source.base}/wp-json/tribe/events/v1/events`);
        url.searchParams.set("per_page", "50");
        url.searchParams.set("page", String(page));
        url.searchParams.set("start_date", new Date(Math.floor(Date.now() / 86400000) * 86400000).toISOString().slice(0, 10));
        try {
          const json = (await fetchJson("venue-calendars", url, ctx, { headers: { "User-Agent": UA }, timeoutMs: 40000 })) as { events?: TribeEvent[]; total_pages?: number };
          raw.push(...(json.events ?? []));
          if (page >= (json.total_pages ?? 0)) break;
        } catch (err) {
          // The API answers 400 past the last page; anything else is a real failure.
          if (!String(err).includes("HTTP 400")) {
            failures++;
            lastError = `${source.id}: ${String(err).slice(0, 140)}`;
          }
          break;
        }
        await sleep(200);
      }
      batches.push(normalizeTribe(source, raw, syncedAt));
    }
    const batch: ProviderBatch = {
      events: batches.flatMap((b) => b.events),
      venues: batches.flatMap((b) => b.venues),
      participants: [],
      offers: batches.flatMap((b) => b.offers),
    };
    return {
      batch,
      run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0 || failures === 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} source(s) failed (last: ${lastError})` : undefined },
    };
  },
};
