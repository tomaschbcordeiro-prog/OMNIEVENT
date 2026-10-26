import { slugify } from "../destinations";
import { groupOf } from "../categories";
import type { OmniEvent, TicketOffer, Venue } from "../types";
import type { ProviderAdapter, ProviderBatch } from "./types";
import { fetchJson, hueOf, keyOf, nearestCityId, parseAmount, plainText } from "./common";

/**
 * Linked Events: the open events API software of Finnish cities, no key needed.
 * - Helsinki (api.hel.fi), also used by Vantaa and many organisers in the region.
 * - Espoo (api.espoo.fi), its own instance: city departments, cultural centres, libraries.
 * Concerts, theatre, exhibitions, libraries, youth and family activities, sports.
 */

const TZ = "Europe/Helsinki";

export interface LinkedEventsSource {
  provider: string;
  api: string;
  city: string;
  page: (id: string) => string;
}

export const HELSINKI: LinkedEventsSource = {
  provider: "helsinki",
  api: "https://api.hel.fi/linkedevents/v1/event/",
  city: "Helsinki",
  page: (id) => `https://tapahtumat.hel.fi/en/events/${id}`,
};
export const ESPOO: LinkedEventsSource = {
  provider: "espoo",
  api: "https://api.espoo.fi/events/v1/event/",
  city: "Espoo",
  page: (id) => `https://www.espoo.fi/en/events/${id}`,
};

type L10n = { fi?: string; sv?: string; en?: string } | null | undefined;
const t = (v: L10n) => (v ? v.en || v.fi || v.sv : undefined)?.trim() || undefined;

export interface HelEvent {
  id: string;
  name?: L10n;
  short_description?: L10n;
  description?: L10n;
  start_time?: string | null;
  end_time?: string | null;
  event_status?: string;
  offers?: { is_free?: boolean; price?: L10n; info_url?: L10n }[];
  info_url?: L10n;
  images?: { url?: string }[];
  keywords?: { name?: L10n }[];
  location?: { id?: string; name?: L10n; street_address?: L10n; address_locality?: L10n; position?: { coordinates?: [number, number] } | null } | null;
  audience_min_age?: number | null;
}

const MAP: [RegExp, string][] = [
  [/children|lapset|lasten|kids|famil|perhe/, "family-shows"],
  [/opera|ooppera/, "opera"],
  [/jazz/, "jazz"],
  [/classical|klassinen/, "classical"],
  [/concert|konsert|music|musiikki/, "concerts"],
  [/dance|tanssi/, "dance"],
  [/theat|teatteri/, "plays"],
  [/circus|sirkus/, "circus"],
  [/film|elokuv|cinema/, "cinema"],
  [/exhibition|näyttely|art\b|taide/, "art-exhibitions"],
  [/lecture|luento|talk|keskustelu/, "public-lectures"],
  [/workshop|työpaja|course|kurssi/, "creative-workshops"],
  [/festival/, "festivals"],
  [/sport|liikunta|urheilu|exercise/, "sports"],
  [/tour|kierros|walk/, "guided-tours"],
];

export function mapHelCategory(keywords: string[]): string {
  const k = keywords.join(" ").toLowerCase();
  for (const [re, slug] of MAP) if (re.test(k)) return slug;
  return "culture";
}

/** Pure mapping function — unit-tested in tests/helsinki.test.ts. */
export function normalizeHelsinki(rows: HelEvent[], syncedAt: string, now = Date.now(), src: LinkedEventsSource = HELSINKI): ProviderBatch {
  const events: OmniEvent[] = [];
  const venues = new Map<string, Venue>();
  const offers: TicketOffer[] = [];
  const seen = new Set<string>();
  for (const e of rows) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const title = plainText(t(e.name));
    const [lng, lat] = e.location?.position?.coordinates ?? [NaN, NaN];
    const start = Date.parse(e.start_time ?? "");
    if (!title || !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(start)) continue;
    if (e.event_status === "EventCancelled") continue;
    const endRaw = Date.parse(e.end_time ?? "");
    const end = Number.isFinite(endRaw) && endRaw > start ? endRaw : undefined;
    if ((end ?? start) < now) continue;

    const name = t(e.location?.name) ?? src.city;
    const city = t(e.location?.address_locality) ?? src.city;
    const venueKey = e.location?.id ?? `${name}|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const venueId = `hel-v-${slugify(venueKey).slice(0, 60)}`;
    if (!venues.has(venueId))
      venues.set(venueId, {
        id: venueId,
        slug: slugify(`${name}-${city}-${keyOf(venueKey)}`),
        name,
        address: t(e.location?.street_address),
        city,
        cityId: nearestCityId(lat, lng),
        country: "Finland",
        countryCode: "FI",
        lat,
        lng,
        timeZone: TZ,
        provenance: { provider: src.provider, externalId: venueKey, lastSyncedAt: syncedAt, isDemo: false },
      });

    const keywords = (e.keywords ?? []).map((k) => t(k.name) ?? "").filter(Boolean);
    const cat = mapHelCategory([title, ...keywords]);
    const offer = e.offers?.[0];
    const isFree = !!offer?.is_free;
    const priceText = plainText(t(offer?.price)) ?? "";
    const price = isFree ? undefined : parseAmount(priceText);
    const multi = end !== undefined && end - start > 36 * 3600000;
    const id = `hel-e-${e.id.replace(/[^a-z0-9]/gi, "-")}`;
    const link = t(e.info_url) || t(offer?.info_url) || src.page(e.id);
    events.push({
      id,
      canonicalId: id,
      slug: slugify(`${title}-${city}-${e.id.split(":").pop()}`),
      title,
      description: plainText(t(e.short_description) ?? t(e.description))?.slice(0, 1500),
      categorySlug: cat,
      groupSlug: groupOf(cat),
      eventType: multi ? "multi_day" : "single",
      venueId,
      start: new Date(start).toISOString(),
      end: end !== undefined ? new Date(end).toISOString() : undefined,
      timeZone: TZ,
      status: e.event_status === "EventPostponed" ? "postponed" : isFree ? "free_entry" : "scheduled",
      ticketAccess: isFree ? "free" : price !== undefined || t(offer?.info_url) ? "ticketed" : "unknown",
      isFree,
      registrationRequired: false,
      online: false,
      familyFriendly: cat === "family-shows",
      ageRestriction: e.audience_min_age && e.audience_min_age >= 12 ? { minAge: e.audience_min_age, note: `From ${e.audience_min_age} years.` } : undefined,
      officialUrl: link,
      imageUrl: e.images?.[0]?.url,
      posterHue: hueOf(e.id),
      participants: [],
      provenance: { provider: src.provider, externalId: e.id, sourceUrl: src.page(e.id), lastSyncedAt: syncedAt, isDemo: false },
    });
    if (price !== undefined || t(offer?.info_url))
      offers.push({
        id: `${id}-tickets`,
        eventId: id,
        provider: t(offer?.info_url) ? new URL(t(offer?.info_url)!).hostname.replace(/^www\./, "") : name,
        providerType: "primary",
        ticketCategory: "standard",
        label: priceText ? `Advertised: ${priceText.slice(0, 80)}` : "Tickets",
        basePrice: price,
        currency: price !== undefined ? "EUR" : "",
        availability: "unknown",
        purchaseUrl: t(offer?.info_url) || link,
        priceObservedAt: price !== undefined ? syncedAt : undefined,
        isDemo: false,
      });
  }
  return { events, venues: [...venues.values()], participants: [], offers };
}

function linkedEventsProvider(src: LinkedEventsSource, meta: Pick<ProviderAdapter, "name" | "coverage" | "attribution">): ProviderAdapter {
  return {
    id: src.provider,
    ...meta,
    isDemo: false,
    isConfigured: () => true,
    refreshIntervalMs: 6 * 3600000,
    async sync(ctx) {
      const syncedAt = new Date().toISOString();
      const url = (page: number) => `${src.api}?start=today&super_event_type=none&include=location,keywords&page_size=100&page=${page}`;
      const first = (await fetchJson(src.provider, url(1), ctx, { revalidate: 0, timeoutMs: 60000 })) as { meta?: { count?: number }; data?: HelEvent[] };
      const rows: HelEvent[] = [...(first.data ?? [])];
      const pages = Math.min(300, Math.ceil((first.meta?.count ?? 0) / 100));
      const queue = Array.from({ length: Math.max(0, pages - 1) }, (_, i) => i + 2);
      let failures = 0;
      const worker = async () => {
        while (queue.length) {
          const page = queue.shift()!;
          try {
            const json = (await fetchJson(src.provider, url(page), ctx, { revalidate: 0, timeoutMs: 60000 })) as { data?: HelEvent[] };
            rows.push(...(json.data ?? []));
          } catch (err) {
            failures++;
            ctx.log(`${src.provider} page failed`, { page, err: String(err) });
          }
        }
      };
      await Promise.all(Array.from({ length: 5 }, worker));
      const batch = normalizeHelsinki(rows, syncedAt, Date.now(), src);
      return { batch, run: { imported: batch.events.length, updated: 0, failures, rateLimited: false, ok: batch.events.length > 0, finishedAt: new Date().toISOString(), error: failures ? `${failures} of ${pages} pages failed` : undefined } };
    },
  };
}

export const helsinkiProvider = linkedEventsProvider(HELSINKI, {
  name: "Linked Events (Helsinki region)",
  coverage: "Concerts, theatre, exhibitions, library, family and sports events in Helsinki, Vantaa and the region.",
  attribution: "Data: City of Helsinki Linked Events (CC BY 4.0).",
});

export const espooProvider = linkedEventsProvider(ESPOO, {
  name: "Espoo events (Linked Events)",
  coverage: "Events of the City of Espoo: cultural centres, libraries, sports, youth and family activities.",
  attribution: "Data: City of Espoo Linked Events (CC BY 4.0).",
});
